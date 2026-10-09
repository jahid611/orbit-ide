/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { AgentTracker } from './agentTracker';
import { assistant } from './assistant';
import { ClaudeTerminals } from './claudeTerminals';
import { claudeEnv, workspaceRoot } from './config';
import { runClaude } from './inlineEdit';
import { deliverToAgent } from './deliver';
import { screenshot } from './community';
import { renderWebview, webviewOptions } from './webview';

interface Checks {
	cli?: string;
	account?: string;
	git: boolean;
	remote?: string;
	branch?: string;
	dirty: number;
	linked?: string;
	github: boolean;
}

interface Deployment {
	url: string;
	at: number;
	production: boolean;
	commit?: string;
}

/** A deployment as Vercel knows it. */
interface RemoteDeployment {
	id: string;
	url: string;
	state: string;
	production: boolean;
	/** The one the production domains point to. */
	current: boolean;
	created: number;
	seconds?: number;
	branch?: string;
	sha?: string;
	message?: string;
	creator?: string;
	inspector?: string;
}

/** The project as Vercel knows it: what its dashboard shows. */
interface Remote {
	name: string;
	framework?: string;
	node?: string;
	repo?: string;
	productionBranch?: string;
	domains: string[];
	dashboard?: string;
	deployments: RemoteDeployment[];
}

interface Step {
	label: string;
	state: 'todo' | 'doing' | 'done' | 'failed';
}

const HISTORY_KEY = 'orbit.vercel.deployments';
const COMMIT_SYSTEM = 'You write one git commit subject line: imperative, under 72 characters, no quotes, no trailing period, in the language of the diff\'s comments or French by default. Output only that line.';

/** Runs a command and resolves with what it printed; never rejects. Shims on Windows only run through a shell. */
function run(command: string, args: string[], cwd: string, onLine?: (line: string) => void, timeoutMs = 10 * 60 * 1000): Promise<{ code: number; out: string }> {
	return new Promise(resolve => {
		const env = { ...claudeEnv(), FORCE_COLOR: '0', NO_COLOR: '1' };
		// Real programs (git, gh) get their arguments as they are, whatever they contain. Only the
		// vercel and npm commands, script shims on Windows, have to go through a shell; their arguments are plain words.
		const proc = process.platform === 'win32' && (command === 'vercel' || command === 'npm')
			? spawn([command, ...args].join(' '), { cwd, env, windowsHide: true, shell: true })
			: spawn(command, args, { cwd, env, windowsHide: true });
		let out = '';
		let pending = '';
		const feed = (data: Buffer) => {
			const text = data.toString();
			out += text;
			pending += text;
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? '';
			lines.filter(l => l.trim()).forEach(l => onLine?.(l));
		};
		proc.stdout.on('data', feed);
		proc.stderr.on('data', feed);
		const timer = setTimeout(() => proc.kill(), timeoutMs);
		proc.on('error', () => { clearTimeout(timer); resolve({ code: 127, out }); });
		proc.on('close', code => {
			clearTimeout(timer);
			if (pending.trim()) {
				onLine?.(pending);
			}
			resolve({ code: code ?? 1, out });
		});
	});
}

/**
 * One read of the Vercel API, made by the user's own `vercel` tool with its own login
 * (`vercel api`): Orbit never sees a token. Resolves with undefined when it fails.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vercelApi(endpoint: string, cwd: string): Promise<any> {
	return new Promise(resolve => {
		const env = { ...claudeEnv(), FORCE_COLOR: '0', NO_COLOR: '1' };
		// The endpoint is built here from identifiers checked against [\w-]: safe between quotes.
		const proc = process.platform === 'win32'
			? spawn(`vercel api "${endpoint}" --raw`, { cwd, env, windowsHide: true, shell: true })
			: spawn('vercel', ['api', endpoint, '--raw'], { cwd, env });
		let out = '';
		proc.stdout.on('data', (data: Buffer) => { out += data.toString(); });
		const timer = setTimeout(() => proc.kill(), 30000);
		proc.on('error', () => { clearTimeout(timer); resolve(undefined); });
		proc.on('close', () => {
			clearTimeout(timer);
			try {
				resolve(JSON.parse(out));
			} catch {
				resolve(undefined);
			}
		});
	});
}

const IN_PROGRESS = /^(BUILDING|QUEUED|INITIALIZING)$/;

/**
 * Publishing: the project goes online on Vercel in one click. The code is committed and pushed
 * to the project's GitHub repository, the Vercel project is linked to that repository (so later
 * pushes deploy by themselves), and the production deployment is started and followed here.
 * The assistant writes the commit message and is handed the build log when a deployment fails.
 * Everything runs with the user's own Vercel and GitHub logins, through their command-line tools.
 */
