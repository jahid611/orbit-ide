/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { cleanPrompt } from './sessions';
import { renderWebview, webviewOptions } from './webview';

type ChatItem =
	| { kind: 'user'; id: string; text: string }
	| { kind: 'assistant'; id: string; text: string }
	| { kind: 'tool'; id: string; name: string; summary: string; input: unknown; result?: string; isError?: boolean; done: boolean };

/**
 * A friendlier skin over a Claude terminal: renders the session transcript as a chat and
 * types what you write into that very terminal. Same session, same process, nicer view.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {

	static readonly viewId = 'orbit.chatView';

	private view: vscode.WebviewView | undefined;
	private terminal: vscode.Terminal | undefined;
	private transcript: string | undefined;
	private items: ChatItem[] = [];
	private offset = 0;
	private fileWatcher: fs.FSWatcher | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly extensionUri: vscode.Uri, private readonly claude: ClaudeTerminals, private readonly tracker: AgentTracker) {
		this.disposables.push(
			vscode.window.onDidChangeActiveTerminal(t => {
				if (t && claude.isClaude(t)) {
					this.follow(t);
				}
			}),
			claude.onDidChange(() => this.postTerminals()),
			tracker.onDidChange(state => {
				if (this.terminal && state.pid === this.pidOf(this.terminal)) {
					if (state.transcriptPath && state.transcriptPath !== this.transcript) {
						this.load(state.transcriptPath);
					} else {
						// The transcript may not have existed when we first looked; hooks are our cue to catch up.
						this.watchTranscript();
						if (this.readMore()) {
							this.post({ type: 'items', items: this.items });
						}
					}
					this.postStatus();
				}
			}),
		);
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = webviewOptions(this.extensionUri);
		view.webview.html = renderWebview(view.webview, this.extensionUri, 'chat');
		view.webview.onDidReceiveMessage(msg => this.onMessage(msg), undefined, this.disposables);
		view.onDidDispose(() => { this.view = undefined; }, undefined, this.disposables);
		view.onDidChangeVisibility(() => view.visible && this.sendAll());
	}

	async show(): Promise<void> {
		const target = this.claude.current();
		if (target) {
			this.follow(target);
		}
		await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
	}

	showTerminal(): void {
		(this.terminal ?? this.claude.current())?.show();
	}

	async toggle(): Promise<void> {
		if (this.view?.visible) {
			this.showTerminal();
		} else {
			await this.show();
		}
	}

	dispose(): void {
		this.fileWatcher?.close();
		this.disposables.forEach(d => d.dispose());
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'ready':
				if (!this.terminal) {
					const t = this.claude.current();
					if (t) {
						this.follow(t);
					}
				}
				this.sendAll();
				break;
			case 'send': {
				const text = String(msg.text ?? '').trim();
				const terminal = this.terminal ?? this.claude.current() ?? this.claude.create({ preserveFocus: true });
				if (!text) {
					return;
				}
				if (!this.terminal) {
					this.follow(terminal);
				}
				// Bracketed paste keeps multi-line messages in one prompt.
				terminal.sendText(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text, false);
				setTimeout(() => terminal.sendText('\r', false), 60);
				break;
			}
			case 'decide': {
				const t = this.terminal;
				if (!t) {
					return;
				}
				if (msg.decision === 'deny') {
					t.sendText('\x1b', false);
				} else {
					if (msg.decision === 'always') {
						t.sendText('2', false);
					}
					setTimeout(() => t.sendText('\r', false), 80);
				}
				break;
			}
			case 'interrupt':
				this.terminal?.sendText('\x1b', false);
				break;
			case 'switch': {
				const t = this.claude.list().find(x => x.name === msg.name);
				if (t) {
					this.follow(t);
				}
				break;
			}
			case 'new':
				this.follow(this.claude.create({ preserveFocus: true }));
				break;
			case 'showTerminal':
				this.showTerminal();
				break;
			case 'openFile':
				if (typeof msg.path === 'string') {
					const base = this.tracker.get(this.terminal && this.pidOf(this.terminal))?.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
					const file = path.isAbsolute(msg.path) ? msg.path : path.join(base, msg.path);
					vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true }).then(undefined, () => undefined);
				}
				break;
		}
	}

	private follow(terminal: vscode.Terminal): void {
		if (this.terminal === terminal) {
			return;
		}
		this.terminal = terminal;
		const state = this.tracker.get(this.pidOf(terminal));
		this.load(state?.transcriptPath ?? this.claude.sessionFileFor(terminal));
	}

	private pidOf(terminal: vscode.Terminal): number | undefined {
		return this.claude.pidOf(terminal);
	}

	private load(transcript: string | undefined): void {
		this.fileWatcher?.close();
		this.fileWatcher = undefined;
		this.transcript = transcript;
		this.items = [];
		this.offset = 0;
		if (transcript) {
			this.readMore();
			this.watchTranscript();
		}
		this.sendAll();
	}

	private watchTranscript(): void {
		if (this.fileWatcher || !this.transcript) {
			return;
		}
		try {
			this.fileWatcher = fs.watch(this.transcript, () => {
				if (this.readMore()) {
					this.post({ type: 'items', items: this.items });
				}
			});
		} catch {
			// transcript not created yet; the next hook event retries
		}
	}

	/** Parse lines appended to the transcript since the last read. Returns true when items changed. */
	private readMore(): boolean {
		if (!this.transcript) {
			return false;
		}
		let size: number;
		try {
			size = fs.statSync(this.transcript).size;
		} catch {
			return false;
		}
		if (size <= this.offset) {
			return false;
		}
		const fd = fs.openSync(this.transcript, 'r');
		const buffer = Buffer.alloc(size - this.offset);
		fs.readSync(fd, buffer, 0, buffer.length, this.offset);
		fs.closeSync(fd);
		const text = buffer.toString('utf8');
		const end = text.lastIndexOf('\n');
		if (end < 0) {
			return false;
		}
		this.offset += Buffer.byteLength(text.slice(0, end + 1));
		let changed = false;
		for (const line of text.slice(0, end).split('\n')) {
			try {
				changed = this.ingest(JSON.parse(line)) || changed;
			} catch {
				// partial line
			}
		}
		if (this.items.length > 400) {
			this.items = this.items.slice(-400);
		}
		return changed;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private ingest(entry: any): boolean {
		if (entry.isSidechain || entry.isMeta) {
			return false;
		}
		const content = entry.message?.content;
		if (entry.type === 'user') {
			if (typeof content === 'string') {
				const text = cleanPrompt(content);
				if (text && !text.startsWith('<')) {
					this.items.push({ kind: 'user', id: entry.uuid, text });
					return true;
				}
				return false;
			}
			let changed = false;
			for (const block of Array.isArray(content) ? content : []) {
				if (block.type === 'text') {
					const text = cleanPrompt(block.text ?? '');
					if (text && !text.startsWith('<') && !text.startsWith('[Request interrupted')) {
						this.items.push({ kind: 'user', id: `${entry.uuid}-${this.items.length}`, text });
						changed = true;
					}
				} else if (block.type === 'tool_result') {
					const tool = this.items.find(i => i.kind === 'tool' && i.id === block.tool_use_id);
					if (tool?.kind === 'tool') {
						tool.done = true;
						tool.isError = !!block.is_error;
						tool.result = resultText(block.content).slice(0, 3000);
						changed = true;
					}
				}
			}
			return changed;
		}
		if (entry.type === 'assistant' && Array.isArray(content)) {
			let changed = false;
			content.forEach((block: { type: string; text?: string; id?: string; name?: string; input?: unknown }, i: number) => {
				if (block.type === 'text' && block.text?.trim()) {
					this.items.push({ kind: 'assistant', id: `${entry.uuid}-${i}`, text: block.text });
					changed = true;
				} else if (block.type === 'tool_use' && block.id && block.name) {
					this.items.push({ kind: 'tool', id: block.id, name: block.name, input: block.input, summary: summarizeTool(block.name, block.input), done: false });
					changed = true;
				}
			});
			return changed;
		}
		return false;
	}

	private sendAll(): void {
		this.postTerminals();
		this.post({ type: 'items', items: this.items, reset: true });
		this.postStatus();
	}

	private postTerminals(): void {
		this.post({
			type: 'terminals',
			terminals: this.claude.list().map(t => t.name),
			current: this.terminal?.name,
		});
	}

	private postStatus(): void {
		const state = this.terminal ? this.tracker.get(this.pidOf(this.terminal)) : undefined;
		this.post({
			type: 'status',
			status: state?.status ?? 'idle',
			pending: state?.status === 'waiting' && state.tool ? { name: state.tool.name, input: state.tool.input, summary: summarizeTool(state.tool.name, state.tool.input), message: state.message } : undefined,
			hasSession: !!this.transcript,
		});
	}

	private post(message: object): void {
		this.view?.webview.postMessage(message);
	}
}

