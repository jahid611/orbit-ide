/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AddressInfo } from 'net';
import { AgentTracker, ORBIT_DIR } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';

const execFileAsync = promisify(execFile);
const REGISTRY = path.join(ORBIT_DIR, 'control');
/** Set at activation: one file per Orbit build (installed, dev…), each pointing at its own server script. */
let mcpConfigFile: string | undefined;

/** View name (as Claude asks for it) → command that shows it. */
const VIEWS: Record<string, string> = {
	explorer: 'workbench.view.explorer',
	search: 'workbench.view.search',
	git: 'workbench.view.scm',
	terminal: 'workbench.action.terminal.focus',
	problems: 'workbench.actions.view.problems',
	extensions: 'workbench.view.extensions',
	settings: 'workbench.action.openSettings',
	map: 'orbit.map.show',
	team: 'orbit.team.focus',
	timeline: 'orbit.timeline.focus',
	database: 'orbit.database.show',
	preview: 'orbit.preview.show',
	unity: 'orbit.unity.show',
	community: 'orbit.community.show',
	higgsfield: 'orbit.higgsfield.show',
	usage: 'orbit.usage.show',
	studio: 'orbit.openStudio',
	chat: 'orbit.chat.toggle',
	tutorial: 'orbit.tutorial',
	vercel: 'orbit.vercel.show',
	queue: 'orbit.queue.show',
	env: 'orbit.env.show',
	board: 'orbit.board.show',
	visual: 'orbit.visual.show',
	store: 'orbit.store.show',
	figma: 'orbit.figma.show',
	supabase: 'orbit.supabase.show',
	stripe: 'orbit.stripe.show',
};

/** What the task board and the variables page let an agent do, through its `board_*` and `env_*` tools. */
export interface AgentDesk {
	boardList(): unknown;
	boardAdd(title: string, detail: string): unknown;
	boardTake(id: string | undefined, terminal: string | undefined): unknown;
	boardMove(id: string, column: string, summary: string | undefined): unknown;
	envNames(): unknown;
	envAsk(key: string, why: string): void;
	supabaseState(): Promise<unknown>;
	supabaseSql(query: string, file: string | undefined, write: boolean): Promise<unknown>;
	supabaseAuthUrls(add: string[]): Promise<unknown>;
}

/** The MCP configuration every Claude started by Orbit receives (`orbit` tools). */
export function controlMcpConfig(): string | undefined {
	return mcpConfigFile && fs.existsSync(mcpConfigFile) ? mcpConfigFile : undefined;
}

/** `~/.orbit/mcp/<name>-<hash of the extension folder>.json`: an installed Orbit and a dev build never share it. */
export function mcpConfigPath(name: string, extensionPath: string): string {
	const id = createHash('sha1').update(process.platform === 'win32' ? extensionPath.toLowerCase() : extensionPath).digest('hex').slice(0, 10);
	return path.join(ORBIT_DIR, 'mcp', `${name}-${id}.json`);
}

/**
 * Claude drives Orbit: every Claude terminal gets the `orbit` MCP tools (show a folder in the
 * explorer, switch project, open files and views, run any command). This window serves them
 * on 127.0.0.1 and registers itself in ~/.orbit/control so the tools find it again after an
 * extension host restart.
 */
export class OrbitControl implements vscode.Disposable {

	/** Set once the pages exist: they are created after this server. */
	desk: AgentDesk | undefined;
	private readonly server = http.createServer((req, res) => this.handle(req, res));
	private readonly token = randomBytes(24).toString('hex');
	private readonly entry = path.join(REGISTRY, `${process.pid}.json`);
	private port = 0;
	private focusedAt = Date.now();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(extensionPath: string, private readonly claude: ClaudeTerminals, private readonly tracker: AgentTracker) {
		const file = mcpConfigFile = mcpConfigPath('orbit-control', extensionPath);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const config = JSON.stringify({
			mcpServers: {
				orbit: {
					type: 'stdio',
					command: process.execPath,
					args: [path.join(extensionPath, 'control', 'control-mcp.js')],
					env: { ELECTRON_RUN_AS_NODE: '1' },
				},
			},
		}, null, 2);
		try {
			if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== config) {
				fs.writeFileSync(file, config);
			}
		} catch (err) {
			console.error('[orbit] could not write the control MCP config', err);
		}
		this.server.listen(0, '127.0.0.1', () => {
			this.port = (this.server.address() as AddressInfo).port;
			this.register();
		});
		this.disposables.push(
			vscode.window.onDidChangeWindowState(state => {
				if (state.focused) {
					this.focusedAt = Date.now();
					this.register();
				}
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.register()),
			claude.onDidChange(() => this.register()),
		);
	}