export class VercelPublisher implements vscode.Disposable {

	private panel: vscode.WebviewPanel | undefined;
	private checks: Checks | undefined;
	private checking = false;
	private busy = false;
	private steps: Step[] = [];
	private log: string[] = [];
	private failure: string | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	private pollTimer: NodeJS.Timeout | undefined;
	private remote: Remote | undefined;
	private team = '';
	private loadingRemote = false;
	private shot: { id: string; data: string } | undefined;
	private capturing = false;
	/** A step of the first set-up running in the background: installing the tool, signing in, signing out. */
	private setup: { text: string; url?: string; code?: string } | undefined;

	constructor(private readonly context: vscode.ExtensionContext, private readonly claude: ClaudeTerminals, private readonly tracker: AgentTracker) {
		this.disposables.push(
			vscode.commands.registerCommand('orbit.vercel.show', () => this.show()),
			vscode.commands.registerCommand('orbit.vercel.publish', () => { this.show(); this.publish(true); }),
		);
	}

	dispose(): void {
		clearInterval(this.pollTimer);
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	private history(): Deployment[] {
		return this.context.workspaceState.get<Deployment[]>(HISTORY_KEY, []);
	}

	show(): void {
		if (this.panel) {
			this.panel.reveal();
			this.refresh();
			return;
		}
		this.panel = vscode.window.createWebviewPanel('orbit.vercel', 'Vercel', vscode.ViewColumn.Active, { ...webviewOptions(this.context.extensionUri), retainContextWhenHidden: true });
		this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vercel.png');
		// While a step is missing (tool to install, account to sign in), look again every few
		// seconds: the page moves on by itself as soon as the user has done it, wherever they did it.
		clearInterval(this.pollTimer);
		this.pollTimer = setInterval(() => {
			if (!this.panel?.visible || this.busy || !this.checks) {
				return;
			}
			if (!(this.checks.cli && this.checks.account)) {
				this.refresh(true);
			} else if (this.remote?.deployments.some(d => IN_PROGRESS.test(d.state))) {
				// A deployment started elsewhere (a push to GitHub) is followed until it settles.
				this.loadRemote().then(() => this.send());
			}
		}, 4000);
		this.panel.webview.html = renderWebview(this.panel.webview, this.context.extensionUri, 'vercel');
		const listener = this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg).catch(err => {
			vscode.window.showErrorMessage(`Vercel : ${err instanceof Error ? err.message : String(err)}`);
		}));
		this.panel.onDidChangeViewState(e => e.webviewPanel.visible && !this.busy && this.refresh());
		this.panel.onDidDispose(() => {
			listener.dispose();
			clearInterval(this.pollTimer);
			this.panel = undefined;
		});
	}

	private send(): void {
		this.panel?.webview.postMessage({
			type: 'state',
			project: path.basename(workspaceRoot()),
			checks: this.checks,
			checking: this.checking,
			busy: this.busy,
			steps: this.steps,
			log: this.log.slice(-200),
			failure: this.failure,
			history: this.history().slice(0, 8),
			remote: this.remote,
			setup: this.setup,
			assistant: assistant().name,
		});
	}

	/** Where the project stands: tools, logins, repository, link to Vercel. */
	private async refresh(quiet = false): Promise<void> {
		if (this.checking || this.busy) {
			return;
		}
		this.checking = true;
		if (!quiet) {
			this.send();
		}
		const root = workspaceRoot();
		const [cli, git, gh] = await Promise.all([
			run('vercel', ['--version'], root, undefined, 30000),
			run('git', ['rev-parse', '--is-inside-work-tree'], root, undefined, 15000),
			run('gh', ['auth', 'status'], root, undefined, 20000),
		]);
		const checks: Checks = { git: git.code === 0 && /true/.test(git.out), dirty: 0, github: gh.code === 0 };
		if (cli.code === 0) {
			checks.cli = cli.out.match(/\d+\.\d+\.\d+/)?.[0] ?? 'installée';
			const who = await run('vercel', ['whoami'], root, undefined, 30000);
			if (who.code === 0) {
				checks.account = who.out.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(vercel cli|>)/i.test(l)).pop();
			}
		}
		if (checks.git) {
			const [remote, branch, status] = await Promise.all([
				run('git', ['remote', 'get-url', 'origin'], root, undefined, 15000),
				run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root, undefined, 15000),
				run('git', ['status', '--porcelain'], root, undefined, 30000),
			]);
			checks.remote = remote.code === 0 ? remote.out.trim() : undefined;
			checks.branch = branch.code === 0 ? branch.out.trim() : undefined;
			checks.dirty = status.out.split(/\r?\n/).filter(l => l.trim()).length;
		}
		try {
			const linked = JSON.parse(fs.readFileSync(path.join(root, '.vercel', 'project.json'), 'utf8'));
			checks.linked = typeof linked.projectName === 'string' ? linked.projectName : typeof linked.projectId === 'string' ? 'relié' : undefined;
		} catch {
			// not linked yet
		}
		this.checks = checks;
		if (checks.account && checks.linked) {
			await this.loadRemote();
		} else {
			this.remote = undefined;
		}
		this.checking = false;
		this.send();
	}

	/** What Vercel's dashboard shows for this project: production deployment, domains, the list of deployments. */
	private async loadRemote(): Promise<void> {
		if (this.loadingRemote) {
			return;
		}
		const root = workspaceRoot();
		let ids: { projectId?: string; orgId?: string };
		try {
			ids = JSON.parse(fs.readFileSync(path.join(root, '.vercel', 'project.json'), 'utf8'));
		} catch {
			this.remote = undefined;
			return;
		}
		if (!ids.projectId || !/^[\w-]+$/.test(ids.projectId)) {
			this.remote = undefined;
			return;
		}
		this.loadingRemote = true;
		try {
			this.team = ids.orgId && /^team_[\w-]+$/.test(ids.orgId) ? `teamId=${ids.orgId}` : '';
			const [project, list] = await Promise.all([
				vercelApi(`/v9/projects/${ids.projectId}?${this.team}`, root),
				vercelApi(`/v6/deployments?projectId=${ids.projectId}&limit=20&${this.team}`, root),
			]);
			if (typeof project?.name !== 'string') {
				return; // offline or refused: what was shown stays
			}
			const production = project.targets?.production;
			const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const meta = (d: any, suffix: string) => text(Object.entries(d.meta ?? {}).find(([key]) => key.endsWith(suffix))?.[1]);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const deployments: RemoteDeployment[] = (Array.isArray(list?.deployments) ? list.deployments : []).map((d: any) => ({
				id: String(d.uid),
				url: String(d.url),
				state: String(d.state ?? d.readyState ?? 'QUEUED'),
				production: d.target === 'production',
				current: !!production && (d.uid === production.id || d.url === production.url),
				created: Number(d.created ?? d.createdAt),
				seconds: d.ready && d.buildingAt ? Math.max(1, (d.ready - d.buildingAt) / 1000) : undefined,
				branch: meta(d, 'CommitRef'),
				sha: meta(d, 'CommitSha'),
				message: meta(d, 'CommitMessage')?.split('\n')[0],
				creator: text(d.creator?.username),
				inspector: text(d.inspectorUrl),
			}));
			const aliases: unknown[] = Array.isArray(production?.alias) ? production.alias : [];
			this.remote = {
				name: project.name,
				framework: text(project.framework),
				node: text(project.nodeVersion),
				repo: project.link?.repo ? `${project.link.org ? `${project.link.org}/` : ''}${project.link.repo}` : undefined,
				productionBranch: text(project.link?.productionBranch),
				domains: aliases.filter((a): a is string => typeof a === 'string').sort((a, b) => a.length - b.length),
				dashboard: deployments[0]?.inspector?.replace(/\/[^/]+$/, ''),
				deployments,
			};
			this.capture(this.remote);
		} finally {
			this.loadingRemote = false;
		}
	}

	/** The picture of the live site shown on the production card, taken once per deployment. */
	private async capture(remote: Remote): Promise<void> {
		const live = remote.deployments.find(d => d.current && d.state === 'READY');
		const address = remote.domains[0] ?? live?.url;
		if (!live || !address || this.shot?.id === live.id || this.capturing) {
			return;
		}
		const folder = path.join(this.context.globalStorageUri.fsPath, 'vercel');
		const file = path.join(folder, `${live.id}.png`);
		if (!fs.existsSync(file)) {
			this.capturing = true;
			fs.mkdirSync(folder, { recursive: true });
			const taken = await screenshot(`https://${address}`, file);
			this.capturing = false;
			if (!taken) {
				return;
			}
		}
		this.shot = { id: live.id, data: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` };
		this.panel?.webview.postMessage({ type: 'shot', shot: this.shot });
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'ready':
				if (this.shot) {
					this.panel?.webview.postMessage({ type: 'shot', shot: this.shot });
				}
				await this.refresh();
				break;
			case 'refresh':
				await this.refresh();
				break;
			case 'logs': {
				const id = String(msg.id ?? '');
				if (!/^[\w-]+$/.test(id)) {
					break;
				}
				const events = await vercelApi(`/v3/deployments/${id}/events?builds=1&limit=2000&${this.team}`, workspaceRoot());
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const lines = (Array.isArray(events) ? events : []).filter((e: any) => typeof e.text === 'string' && e.text.trim()).map((e: any) => ({ at: Number(e.created ?? e.date), text: String(e.text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd(), error: e.type === 'stderr' && /\berror\b|failed/i.test(String(e.text)) }));
				this.panel?.webview.postMessage({ type: 'logs', id, lines });
				break;
			}
			case 'install':
				await this.background('Installation de l\'outil Vercel…', 'npm', ['install', '-g', 'vercel']);
				break;
			case 'login':
				// The tool prints the address of the sign-in page and waits: Orbit opens it.
				await this.background('Valide la connexion dans le navigateur…', 'vercel', ['login'], line => {
					const url = line.match(/https:\/\/vercel\.com\/\S+/)?.[0];
					if (url && this.setup && !this.setup.url) {
						this.setup.url = url;
						this.setup.code = url.match(/user_code=([\w-]+)/)?.[1];
						vscode.env.openExternal(vscode.Uri.parse(url, true));
						this.send();
					}
				});
				break;
			case 'logout': {
				const leave = 'Me déconnecter';
				const answer = await vscode.window.showWarningMessage('Se déconnecter de Vercel ?', { modal: true, detail: `Le compte ${this.checks?.account ?? ''} est déconnecté de l'outil Vercel de cette machine. Tes sites restent en ligne.` }, leave);
				if (answer === leave) {
					this.remote = undefined;
					this.shot = undefined;
					await this.background('Déconnexion…', 'vercel', ['logout']);
				}
				break;
			}
			case 'publish':
				await this.publish(msg.production !== false);
				break;
			case 'fix':
				this.fix();
				break;
			case 'open':
				if (/^https:\/\//.test(String(msg.url))) {
					vscode.env.openExternal(vscode.Uri.parse(String(msg.url)));
				}
				break;
			case 'copy':
				await vscode.env.clipboard.writeText(String(msg.text ?? ''));
				break;
		}
	}

	/** A set-up command run out of sight: the page shows what is going on, no terminal opens. */
	private async background(text: string, command: string, args: string[], onLine?: (line: string) => void): Promise<void> {
		if (this.setup || this.busy) {
			return;
		}
		this.setup = { text };
		this.send();
		const result = await run(command, args, workspaceRoot(), onLine, 10 * 60 * 1000);
		this.setup = undefined;
		if (result.code !== 0) {
			const last = result.out.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop();
			vscode.window.showErrorMessage(`Vercel : ${last ?? 'la commande a échoué.'}`);
		}
		this.checking = false;
		await this.refresh();
	}

	private step(label: string): Step {
		const step: Step = { label, state: 'doing' };
		this.steps.push(step);
		this.send();
		return step;
	}

	private note(line: string): void {
		this.log.push(line.replace(/\x1b\[[0-9;]*m/g, ''));
		if (this.log.length > 600) {
			this.log.splice(0, this.log.length - 600);
		}
		this.send();
	}

	/** The whole way from the files on disk to a live address. Stops at the first step that fails. */
	private async publish(production: boolean): Promise<void> {
		if (this.busy) {
			return;
		}
		await this.refresh();
		const checks = this.checks;
		if (!checks?.cli || !checks.account) {
			return; // the page shows what is missing
		}
		const root = workspaceRoot();
		this.busy = true;
		this.steps = [];
		this.log = [];
		this.failure = undefined;
		const fail = (step: Step, reason: string) => {
			step.state = 'failed';
			this.failure = reason;
			this.busy = false;
			this.send();
		};
		try {
			// 1. A repository on GitHub, created private the first time.
			let step = this.step('Dépôt GitHub');
			if (!checks.git) {
				const init = await run('git', ['init', '-b', 'main'], root, l => this.note(l));
				if (init.code !== 0) {
					return fail(step, 'Impossible de créer le dépôt git du projet.');
				}
			}
			if (!checks.remote) {
				if (!checks.github) {
					return fail(step, 'Connecte-toi d\'abord à GitHub : lance « gh auth login » dans un terminal, puis publie à nouveau.');
				}
				const create = 'Créer le dépôt privé';
				const answer = await vscode.window.showInformationMessage('Créer le dépôt GitHub du projet ?', { modal: true, detail: `Le projet « ${path.basename(root)} » n'a pas encore de dépôt GitHub. Orbit en crée un, privé, à ton nom, et y envoie le code. Vercel publie depuis ce dépôt.` }, create);
				if (answer !== create) {
					return fail(step, 'Publication annulée : sans dépôt GitHub, rien n\'est envoyé.');
				}
			}
			step.state = 'done';

			// 2. Commit what changed, with a message written by the assistant.
			step = this.step('Enregistrement des changements');
			const status = await run('git', ['status', '--porcelain'], root);
			if (status.out.trim()) {
				await run('git', ['add', '-A'], root, l => this.note(l));
				const diff = await run('git', ['diff', '--cached', '--stat'], root);
				let message = 'Mise à jour du site';
				try {
					const written = (await runClaude(`Changes:\n${diff.out.slice(0, 6000)}`, COMMIT_SYSTEM, root)).split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
					if (written && written.length < 120) {
						message = written.replace(/^["'`]|["'`]$/g, '');
					}
				} catch {
					// no assistant available right now: the plain message does
				}
				this.note(`Commit : ${message}`);
				// git refuses to commit without a name and an address. When none is set on this machine,
				// the commit is signed with the user's own GitHub account (its private address), for this
				// commit only: nothing is written to the git configuration.
				const identity: string[] = [];
				const known = await run('git', ['config', 'user.email'], root, undefined, 15000);
				if (!known.out.trim()) {
					const who = await run('gh', ['api', 'user', '--jq', '.login, .id, .name'], root, undefined, 30000);
					const [login, id, rawName] = who.out.split(/\r?\n/).map(l => l.trim());
					const name = rawName && rawName !== 'null' ? rawName : '';
					if (who.code !== 0 || !login || !/^\d+$/.test(id ?? '')) {
						return fail(step, 'git ne sait pas qui tu es sur cette machine et GitHub n\'est pas connecté. Lance « gh auth login » dans un terminal, ou règle « git config --global user.name » et « user.email », puis publie à nouveau.');
					}
					identity.push('-c', `user.name=${name || login}`, '-c', `user.email=${id}+${login}@users.noreply.github.com`);
					this.note(`Signé avec ton compte GitHub : ${name || login}`);
				}
				const commit = await run('git', [...identity, 'commit', '-m', message], root, l => this.note(l));
				if (commit.code !== 0) {
					return fail(step, 'L\'enregistrement des changements a échoué. Le journal ci-dessous dit pourquoi.');
				}
			}
			step.state = 'done';

			// 3. Push.
			step = this.step('Envoi sur GitHub');
			if (!checks.remote) {
				const created = await run('gh', ['repo', 'create', path.basename(root).replace(/[^\w.-]+/g, '-'), '--private', '--source', '.', '--remote', 'origin', '--push'], root, l => this.note(l));
				if (created.code !== 0) {
					return fail(step, 'GitHub a refusé de créer le dépôt (un dépôt du même nom existe peut-être déjà).');
				}
			} else {
				const pushed = await run('git', ['push', '-u', 'origin', 'HEAD'], root, l => this.note(l));
				if (pushed.code !== 0) {
					return fail(step, 'L\'envoi sur GitHub a échoué : le dépôt distant a peut-être des changements à récupérer d\'abord.');
				}
			}
			step.state = 'done';

			// 4. The Vercel project, linked to the repository so later pushes deploy by themselves.
			step = this.step('Projet Vercel');
			if (!fs.existsSync(path.join(root, '.vercel', 'project.json'))) {
				const linked = await run('vercel', ['link', '--yes'], root, l => this.note(l));
				if (linked.code !== 0) {
					return fail(step, 'Vercel n\'a pas pu créer le projet.');
				}
				// Not fatal: without the GitHub integration on the Vercel account, deployments still work from here.
				await run('vercel', ['git', 'connect', '--yes'], root, l => this.note(l));
			}
			step.state = 'done';

			// 5. Deploy and follow the build.
			step = this.step(production ? 'Mise en ligne' : 'Aperçu en ligne');
			const deployed = await run('vercel', ['deploy', '--yes', ...(production ? ['--prod'] : [])], root, l => this.note(l), 20 * 60 * 1000);
			const urls = deployed.out.match(/https:\/\/[^\s"']+\.vercel\.app[^\s"']*/g) ?? [];
			const url = urls[urls.length - 1];
			if (deployed.code !== 0 || !url) {
				return fail(step, 'La construction du site a échoué sur Vercel. Le journal ci-dessous dit pourquoi.');
			}
			step.state = 'done';
			const head = await run('git', ['rev-parse', '--short', 'HEAD'], root);
			await this.context.workspaceState.update(HISTORY_KEY, [{ url, at: Date.now(), production, commit: head.out.trim() || undefined }, ...this.history()].slice(0, 20));
			this.busy = false;
			await this.refresh();
			vscode.window.showInformationMessage(`En ligne : ${url}`, 'Ouvrir').then(choice => choice && vscode.env.openExternal(vscode.Uri.parse(url)));
		} finally {
			this.busy = false;
			this.send();
		}
	}

	/** A failed deployment goes to the assistant with the end of the log. */
	private fix(): void {
		const message = [
			'La mise en ligne du projet sur Vercel a échoué.',
			this.failure ?? '',
			'',
			'Fin du journal :',
			this.log.slice(-60).join('\n'),
			'',
			'Trouve la cause dans le projet (script de construction, dépendances, variables d\'environnement, configuration Vercel) et corrige-la. Vérifie que la construction passe en local, puis dis-moi de publier à nouveau.',
		].join('\n');
		deliverToAgent(this.claude, this.tracker, message);
	}
}
