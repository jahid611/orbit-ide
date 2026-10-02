/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStatus, AgentTracker } from './agentTracker';
import { workspaceRoot } from './config';

const NAMES_KEY = 'orbit.sessionNames';

export interface SessionInfo {
	id: string;
	file: string;
	title: string;
	/** Title chosen by the user, if any. */
	customName?: string;
	firstPrompt: string;
	lastPrompt: string;
	messages: number;
	modified: number;
}

/** Where Claude Code stores the transcripts of a project. */
export function projectSessionsDir(cwd = workspaceRoot()): string {
	return path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
}

/** Strip the context blocks IDE integrations prepend so titles read like what the user typed. */
export function cleanPrompt(text: string): string {
	return text
		.replace(/<(editor_context|attachment|system-reminder|command-[\w-]+|local-command-[\w-]+)[^>]*>[\s\S]*?<\/\1>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Reads Claude Code session transcripts of the current project. */
export class SessionStore {

	private readonly cache = new Map<string, { mtime: number; info: SessionInfo }>();

	constructor(private readonly state: vscode.Memento) { }

	list(): SessionInfo[] {
		const dir = projectSessionsDir();
		let files: string[] = [];
		try {
			files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));
		} catch {
			return [];
		}
		const names = this.names();
		const sessions: SessionInfo[] = [];
		for (const f of files) {
			const file = path.join(dir, f);
			let mtime: number;
			try {
				mtime = fs.statSync(file).mtimeMs;
			} catch {
				continue;
			}
			let info = this.cache.get(file)?.mtime === mtime ? this.cache.get(file)!.info : undefined;
			if (!info) {
				info = parseSession(file, mtime);
				if (!info) {
					continue;
				}
				this.cache.set(file, { mtime, info });
			}
			const customName = names[info.id];
			sessions.push({ ...info, customName, title: customName || info.title });
		}
		return sessions.filter(s => s.messages > 0).sort((a, b) => b.modified - a.modified);
	}

	get(id: string): SessionInfo | undefined {
		return this.list().find(s => s.id === id);
	}

	async rename(id: string, name: string | undefined): Promise<void> {
		const names = { ...this.names() };
		if (name?.trim()) {
			names[id] = name.trim();
		} else {
			delete names[id];
		}
		await this.state.update(NAMES_KEY, names);
	}

	private names(): Record<string, string> {
		return this.state.get<Record<string, string>>(NAMES_KEY, {});
	}
}

function parseSession(file: string, modified: number): SessionInfo | undefined {
	let text: string;
	try {
		const stat = fs.statSync(file);
		if (stat.size > 40 * 1024 * 1024) {
			return undefined; // pathological transcript, skip rather than freeze
		}
		text = fs.readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}
	let aiTitle = '';
	let customTitle = '';
	let firstPrompt = '';
	let lastPrompt = '';
	let messages = 0;
	for (const line of text.split('\n')) {
		if (!line) {
			continue;
		}
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		switch (entry.type) {
			case 'ai-title':
				aiTitle = entry.aiTitle || aiTitle;
				break;
			case 'custom-title':
				customTitle = entry.customTitle || entry.title || customTitle;
				break;
			case 'assistant':
				messages++;
				break;
			case 'user': {
				if (entry.isMeta || entry.isSidechain) {
					break;
				}
				const content = entry.message?.content;
				const prompt = typeof content === 'string' ? content : Array.isArray(content) && content.every((b: { type: string }) => b.type === 'text') ? content.map((b: { text: string }) => b.text).join(' ') : '';
				const clean = cleanPrompt(prompt);
				if (clean && !clean.startsWith('/')) {
					firstPrompt ||= clean;
					lastPrompt = clean;
					messages++;
				}
				break;
			}
		}
	}
	const id = path.basename(file, '.jsonl');
	return {
		id,
		file,
		title: customTitle || aiTitle || firstPrompt.slice(0, 70) || 'Discussion sans titre',
		firstPrompt,
		lastPrompt,
		messages,
		modified,
	};
}

