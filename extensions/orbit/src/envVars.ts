/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { claudeEnv, workspaceRoot } from './config';
import { Page } from './page';
import { vercelApi } from './vercel';

const FILE = /^\.env(\.[\w.-]+)?$/;
const EXAMPLE = /\.(example|sample|template|dist)$/i;
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TARGETS = ['production', 'preview', 'development'];

interface Entry {
	key: string;
	value: string;
}

/** The variables of an env file, in order. Comments and blank lines are left where they are by the writers below. */
export function readEnvFile(file: string): Entry[] {
	let text: string;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch {
		return [];
	}
	const entries: Entry[] = [];
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (match) {
			let value = match[2].trim();
			if (/^(".*"|'.*')$/.test(value)) {
				value = value.slice(1, -1);
			} else {
				value = value.replace(/\s+#.*$/, '');
			}
			entries.push({ key: match[1], value });
		}
	}
	return entries;
}

function quote(value: string): string {
	return /[\s#"'$`\\]/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value;
}

/** Sets one variable in an env file: its line is replaced where it stands, or added at the end. */
export function writeEnvValue(file: string, key: string, value: string): void {
	let lines: string[] = [];
	try {
		lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
	} catch {
		// a new file
	}
	const at = lines.findIndex(l => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(l));
	const line = `${key}=${quote(value)}`;
	if (at >= 0) {
		lines[at] = line;
	} else {
		while (lines.length && !lines[lines.length - 1].trim()) {
			lines.pop();
		}
		lines.push(line);
	}
	fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function removeEnvValue(file: string, key: string): void {
	const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => !new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(l));
	fs.writeFileSync(file, lines.join('\n'));
}

/** Whether a .gitignore keeps env files out: `.env*`, or `.env` together with its variants. */
function covers(gitignore: string): boolean {
	const has = (pattern: RegExp) => pattern.test(gitignore);
	return has(/^\s*\.env\*\s*$/m) || (has(/^\s*\.env\s*$/m) && has(/^\s*\.env(\.\*|\.local|\*\.local|\.\*\.local)\s*$/m));
}

/** Env files with real values must never be committed: the rule is added to .gitignore when it is missing. */
export function protectEnvFiles(root: string): boolean {
	const file = path.join(root, '.gitignore');
	let text = '';
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch {
		// no .gitignore yet
	}
	if (covers(text)) {
		return false;
	}
	fs.writeFileSync(file, `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}# Variables d'environnement : jamais dans le dépôt\n.env\n.env.*\n!.env.example\n`);
	return true;
}

/** Writes secrets a service handed over into the project's local env file, which stays out of git. */
export function storeProjectSecrets(root: string, values: Record<string, string>): string {
	protectEnvFiles(root);
	const file = path.join(root, '.env.local');
	for (const [key, value] of Object.entries(values)) {
		writeEnvValue(file, key, value);
	}
	return '.env.local';
}

function ignored(root: string): boolean {
	try {
		return covers(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'));
	} catch {
		return false;
	}
}

/**
 * Environment variables: every env file of the project on one page. Values are masked, shown one
 * at a time on request, and never leave this page: the agent is given names only, and Claude Code
 * is denied reading the files (see `agentTracker.ts`). The variables are compared with the ones of
 * the Vercel project and sent there, or fetched from there, in one click.
 */
export class EnvVars extends Page {

	private remote: { key: string; targets: string[] }[] | undefined;
	private linked = false;
	private busy: string | undefined;
	/** Variables an agent asked for through its `env_ask` tool, to fill in here. */
	private asked: { key: string; why: string }[] = [];

	constructor(context: vscode.ExtensionContext, private readonly tellAgent: (message: string) => void) {
		super(context, 'env', 'Variables d\'environnement');
		this.disposables.push(vscode.commands.registerCommand('orbit.env.show', () => this.show()));
		const watcher = vscode.workspace.createFileSystemWatcher('**/.env*');
		const changed = () => this.visible && this.send();
		this.disposables.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
	}

	/** Names only, per file: what an agent is allowed to know. */
	names(): Record<string, string[]> {
		const root = workspaceRoot();
		return Object.fromEntries(this.files(root).map(f => [f, readEnvFile(path.join(root, f)).map(e => e.key)]));
	}

	/** An agent needs a variable it cannot see: the page opens with the request on top. */
	ask(key: string, why: string): void {
		if (KEY.test(key) && !this.asked.some(a => a.key === key)) {
			this.asked.push({ key, why: why.slice(0, 300) });
		}
		this.show();
	}

	private files(root: string): string[] {
		try {
			return fs.readdirSync(root).filter(f => FILE.test(f) && fs.statSync(path.join(root, f)).isFile()).sort((a, b) => a.length - b.length || a.localeCompare(b));
		} catch {
			return [];
		}
	}

	protected send(): void {
		const root = workspaceRoot();
		const files = this.files(root).map(name => ({
			name,
			example: EXAMPLE.test(name),
			// Never the values: only whether there is one, and how long it is.
			entries: readEnvFile(path.join(root, name)).map(e => ({ key: e.key, length: e.value.length })),
		}));
		const present = new Set(files.filter(f => !f.example).flatMap(f => f.entries.filter(e => e.length).map(e => e.key)));
		this.asked = this.asked.filter(a => !present.has(a.key));
		this.post({
			type: 'state',
			project: path.basename(root),
			files,
			ignored: ignored(root),
			git: fs.existsSync(path.join(root, '.git')),
			linked: this.linked,
			remote: this.remote,
			busy: this.busy,
			asked: this.asked,
			hidden: vscode.workspace.getConfiguration('orbit').get<boolean>('env.hideFromAgent', true),
		});
	}

	protected override async refresh(): Promise<void> {
		this.send();
		await this.loadRemote();
		this.send();
	}

	private ids(): { projectId: string; team: string } | undefined {
		try {
			const ids = JSON.parse(fs.readFileSync(path.join(workspaceRoot(), '.vercel', 'project.json'), 'utf8'));
			if (typeof ids.projectId === 'string' && /^[\w-]+$/.test(ids.projectId)) {
				return { projectId: ids.projectId, team: typeof ids.orgId === 'string' && /^team_[\w-]+$/.test(ids.orgId) ? `teamId=${ids.orgId}` : '' };
			}
		} catch {
			// not linked to Vercel
		}
		return undefined;
	}

	private async loadRemote(): Promise<void> {
		const ids = this.ids();
		this.linked = !!ids;
		if (!ids) {
			this.remote = undefined;
			return;
		}
		const answer = await vercelApi(`/v9/projects/${ids.projectId}/env?${ids.team}`, workspaceRoot());
		if (Array.isArray(answer?.envs)) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			this.remote = answer.envs.map((e: any) => ({ key: String(e.key), targets: Array.isArray(e.target) ? e.target.map(String) : [] }));
		}
	}

	private target(file: unknown): string {
		const name = String(file ?? '');
		if (!FILE.test(name)) {
			throw new Error('Fichier refusé.');
		}
		return path.join(workspaceRoot(), name);
	}

	/** `vercel env add`, the value going in through the standard input: it never appears in a command line. */
	private vercelSet(key: string, value: string, target: string): Promise<boolean> {
		return new Promise(resolve => {
			const env = { ...claudeEnv(), FORCE_COLOR: '0', NO_COLOR: '1' };
			const proc = process.platform === 'win32'
				? spawn(`vercel env add ${key} ${target} --force`, { cwd: workspaceRoot(), env, windowsHide: true, shell: true })
				: spawn('vercel', ['env', 'add', key, target, '--force'], { cwd: workspaceRoot(), env });
			const timer = setTimeout(() => proc.kill(), 60000);
			proc.on('error', () => { clearTimeout(timer); resolve(false); });
			proc.on('close', code => { clearTimeout(timer); resolve(code === 0); });
			proc.stdin.end(value);
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected async onMessage(msg: any): Promise<void> {
		const root = workspaceRoot();
		const key = String(msg.key ?? '').trim();
		switch (msg.type) {
			case 'refresh':
				await this.refresh();
				break;
			case 'reveal': {
				const value = readEnvFile(this.target(msg.file)).find(e => e.key === key)?.value ?? '';
				this.post({ type: 'value', file: msg.file, key, value });
				break;
			}
			case 'copy': {
				await vscode.env.clipboard.writeText(readEnvFile(this.target(msg.file)).find(e => e.key === key)?.value ?? '');
				this.post({ type: 'toast', text: `${key} copiée` });
				break;
			}
			case 'set': {
				if (!KEY.test(key)) {
					throw new Error('Un nom de variable ne contient que des lettres, des chiffres et « _ », sans commencer par un chiffre.');
				}
				const file = this.target(msg.file);
				if (!EXAMPLE.test(String(msg.file))) {
					protectEnvFiles(root);
				}
				writeEnvValue(file, key, String(msg.value ?? ''));
				this.send();
				break;
			}
			case 'remove': {
				if (!KEY.test(key)) {
					break;
				}
				const answer = await vscode.window.showWarningMessage(`Supprimer ${key} de ${msg.file} ?`, { modal: true }, 'Supprimer');
				if (answer) {
					removeEnvValue(this.target(msg.file), key);
					this.send();
				}
				break;
			}
			case 'newFile': {
				const name = await vscode.window.showQuickPick(['.env.local', '.env', '.env.production', '.env.development', '.env.example'].filter(f => !fs.existsSync(path.join(root, f))), { placeHolder: 'Quel fichier créer ?' });
				if (name) {
					fs.writeFileSync(this.target(name), '');
					if (!EXAMPLE.test(name)) {
						protectEnvFiles(root);
					}
					this.send();
				}
				break;
			}
			case 'protect':
				protectEnvFiles(root);
				this.send();
				break;
			case 'example': {
				// The example file lists every name, without any value: safe to commit and to show an agent.
				const example = path.join(root, '.env.example');
				const known = new Set(readEnvFile(example).map(e => e.key));
				const names = [...new Set(this.files(root).filter(f => !EXAMPLE.test(f)).flatMap(f => readEnvFile(path.join(root, f)).map(e => e.key)))].filter(k => !known.has(k));
				names.forEach(name => writeEnvValue(example, name, ''));
				this.post({ type: 'toast', text: names.length ? `${names.length} nom${names.length > 1 ? 's' : ''} ajouté${names.length > 1 ? 's' : ''} à .env.example` : '.env.example est déjà à jour' });
				this.send();
				break;
			}
			case 'names': {
				const names = this.names();
				const lines = Object.entries(names).map(([file, keys]) => `- ${file} : ${keys.join(', ') || '(vide)'}`);
				this.tellAgent(`Voici les variables d'environnement du projet (noms seulement, les valeurs restent dans la page « Variables d'environnement » d'Orbit) :\n${lines.join('\n')}\nUtilise ces noms dans le code. S'il en manque une, dis-moi laquelle et pourquoi : je la remplirai moi-même.`);
				break;
			}
			case 'push': {
				const targets = (Array.isArray(msg.targets) ? msg.targets.map(String) : []).filter((t: string) => TARGETS.includes(t));
				const keys: string[] = (Array.isArray(msg.keys) ? msg.keys.map(String) : [key]).filter((k: string) => KEY.test(k));
				if (!targets.length || !keys.length) {
					break;
				}
				const values = new Map(readEnvFile(this.target(msg.file)).map(e => [e.key, e.value]));
				let sent = 0;
				for (const name of keys) {
					const value = values.get(name);
					if (!value) {
						continue;
					}
					for (const target of targets) {
						this.busy = `Envoi de ${name} vers Vercel (${target})…`;
						this.send();
						if (await this.vercelSet(name, value, target)) {
							sent++;
						}
					}
				}
				this.busy = undefined;
				this.post({ type: 'toast', text: sent ? `${sent} valeur${sent > 1 ? 's' : ''} envoyée${sent > 1 ? 's' : ''} sur Vercel` : 'Vercel a refusé l\'envoi' });
				await this.refresh();
				break;
			}
			case 'pull': {
				const answer = await vscode.window.showWarningMessage('Récupérer les variables de Vercel ?', { modal: true, detail: 'Les variables de développement du projet Vercel sont écrites dans .env.local. Ce que ce fichier contient est remplacé.' }, 'Récupérer');
				if (!answer) {
					break;
				}
				this.busy = 'Récupération depuis Vercel…';
				this.send();
				protectEnvFiles(root);
				const env = { ...claudeEnv(), FORCE_COLOR: '0', NO_COLOR: '1' };
				await new Promise<void>(resolve => {
					const proc = process.platform === 'win32'
						? spawn('vercel env pull .env.local --yes', { cwd: root, env, windowsHide: true, shell: true })
						: spawn('vercel', ['env', 'pull', '.env.local', '--yes'], { cwd: root, env });
					const timer = setTimeout(() => proc.kill(), 60000);
					proc.on('error', () => { clearTimeout(timer); resolve(); });
					proc.on('close', () => { clearTimeout(timer); resolve(); });
				});
				this.busy = undefined;
				await this.refresh();
				break;
			}
			case 'vercel':
				await vscode.commands.executeCommand('orbit.vercel.show');
				break;
			case 'hide':
				await vscode.workspace.getConfiguration('orbit').update('env.hideFromAgent', !!msg.on, vscode.ConfigurationTarget.Global);
				this.post({ type: 'toast', text: msg.on ? 'Les agents lancés à partir de maintenant ne peuvent plus lire ces fichiers' : 'Les agents lancés à partir de maintenant peuvent lire ces fichiers' });
				this.send();
				break;
		}
	}
}
