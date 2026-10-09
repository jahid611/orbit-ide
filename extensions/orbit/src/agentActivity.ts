/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { AgentStatus, AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';

/** How long a file an agent only read stays marked. */
const READ_TTL_MS = 25 * 1000;
/** Writes stay marked for the whole turn; this only bounds turns that never report their end. */
const WRITE_TTL_MS = 20 * 60 * 1000;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read']);

/** First letter of an agent's name, for explorer badges ("Design accueil" → "D"). */
function initial(name: string): string {
	return name.replace(/^Claude\b\s*/i, '').match(/\p{L}|\d/u)?.[0]?.toUpperCase() ?? 'C';
}

export interface FileTouch {
	file: string;
	mode: 'read' | 'write';
	at: number;
}

export interface AgentSnapshot {
	key: string;
	name: string;
	role?: string;
	icon?: string;
	lead?: boolean;
	color: string;
	status: AgentStatus;
	tool?: string;
	prompt?: string;
	turnStartedAt?: number;
	files: { file: string; name: string; relative: string; mode: 'read' | 'write'; at: number }[];
}

export interface Collision {
	file: string;
	relative: string;
	agents: string[];
}

/**
 * Mission control for several agents at once: remembers which files each agent reads and
 * writes during its turn, paints that in the explorer, and raises the alarm when two agents
 * write the same file, which is how parallel agents silently destroy each other's work.
 */
export class AgentActivity implements vscode.FileDecorationProvider, vscode.Disposable {

	/** agent key -> normalised file path -> touch */
	private readonly touches = new Map<string, Map<string, FileTouch>>();
	private readonly turns = new Map<string, number | undefined>();
	private readonly reported = new Set<string>();
	private readonly disposables: vscode.Disposable[] = [];

	private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri[]>();
	readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	/** Fires when agents, their files or collisions change. */
	readonly onDidChange = this._onDidChange.event;

	private roleOf: (key: string) => { role: string; icon: string; lead?: boolean } | undefined = () => undefined;

	constructor(private readonly tracker: AgentTracker, private readonly claude: ClaudeTerminals) {
		const sweep = setInterval(() => this.sweep(), 5000);
		this.disposables.push(
			{ dispose: () => clearInterval(sweep) },
			vscode.window.registerFileDecorationProvider(this),
			tracker.onDidUseTool(event => {
				if (event.phase === 'start') {
					this.record(event.key, event.tool, event.input, event.cwd);
				}
			}),
			tracker.onDidChange(state => {
				// A new prompt starts a new turn: what the agent touched before is history.
				if (state.turnStartedAt !== this.turns.get(state.key)) {
					this.turns.set(state.key, state.turnStartedAt);
					this.clear(state.key);
				}
				this._onDidChange.fire();
			}),
			claude.onDidChange(() => this._onDidChange.fire()),
			claude.onDidClose(key => {
				this.clear(key);
				this.turns.delete(key);
				this._onDidChange.fire();
			}),
		);
	}

	setRoleProvider(provider: (key: string) => { role: string; icon: string; lead?: boolean } | undefined): void {
		this.roleOf = provider;
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (uri.scheme !== 'file') {
			return undefined;
		}
		const id = normalize(uri.fsPath);
		const writers: string[] = [];
		const readers: string[] = [];
		for (const [key, files] of this.touches) {
			const touch = files.get(id);
			if (touch) {
				(touch.mode === 'write' ? writers : readers).push(key);
			}
		}
		if (writers.length > 1) {
			return { badge: '!', color: new vscode.ThemeColor('editorWarning.foreground'), tooltip: `Collision : ${writers.map(k => this.nameOf(k)).join(' et ')} modifient ce fichier`, propagate: true };
		}
		// Badges are text only: the agent's initial, in its colour when it writes, plain when it reads.
		if (writers.length) {
			return { badge: initial(this.nameOf(writers[0])), color: new vscode.ThemeColor(this.colorOf(writers[0])), tooltip: `${this.nameOf(writers[0])} modifie ce fichier`, propagate: true };
		}
		if (readers.length) {
			return { badge: initial(this.nameOf(readers[0])).toLowerCase(), tooltip: `${readers.map(k => this.nameOf(k)).join(', ')} lit ce fichier` };
		}
		return undefined;
	}

	/** Everything the map needs to draw. */
	snapshot(): { agents: AgentSnapshot[]; collisions: Collision[] } {
		const agents = this.claude.list().map(terminal => {
			const key = this.claude.keyOf(terminal) ?? terminal.name;
			const state = this.tracker.get(key);
			const files = [...(this.touches.get(key)?.values() ?? [])].sort((a, b) => b.at - a.at)
				.map(t => ({ file: t.file, name: path.basename(t.file), relative: vscode.workspace.asRelativePath(t.file, false), mode: t.mode, at: t.at }));
			const role = this.roleOf(key);
			return {
				key,
				name: terminal.name,
				role: role?.role,
				icon: role?.icon,
				lead: role?.lead,
				color: this.claude.colorOf(terminal),
				status: state?.status ?? 'idle',
				tool: state?.status === 'running' ? state.tool?.name : undefined,
				prompt: state?.prompt,
				turnStartedAt: state?.status === 'running' || state?.status === 'waiting' ? state.turnStartedAt : undefined,
				files,
			};
		});
		return { agents, collisions: this.collisions() };
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this._onDidChangeFileDecorations.dispose();
		this._onDidChange.dispose();
	}

	private record(key: string, tool: string, input: unknown, cwd: string | undefined): void {
		const mode = WRITE_TOOLS.has(tool) ? 'write' : READ_TOOLS.has(tool) ? 'read' : undefined;
		const raw = (input as { file_path?: unknown; notebook_path?: unknown } | undefined);
		const target = typeof raw?.file_path === 'string' ? raw.file_path : typeof raw?.notebook_path === 'string' ? raw.notebook_path : undefined;
		if (!mode || !target) {
			return;
		}
		const file = path.isAbsolute(target) ? path.normalize(target) : path.join(cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', target);
		const id = normalize(file);
		let files = this.touches.get(key);
		if (!files) {
			this.touches.set(key, files = new Map());
		}
		// Reading a file an agent already wrote must not downgrade its mark.
		if (mode === 'read' && files.get(id)?.mode === 'write') {
			return;
		}
		files.set(id, { file, mode, at: Date.now() });
		this.changed([file]);
		if (mode === 'write') {
			this.checkCollision(id, file);
		}
	}

	private checkCollision(id: string, file: string): void {
		const writers = [...this.touches].filter(([, files]) => files.get(id)?.mode === 'write').map(([key]) => key).sort();
		const signature = `${id}|${writers.join('|')}`;
		if (writers.length < 2 || this.reported.has(signature)) {
			return;
		}
		this.reported.add(signature);
		const names = writers.map(k => this.nameOf(k));
		vscode.window.showWarningMessage(
			`Collision : ${names.join(' et ')} modifient tous les deux ${vscode.workspace.asRelativePath(file, false)}. L'un risque d'écraser le travail de l'autre.`,
			...names.map(n => `Voir ${n}`), 'Ouvrir le fichier',
		).then(choice => {
			if (choice === 'Ouvrir le fichier') {
				vscode.window.showTextDocument(vscode.Uri.file(file));
			} else if (choice) {
				this.claude.byKey(writers[names.findIndex(n => `Voir ${n}` === choice)])?.show();
			}
		});
	}

	private collisions(): Collision[] {
		const writers = new Map<string, { file: string; agents: string[] }>();
		for (const [key, files] of this.touches) {
			for (const [id, touch] of files) {
				if (touch.mode === 'write') {
					const entry = writers.get(id) ?? { file: touch.file, agents: [] };
					entry.agents.push(key);
					writers.set(id, entry);
				}
			}
		}
		return [...writers.values()].filter(w => w.agents.length > 1)
			.map(w => ({ file: w.file, relative: vscode.workspace.asRelativePath(w.file, false), agents: w.agents }));
	}

	private clear(key: string): void {
		const files = this.touches.get(key);
		if (!files?.size) {
			return;
		}
		this.touches.delete(key);
		for (const signature of [...this.reported]) {
			if (signature.split('|').includes(key)) {
				this.reported.delete(signature);
			}
		}
		this.changed([...files.values()].map(t => t.file));
	}

	private sweep(): void {
		const now = Date.now();
		const expired: string[] = [];
		for (const files of this.touches.values()) {
			for (const [id, touch] of files) {
				if (now - touch.at > (touch.mode === 'read' ? READ_TTL_MS : WRITE_TTL_MS)) {
					files.delete(id);
					expired.push(touch.file);
				}
			}
		}
		if (expired.length) {
			this.changed(expired);
		}
	}

	private changed(files: string[]): void {
		// Parent folders carry the propagated badge, so refresh them too.
		const uris = new Map<string, vscode.Uri>();
		const roots = (vscode.workspace.workspaceFolders ?? []).map(f => normalize(f.uri.fsPath));
		for (const file of files) {
			let current = file;
			for (let depth = 0; depth < 12; depth++) {
				uris.set(normalize(current), vscode.Uri.file(current));
				const parent = path.dirname(current);
				if (parent === current || roots.includes(normalize(current))) {
					break;
				}
				current = parent;
			}
		}
		this._onDidChangeFileDecorations.fire([...uris.values()]);
		this._onDidChange.fire();
	}

	private nameOf(key: string): string {
		return this.claude.byKey(key)?.name ?? 'Claude';
	}

	private colorOf(key: string): string {
		const terminal = this.claude.byKey(key);
		return terminal ? this.claude.colorOf(terminal) : 'terminal.ansiMagenta';
	}
}

function normalize(file: string): string {
	const normal = path.normalize(file);
	return process.platform === 'win32' ? normal.toLowerCase() : normal;
}