function resultText(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		return content.map(c => (c && typeof c === 'object' && 'text' in c) ? String((c as { text: unknown }).text) : '').join('\n');
	}
	return '';
}

function summarizeTool(name: string, input: unknown): string {
	const i = (input ?? {}) as Record<string, unknown>;
	const file = (p: unknown) => typeof p === 'string' ? vscode.workspace.asRelativePath(p) : '';
	switch (name) {
		case 'Read': return `Lit ${file(i.file_path)}`;
		case 'Write': return `Crée ${file(i.file_path)}`;
		case 'Edit': case 'MultiEdit': return `Modifie ${file(i.file_path)}`;
		case 'Bash': return String(i.description || i.command || 'Commande');
		case 'Glob': return `Cherche des fichiers ${String(i.pattern ?? '')}`;
		case 'Grep': return `Cherche « ${String(i.pattern ?? '')} »`;
		case 'WebSearch': return `Recherche web : ${String(i.query ?? '')}`;
		case 'WebFetch': return `Lit ${String(i.url ?? '')}`;
		case 'Task': case 'Agent': return `Sous-agent : ${String(i.description ?? '')}`;
		case 'TodoWrite': return 'Met à jour sa liste de tâches';
		case 'ExitPlanMode': return 'Propose un plan';
		default: return name;
	}
}