type Node = { kind: 'group'; label: string; sessions: SessionInfo[] } | { kind: 'session'; session: SessionInfo };

const STATUS_ICONS: Record<AgentStatus, vscode.ThemeIcon> = {
	running: new vscode.ThemeIcon('loading~spin'),
	waiting: new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('editorWarning.foreground')),
	done: new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed')),
	idle: new vscode.ThemeIcon('sparkle', new vscode.ThemeColor('terminal.ansiMagenta')),
};

/** "Discussions" side bar: every Claude conversation of the project, grouped by day. */
export class SessionsView implements vscode.TreeDataProvider<Node>, vscode.Disposable {

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private readonly disposables: vscode.Disposable[] = [];
	private timer: NodeJS.Timeout | undefined;

	constructor(private readonly store: SessionStore, private readonly tracker: AgentTracker) {
		this.disposables.push(
			tracker.onDidChange(() => this.refreshSoon()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.refreshSoon()),
		);
		try {
			const dir = projectSessionsDir();
			fs.mkdirSync(dir, { recursive: true });
			const watcher = fs.watch(dir, () => this.refreshSoon());
			this.disposables.push({ dispose: () => watcher.close() });
		} catch {
			// ~/.claude not there yet
		}
	}

	refreshSoon(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this._onDidChangeTreeData.fire(), 400);
	}

	getChildren(node?: Node): Node[] {
		if (node?.kind === 'group') {
			return node.sessions.map(session => ({ kind: 'session', session }));
		}
		if (node) {
			return [];
		}
		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const groups: [string, (t: number) => boolean][] = [
			['Aujourd\'hui', t => t >= startOfToday],
			['Hier', t => t >= startOfToday - 86400000],
			['7 derniers jours', t => t >= startOfToday - 7 * 86400000],
			['Ce mois-ci', t => t >= startOfToday - 30 * 86400000],
			['Plus ancien', () => true],
		];
		const buckets = new Map<string, SessionInfo[]>();
		for (const s of this.store.list()) {
			const [label] = groups.find(([, test]) => test(s.modified))!;
			buckets.set(label, [...(buckets.get(label) ?? []), s]);
		}
		return groups.filter(([label]) => buckets.has(label)).map(([label]) => ({ kind: 'group', label, sessions: buckets.get(label)! }));
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.kind === 'group') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
			item.contextValue = 'group';
			return item;
		}
		const s = node.session;
		const live = this.tracker.findBySession(s.id);
		const item = new vscode.TreeItem(s.title, vscode.TreeItemCollapsibleState.None);
		item.id = s.id;
		item.description = live ? liveLabel(live.status) : timeAgo(s.modified);
		item.iconPath = live ? STATUS_ICONS[live.status] : new vscode.ThemeIcon('comment-discussion');
		item.tooltip = new vscode.MarkdownString(`**${escapeMd(s.title)}**\n\n${s.messages} messages · ${new Date(s.modified).toLocaleString()}\n\n_Dernier message :_ ${escapeMd(s.lastPrompt.slice(0, 300))}`);
		item.contextValue = live ? 'session.live' : 'session';
		item.command = { command: 'orbit.sessions.open', title: 'Ouvrir', arguments: [s.id] };
		return item;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this._onDidChangeTreeData.dispose();
	}
}

function liveLabel(status: AgentStatus): string {
	switch (status) {
		case 'running': return 'en cours…';
		case 'waiting': return 'attend ton accord';
		case 'done': return 'terminé ✓';
		default: return 'ouverte';
	}
}

export function timeAgo(t: number): string {
	const s = Math.round((Date.now() - t) / 1000);
	if (s < 60) { return 'à l\'instant'; }
	if (s < 3600) { return `il y a ${Math.round(s / 60)} min`; }
	if (s < 86400) { return `il y a ${Math.round(s / 3600)} h`; }
	if (s < 7 * 86400) { return `il y a ${Math.round(s / 86400)} j`; }
	return new Date(t).toLocaleDateString();
}

function escapeMd(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