	dispose(): void {
		this.server.close();
		try {
			fs.unlinkSync(this.entry);
		} catch {
			// already gone
		}
		this.disposables.forEach(d => d.dispose());
	}

	private register(): void {
		if (!this.port) {
			return;
		}
		const entry = {
			pid: process.pid,
			url: `http://127.0.0.1:${this.port}`,
			token: this.token,
			focusedAt: this.focusedAt,
			folders: (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
			terminals: this.claude.list().map(t => this.claude.keyOf(t)).filter(Boolean),
		};
		try {
			fs.mkdirSync(REGISTRY, { recursive: true });
			fs.writeFileSync(this.entry, JSON.stringify(entry));
		} catch (err) {
			console.error('[orbit] could not register the control server', err);
		}
	}

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url ?? '/', 'http://x');
		const q = Object.fromEntries(url.searchParams);
		const reply = (status: number, body: unknown) => {
			res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify(body ?? { ok: true }));
		};
		if (q.token !== this.token) {
			return reply(403, { error: 'bad token' });
		}
		try {
			switch (url.pathname) {
				case '/state': return reply(200, this.state());
				case '/show_folder': return reply(200, await this.showFolder(resolvePath(q.path, q.cwd), q.mode, q.create === 'true'));
				case '/open_project': return reply(200, await this.openProject(resolvePath(q.path, q.cwd), q));
				case '/open_file': return reply(200, await this.openFile(resolvePath(q.path, q.cwd), q));
				case '/show_view': {
					const command = VIEWS[q.view];
					if (!command) {
						throw new Error(`Vue inconnue « ${q.view} ». Vues : ${Object.keys(VIEWS).join(', ')}`);
					}
					await vscode.commands.executeCommand(command);
					return reply(200, { ok: true });
				}
				case '/open_url': return reply(200, await this.openUrl(q.url, q.external === 'true'));
				case '/new_claude': {
					const cwd = q.path ? resolvePath(q.path, q.cwd) : undefined;
					const terminal = this.claude.create({ cwd, label: q.name || undefined, flags: q.prompt ? [q.prompt] : [], preserveFocus: q.focus !== 'true' });
					return reply(200, { ok: true, name: terminal.name });
				}
				case '/notify': {
					const show = q.level === 'error' ? vscode.window.showErrorMessage : q.level === 'warning' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
					show(String(q.message ?? ''));
					return reply(200, { ok: true });
				}
				case '/run_command': {
					const args = toArgs(JSON.parse(q.args || '[]'));
					const result = await vscode.commands.executeCommand(String(q.command), ...args);
					return reply(200, { ok: true, result: summarize(result) });
				}
				case '/board_list': return reply(200, this.desk?.boardList());
				case '/board_add': return reply(200, this.desk?.boardAdd(String(q.title ?? ''), String(q.detail ?? '')));
				case '/board_take': return reply(200, this.desk?.boardTake(q.id || undefined, q.terminal || undefined));
				case '/board_move': return reply(200, this.desk?.boardMove(String(q.id ?? ''), String(q.column ?? ''), q.summary || undefined));
				case '/env_names': return reply(200, this.desk?.envNames());
				case '/env_ask':
					this.desk?.envAsk(String(q.key ?? ''), String(q.why ?? ''));
					return reply(200, { ok: true, note: 'La demande est affichée à l\'utilisateur. Continue avec le nom de la variable.' });
				case '/supabase_state': return reply(200, await this.desk?.supabaseState());
				case '/supabase_sql': return reply(200, await this.desk?.supabaseSql(String(q.query ?? ''), q.file ? resolvePath(q.file, q.cwd) : undefined, q.write === 'true'));
				case '/supabase_auth_urls': return reply(200, await this.desk?.supabaseAuthUrls(JSON.parse(q.add || '[]')));
				case '/find_commands': {
					const words = String(q.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
					const all = await vscode.commands.getCommands(true);
					return reply(200, all.filter(c => words.every(w => c.toLowerCase().includes(w))).slice(0, 80));
				}
				default: return reply(404, { error: `unknown route ${url.pathname}` });
			}
		} catch (err) {
			return reply(400, { error: err instanceof Error ? err.message : String(err) });
		}
	}

	private state(): unknown {
		const editor = vscode.window.activeTextEditor;
		return {
			explorerFolders: (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
			activeFile: editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined,
			selection: editor && !editor.selection.isEmpty ? { startLine: editor.selection.start.line + 1, endLine: editor.selection.end.line + 1, text: editor.document.getText(editor.selection).slice(0, 2000) } : undefined,
			openEditors: vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => t.input instanceof vscode.TabInputText ? t.input.uri.fsPath : t.label),
			claudeTerminals: this.claude.list().map(t => ({ name: t.name, folder: this.claude.cwdOf(t), status: this.tracker.get(this.claude.keyOf(t))?.status ?? 'idle', current: t === this.claude.current() })),
		};
	}

	/** Change what the explorer shows, without reloading the window (terminals keep running). */
	private async showFolder(dir: string, mode = 'replace', create = false): Promise<unknown> {
		if (!fs.existsSync(dir)) {
			if (!create) {
				throw new Error(`${dir} n'existe pas (create=true pour le créer)`);
			}
			await fs.promises.mkdir(dir, { recursive: true });
		}
		if (!fs.statSync(dir).isDirectory()) {
			dir = path.dirname(dir);
		}
		const folders = vscode.workspace.workspaceFolders ?? [];
		const index = folders.findIndex(f => samePath(f.uri.fsPath, dir));
		const uri = vscode.Uri.file(dir);
		// Answer first: changing the first folder restarts Orbit's extensions, this server included.
		setTimeout(() => {
			if (mode === 'remove') {
				if (index >= 0) {
					vscode.workspace.updateWorkspaceFolders(index, 1);
				}
			} else if (mode === 'add') {
				if (index < 0) {
					vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri });
				}
			} else if (!(folders.length === 1 && index === 0)) {
				vscode.workspace.updateWorkspaceFolders(0, folders.length, { uri });
			}
			vscode.commands.executeCommand('workbench.view.explorer').then(undefined, () => undefined);
		}, 150);
		return { ok: true, explorer: mode === 'remove' ? folders.filter((_, i) => i !== index).map(f => f.uri.fsPath) : mode === 'add' ? [...folders.map(f => f.uri.fsPath), ...(index < 0 ? [dir] : [])] : [dir] };
	}

	private async openProject(dir: string, q: Record<string, string>): Promise<unknown> {
		if (!fs.existsSync(dir)) {
			if (q.create !== 'true') {
				throw new Error(`${dir} n'existe pas (create=true pour le créer)`);
			}
			await fs.promises.mkdir(dir, { recursive: true });
			try {
				await execFileAsync('git', ['init', '-q'], { cwd: dir });
			} catch {
				// git is optional
			}
		}
		// The agent may say where; when it does not, the user is asked, as for any other way of opening a project.
		const where = q.newWindow === 'true' ? 'new' : q.newWindow === 'false' ? 'replace' : await this.claude.chooseWindow(dir);
		if (!where) {
			throw new Error('L\'utilisateur a annulé l\'ouverture du projet.');
		}
		const newWindow = where === 'new';
		await this.claude.prepareLaunch(dir, q.prompt || undefined);
		// Let the tool answer reach Claude before the window changes.
		setTimeout(() => {
			vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), newWindow ? { forceNewWindow: true } : { forceReuseWindow: true });
		}, newWindow ? 300 : 2000);
		return {
			ok: true,
			message: newWindow
				? `Une nouvelle fenêtre Orbit s'ouvre sur ${dir}, avec un Claude prêt${q.prompt ? ' qui a reçu ta consigne' : ''}.`
				: `Orbit bascule sur ${dir} dans 2 s : les terminaux de cette fenêtre (toi compris) vont se fermer, un nouveau Claude démarre dans le projet${q.prompt ? ' avec ta consigne' : ''}. Ne lance plus rien.`,
		};
	}

	private async openFile(file: string, q: Record<string, string>): Promise<unknown> {
		if (!fs.existsSync(file)) {
			throw new Error(`${file} n'existe pas`);
		}
		if (!inWorkspace(file)) {
			// A file outside the explorer: show its project next to the open folders.
			const root = projectRoot(file) ?? path.dirname(file);
			const folders = vscode.workspace.workspaceFolders ?? [];
			vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(root) });
		}
		// A line that is not a number is ignored rather than turned into NaN.
		const asLine = (value: string | undefined) => {
			const n = Number(value);
			return value && Number.isFinite(n) ? Math.max(0, Math.floor(n) - 1) : undefined;
		};
		const line = asLine(q.line);
		const endLine = asLine(q.endLine);
		const end = Math.max(line ?? 0, endLine ?? line ?? 0);
		// A document, a picture, a video, a montage: opened the way a click in the explorer would,
		// in the viewer made for it. As text, it would be pages of unreadable characters.
		if (/\.(pdf|pptx|ppsx|potx|png|jpe?g|gif|webp|avif|bmp|ico|mp4|mov|m4v|webm|mkv|avi|mp3|wav|ogg|flac|starcapture|ttf|otf|ttc|woff2?)$/i.test(file)) {
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file), { preview: false, preserveFocus: true, viewColumn: q.side === 'true' ? vscode.ViewColumn.Beside : vscode.ViewColumn.One });
			await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(file)).then(undefined, () => undefined);
			return { ok: true };
		}
		const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), {
			preview: false,
			preserveFocus: true,
			viewColumn: q.side === 'true' ? vscode.ViewColumn.Beside : vscode.ViewColumn.One,
			selection: line !== undefined ? new vscode.Range(line, 0, end, endLine !== undefined ? Number.MAX_SAFE_INTEGER : 0) : undefined,
		});
		editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(file)).then(undefined, () => undefined);
		return { ok: true };
	}

	private async openUrl(raw: string, external: boolean): Promise<unknown> {
		const url = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
		if (external) {
			await vscode.env.openExternal(vscode.Uri.parse(url));
		} else if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(url)) {
			await vscode.commands.executeCommand('orbit.preview.show', url);
		} else {
			await vscode.commands.executeCommand('simpleBrowser.show', url).then(undefined, () => vscode.env.openExternal(vscode.Uri.parse(url)));
		}
		return { ok: true };
	}
}

