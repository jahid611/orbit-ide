/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess, execFile, spawn } from 'child_process';
import { assistant } from './assistant';
import { readConfig } from './config';

interface Provider {
	id: 'github' | 'gitlab';
	name: string;
	/** The provider's own command line tool: Orbit goes through the user's connection in it. */
	cli: string;
	icon: string;
	winget: string;
	brew: string;
	download: string;
}

const PROVIDERS: Provider[] = [
	{ id: 'github', name: 'GitHub', cli: 'gh', icon: 'github', winget: 'GitHub.cli', brew: 'gh', download: 'https://cli.github.com' },
	{ id: 'gitlab', name: 'GitLab', cli: 'glab', icon: 'orbit-gitlab', winget: 'GLab.GLab', brew: 'glab', download: 'https://gitlab.com/gitlab-org/cli#installation' },
];

interface Repo {
	/** `owner/name` on GitHub, `group/sub/name` on GitLab. */
	fullName: string;
	description: string;
	isPrivate: boolean;
	updated: number;
	url: string;
}

type Status = { state: 'missing' } | { state: 'out' } | { state: 'in'; login: string };

interface Result {
	code: number | null;
	out: string;
}

/** Runs a tool out of sight and gives back what it printed. `feed` is written to its input. */
function run(command: string, args: string[], options: { timeout?: number; onLine?: (line: string) => void; feed?: string; hold?: (child: ChildProcess) => void } = {}): Promise<Result> {
	return new Promise(resolve => {
		let out = '';
		let child: ChildProcess;
		try {
			child = spawn(command, args, { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' } });
		} catch {
			return resolve({ code: null, out: '' });
		}
		options.hold?.(child);
		const timer = setTimeout(() => child.kill(), options.timeout ?? 60000);
		const read = (chunk: Buffer) => {
			const text = chunk.toString('utf8');
			out += text;
			text.split(/\r?\n|\r/).filter(line => line.trim()).forEach(line => options.onLine?.(line));
		};
		child.stdout?.on('data', read);
		child.stderr?.on('data', read);
		child.on('error', () => {
			clearTimeout(timer);
			resolve({ code: null, out });
		});
		child.on('close', code => {
			clearTimeout(timer);
			resolve({ code, out });
		});
		if (options.feed !== undefined) {
			child.stdin?.write(options.feed);
		}
		child.stdin?.end();
	});
}

/** A tool installed a moment ago is on the system's path, not yet on the one Orbit started with. */
async function refreshPath(): Promise<void> {
	if (process.platform !== 'win32') {
		return;
	}
	const fresh = await new Promise<string>(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`], { windowsHide: true, timeout: 15000 }, (_error, stdout) => resolve(String(stdout ?? '').trim())));
	if (fresh) {
		const known = new Set((process.env.PATH ?? '').split(';').map(p => p.toLowerCase()));
		const added = fresh.split(';').filter(p => p && !known.has(p.toLowerCase()));
		if (added.length) {
			process.env.PATH = `${process.env.PATH};${added.join(';')}`;
		}
	}
}

async function statusOf(provider: Provider): Promise<Status> {
	const version = await run(provider.cli, ['--version'], { timeout: 15000 });
	if (version.code !== 0) {
		return { state: 'missing' };
	}
	const user = provider.id === 'github'
		? await run('gh', ['api', 'user', '--jq', '.login'], { timeout: 20000 })
		: await run('glab', ['api', 'user'], { timeout: 20000 });
	if (user.code !== 0) {
		return { state: 'out' };
	}
	let login = user.out.trim();
	if (provider.id === 'gitlab') {
		try {
			login = String(JSON.parse(user.out).username ?? '');
		} catch {
			login = '';
		}
	}
	return login ? { state: 'in', login } : { state: 'out' };
}

async function listRepos(provider: Provider): Promise<Repo[]> {
	if (provider.id === 'github') {
		const answer = await run('gh', ['api', 'user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member'], { timeout: 40000 });
		if (answer.code !== 0) {
			throw new Error(lastLine(answer.out) ?? 'GitHub n\'a pas répondu.');
		}
		return (JSON.parse(answer.out) as { full_name: string; description?: string; private: boolean; pushed_at?: string; clone_url: string }[]).map(r => ({ fullName: r.full_name, description: r.description ?? '', isPrivate: r.private, updated: Date.parse(r.pushed_at ?? '') || 0, url: r.clone_url }));
	}
	const answer = await run('glab', ['api', 'projects?membership=true&order_by=last_activity_at&per_page=100'], { timeout: 40000 });
	if (answer.code !== 0) {
		throw new Error(lastLine(answer.out) ?? 'GitLab n\'a pas répondu.');
	}
	return (JSON.parse(answer.out) as { path_with_namespace: string; description?: string; visibility?: string; last_activity_at?: string; http_url_to_repo: string }[]).map(r => ({ fullName: r.path_with_namespace, description: r.description ?? '', isPrivate: r.visibility !== 'public', updated: Date.parse(r.last_activity_at ?? '') || 0, url: r.http_url_to_repo }));
}

function lastLine(text: string): string | undefined {
	return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
}

function ago(time: number): string {
	if (!time) {
		return '';
	}
	const days = Math.floor((Date.now() - time) / 86400000);
	return days < 1 ? 'aujourd\'hui' : days < 2 ? 'hier' : days < 31 ? `il y a ${days} jours` : days < 365 ? `il y a ${Math.floor(days / 30)} mois` : `il y a ${Math.floor(days / 365)} an${days >= 730 ? 's' : ''}`;
}

/** What a pasted text points at: a full address, or `owner/name` on the provider being browsed. */
function parseAddress(text: string): { url: string; name: string } | undefined {
	const value = text.trim();
	const match = /^(?:https?:\/\/|git@|ssh:\/\/)[^\s]+?([^/:\s]+?)(?:\.git)?\/?$/.exec(value);
	return match ? { url: value, name: match[1] } : undefined;
}

/**
 * A project started from a repository. The user picks GitHub or GitLab, whichever they are
 * connected to (or connects now, without a terminal), then one of their repositories; it is
 * cloned in the projects folder and opened with an agent in it. Orbit never holds a token: the
 * list and the clone go through the provider's own tool (`gh`, `glab`), installed on request.
 * A pasted address works with whatever git itself can reach.
 */
export class RepoProjects {

	constructor(private readonly open: (dir: string) => Promise<void>) { }

	async start(): Promise<void> {
		type Item = vscode.QuickPickItem & { run: () => Promise<void> };
		const pick = vscode.window.createQuickPick<Item>();
		pick.title = 'Partir d\'un dépôt';
		pick.placeholder = 'Recherche de tes comptes…';
		pick.busy = true;
		pick.ignoreFocusOut = true;
		pick.show();
		const statuses = await Promise.all(PROVIDERS.map(async provider => ({ provider, status: await statusOf(provider) })));
		const items: Item[] = statuses.map(({ provider, status }) => status.state === 'in'
			? { label: `$(${provider.icon}) ${provider.name}`, description: `connecté : ${status.login}`, detail: 'Choisir un de tes dépôts', run: () => this.browse(provider) }
			: status.state === 'out'
				? { label: `$(${provider.icon}) Se connecter à ${provider.name}`, detail: 'La connexion se fait dans ton navigateur, puis tes dépôts s\'affichent ici', run: () => this.connect(provider) }
				: { label: `$(${provider.icon}) ${provider.name}`, description: 'outil à installer', detail: `Installe l'outil officiel de ${provider.name}, puis te connecte`, run: () => this.install(provider) });
		items.push({ label: '$(link) Coller l\'adresse d\'un dépôt…', detail: 'N\'importe quel dépôt git : GitHub, GitLab, Bitbucket, un serveur à toi', run: () => this.paste() });
		pick.items = items;
		pick.busy = false;
		pick.placeholder = 'D\'où vient le projet ?';
		const chosen = await new Promise<Item | undefined>(resolve => {
			pick.onDidAccept(() => resolve(pick.selectedItems[0]));
			pick.onDidHide(() => resolve(undefined));
		});
		pick.dispose();
		await chosen?.run();
	}

	/** The user's repositories, the most recently worked on first. */
	private async browse(provider: Provider): Promise<void> {
		// `direct`: an address typed in full, cloned by git itself rather than through the provider's tool.
		type Item = vscode.QuickPickItem & { repo?: Repo; direct?: boolean };
		const pick = vscode.window.createQuickPick<Item>();
		pick.title = `Tes dépôts ${provider.name}`;
		pick.placeholder = 'Chargement de tes dépôts…';
		pick.matchOnDescription = true;
		pick.matchOnDetail = true;
		pick.busy = true;
		pick.ignoreFocusOut = true;
		pick.show();
		let repos: Repo[] = [];
		try {
			repos = await listRepos(provider);
		} catch (error) {
			pick.dispose();
			vscode.window.showErrorMessage(`${provider.name} : ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const fromList = repos.map<Item>(repo => ({ label: `$(${repo.isPrivate ? 'lock' : 'repo'}) ${repo.fullName}`, description: [repo.isPrivate ? 'privé' : 'public', ago(repo.updated)].filter(Boolean).join(' · '), detail: repo.description || undefined, repo }));
		// What is typed may also be a repository that is not in the list (someone else's, an address).
		const typed = (value: string): Item[] => {
			const text = value.trim();
			if (!text || repos.some(r => r.fullName.toLowerCase() === text.toLowerCase())) {
				return [];
			}
			const address = parseAddress(text);
			if (address) {
				return [{ label: `$(link) Cloner ${text}`, alwaysShow: true, direct: true, repo: { fullName: address.name, description: '', isPrivate: false, updated: 0, url: text } }];
			}
			return /^[\w.-]+(\/[\w.-]+)+$/.test(text) ? [{ label: `$(repo) Cloner ${text}`, description: `un dépôt ${provider.name} qui n'est pas dans ta liste`, alwaysShow: true, repo: { fullName: text, description: '', isPrivate: false, updated: 0, url: '' } }] : [];
		};
		pick.items = fromList;
		pick.busy = false;
		pick.placeholder = repos.length ? `Cherche parmi tes ${repos.length} dépôts les plus récents, ou tape propriétaire/nom` : 'Aucun dépôt dans ce compte : tape propriétaire/nom ou colle une adresse';
		pick.onDidChangeValue(value => {
			pick.items = [...typed(value), ...fromList];
		});
		const chosen = await new Promise<Item | undefined>(resolve => {
			pick.onDidAccept(() => resolve(pick.selectedItems[0]));
			pick.onDidHide(() => resolve(undefined));
		});
		pick.dispose();
		if (chosen?.repo) {
			await this.clone(chosen.repo, chosen.direct ? undefined : provider);
		}
	}

	private async paste(): Promise<void> {
		const text = await vscode.window.showInputBox({ title: 'Partir d\'un dépôt', prompt: 'L\'adresse du dépôt', placeHolder: 'https://github.com/qui/quoi.git', ignoreFocusOut: true, validateInput: value => !value.trim() || parseAddress(value) ? undefined : 'Une adresse complète, par exemple https://gitlab.com/groupe/projet.git' });
		const address = text && parseAddress(text);
		if (address) {
			await this.clone({ fullName: address.name, description: '', isPrivate: false, updated: 0, url: address.url }, undefined);
		}
	}

	/** Clones into the projects folder and opens the result. `provider`: clone through its tool, with the user's connection. */
	private async clone(repo: Repo, provider: Provider | undefined): Promise<void> {
		const base = readConfig().projectsFolder;
		const name = (repo.fullName.split('/').pop() ?? 'projet').replace(/[<>:"/\\|?*]/g, '-');
		let dir = path.join(base, name);
		if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
			const existing = 'Ouvrir celui qui existe';
			const again = 'Cloner à côté';
			const answer = await vscode.window.showInformationMessage(`« ${name} » existe déjà dans ${base}.`, { modal: true, detail: '« Cloner à côté » fait une nouvelle copie du dépôt dans un dossier voisin.' }, existing, again);
			if (answer === existing) {
				return this.open(dir);
			}
			if (answer !== again) {
				return;
			}
			for (let n = 2; fs.existsSync(dir); n++) {
				dir = path.join(base, `${name}-${n}`);
			}
		}
		fs.mkdirSync(base, { recursive: true });
		const [command, args] = provider?.id === 'github' ? ['gh', ['repo', 'clone', repo.fullName, dir, '--', '--progress']]
			: provider?.id === 'gitlab' ? ['glab', ['repo', 'clone', repo.fullName, dir]]
				: ['git', ['clone', '--progress', repo.url, dir]];
		const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Récupération de ${repo.fullName}`, cancellable: true }, (progress, token) => {
			let child: ChildProcess | undefined;
			token.onCancellationRequested(() => child?.kill());
			return run(command as string, args as string[], {
				timeout: 30 * 60 * 1000,
				hold: started => { child = started; },
				// git says where it is: « Receiving objects:  42% (…) ».
				onLine: line => {
					const step = /^(?:remote: )?([A-Za-z ]+):\s+(\d+)%/.exec(line.trim());
					if (step) {
						progress.report({ message: `${step[2]} %` });
					}
				},
			}).then(done => ({ ...done, cancelled: token.isCancellationRequested }));
		});
		if (result.cancelled) {
			fs.rmSync(dir, { recursive: true, force: true });
			return;
		}
		if (result.code !== 0 || !fs.existsSync(dir)) {
			const why = result.code === null ? `l'outil « ${command} » est introuvable` : lastLine(result.out) ?? 'la récupération a échoué';
			const connect = provider ? undefined : PROVIDERS.find(p => repo.url.includes(p.id));
			const answer = await vscode.window.showErrorMessage(`Le dépôt n'a pas pu être récupéré : ${why}`, ...(connect ? [`Se connecter à ${connect.name}`] : []));
			if (answer && connect) {
				await this.connect(connect);
			}
			return;
		}
		vscode.window.showInformationMessage(`« ${path.basename(dir)} » est prêt dans ${base} : ${assistant().name} s'y lance.`);
		await this.open(dir);
	}

	/** Installs the provider's tool out of sight, then goes on to the connection. */
	private async install(provider: Provider): Promise<void> {
		const [command, args] = process.platform === 'win32' ? ['winget', ['install', '--id', provider.winget, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements']]
			: process.platform === 'darwin' ? ['brew', ['install', provider.brew]]
				: ['', []];
		if (!command) {
			const answer = await vscode.window.showInformationMessage(`Installe l'outil « ${provider.cli} » de ${provider.name} avec le gestionnaire de paquets de ta distribution, puis relance cette commande.`, 'Voir comment');
			if (answer) {
				vscode.env.openExternal(vscode.Uri.parse(provider.download));
			}
			return;
		}
		const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Installation de l'outil ${provider.name}…` }, () => run(command as string, args as string[], { timeout: 10 * 60 * 1000 }));
		await refreshPath();
		if ((await statusOf(provider)).state === 'missing') {
			const answer = await vscode.window.showErrorMessage(`L'outil ${provider.name} n'a pas pu être installé${result.code === null ? ` (« ${command} » est introuvable)` : ''}.`, 'L\'installer à la main');
			if (answer) {
				vscode.env.openExternal(vscode.Uri.parse(provider.download));
			}
			return;
		}
		await this.connect(provider);
	}

	/** Signs in through the browser, out of sight: the tool gives a code, Orbit shows it and opens the page. */
	private async connect(provider: Provider): Promise<void> {
		let host = provider.id === 'github' ? 'github.com' : 'gitlab.com';
		if (provider.id === 'gitlab') {
			const answer = await vscode.window.showInputBox({ title: 'Se connecter à GitLab', prompt: 'L\'adresse de ton GitLab', value: host, ignoreFocusOut: true });
			if (!answer?.trim()) {
				return;
			}
			host = answer.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
		}
		const args = provider.id === 'github'
			? ['auth', 'login', '--hostname', host, '--git-protocol', 'https', '--web', '--skip-ssh-key']
			: ['auth', 'login', '--hostname', host, '--git-protocol', 'https', '--web'];
		let opened = false;
		const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Connexion à ${provider.name} : valide dans ton navigateur…`, cancellable: true }, (progress, token) => {
			let child: ChildProcess | undefined;
			token.onCancellationRequested(() => child?.kill());
			return run(provider.cli, args, {
				timeout: 10 * 60 * 1000,
				// The tool waits for Enter before opening the browser.
				feed: '\n\n',
				hold: started => { child = started; },
				onLine: line => {
					const code = /code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(line);
					if (code) {
						vscode.env.clipboard.writeText(code[1]);
						progress.report({ message: `code ${code[1]} (copié)` });
						if (!opened) {
							opened = true;
							vscode.env.openExternal(vscode.Uri.parse(`https://${host}/login/device`));
						}
					}
				},
			});
		});
		const status = await statusOf(provider);
		if (status.state !== 'in') {
			if (result.code !== 0) {
				vscode.window.showErrorMessage(`La connexion à ${provider.name} n'a pas abouti${lastLine(result.out) ? ` : ${lastLine(result.out)}` : '.'}`);
			}
			return;
		}
		vscode.window.showInformationMessage(`Connecté à ${provider.name} : ${status.login}.`);
		await this.browse(provider);
	}
}