/** Markers of a project root, from most to least telling. */
const ROOT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile', 'deno.json', 'requirements.txt', 'ProjectSettings', 'project.godot', 'CMakeLists.txt', 'index.html'];

/** Closest folder above `file` that looks like a project, never the home folder or a drive root. */
export function projectRoot(file: string): string | undefined {
	const home = path.normalize(os.homedir());
	let dir = path.dirname(path.normalize(file));
	while (dir && !samePath(dir, home) && path.dirname(dir) !== dir) {
		if (ROOT_MARKERS.some(m => fs.existsSync(path.join(dir, m)))) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	return undefined;
}

function resolvePath(value: string | undefined, cwd: string | undefined): string {
	const raw = String(value ?? '').trim().replace(/^~(?=$|[\\/])/, os.homedir());
	if (!raw) {
		throw new Error('path est obligatoire');
	}
	return path.normalize(path.isAbsolute(raw) ? raw : path.join(cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(), raw));
}

function samePath(a: string, b: string): boolean {
	const n = (p: string) => path.normalize(p).replace(/[\\/]+$/, '');
	return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}

function inWorkspace(file: string): boolean {
	return (vscode.workspace.workspaceFolders ?? []).some(f => {
		const rel = path.relative(f.uri.fsPath, file);
		return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
	});
}

/** JSON arguments → command arguments; `{"$uri": "path"}` becomes a file Uri. */
function toArgs(value: unknown): unknown[] {
	const convert = (v: unknown): unknown => {
		if (Array.isArray(v)) {
			return v.map(convert);
		}
		if (v && typeof v === 'object') {
			const o = v as Record<string, unknown>;
			if (typeof o.$uri === 'string') {
				return /^[a-z][a-z0-9+.-]+:\/\//i.test(o.$uri) ? vscode.Uri.parse(o.$uri) : vscode.Uri.file(o.$uri);
			}
			return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, convert(x)]));
		}
		return v;
	};
	return Array.isArray(value) ? value.map(convert) : [convert(value)];
}

function summarize(result: unknown): unknown {
	if (result === undefined) {
		return undefined;
	}
	try {
		const text = JSON.stringify(result);
		return text.length > 4000 ? `${text.slice(0, 4000)}…` : result;
	} catch {
		return String(result);
	}
}
