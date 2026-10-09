/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { clipboardImages, saveDataUrl } from './pasteImage';
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
			vscode.window.onDidCloseTerminal(t => {
				if (t !== this.terminal) {
					return;
				}
				// The terminal shown is gone: move on to the one the user is using, if any.
				this.terminal = undefined;
				const next = [claude.current(), ...claude.list().reverse()].find(x => x && x !== t);
				if (next) {
					this.follow(next);
				} else {
					this.load(undefined);
				}
			}),
			claude.onDidChange(() => this.postTerminals()),
			tracker.onDidChange(state => {
				if (this.terminal && state.key === this.keyOf(this.terminal)) {
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
		// Listeners of this view only: freed with it, so reopening the view does not pile them up.
		const listeners: vscode.Disposable[] = [
			view.webview.onDidReceiveMessage(msg => this.onMessage(msg)),
			view.onDidChangeVisibility(() => view.visible && this.sendAll()),
		];
		view.onDidDispose(() => {
			if (this.view === view) {
				this.view = undefined;
			}
			listeners.forEach(d => d.dispose());
		});
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
			case 'pasteImage': {
				// A screenshot pasted in the chat: saved as a file that travels with the message.
				try {
					const file = await saveDataUrl(String(msg.data ?? ''));
					this.view?.webview.postMessage({ type: 'attached', file, name: path.basename(file), id: typeof msg.id === 'string' ? msg.id : undefined });
				} catch (err) {
					vscode.window.showWarningMessage(`Image non collée : ${err instanceof Error ? err.message : String(err)}`);
				}
				break;
			}
			case 'pasteClipboard': {
				// Ctrl+V with nothing the page can read (e.g. image files copied in the file manager).
				for (const file of await clipboardImages()) {
					this.view?.webview.postMessage({ type: 'attached', file, name: path.basename(file) });
				}
				break;
			}
			case 'send': {
				const files = (Array.isArray(msg.files) ? msg.files : []).map(String);
				const text = [String(msg.text ?? '').trim(), ...files.map((f: string) => /\s/.test(f) ? `"${f}"` : f)].filter(Boolean).join(' ');
				if (!text) {
					return;
				}
				const terminal = this.terminal ?? this.claude.current();
				if (!terminal) {
					// A Claude still starting would drop typed text: the message is its first prompt.
					this.follow(this.claude.create({ preserveFocus: true, flags: [text] }));
					break;
				}
				if (!this.terminal) {
					this.follow(terminal);
				}
				this.claude.sendMessage(terminal, text);
				break;
			}
			case 'insert': {
				const code = String(msg.code ?? '');
				const editor = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0];
				if (!editor) {
					await vscode.env.clipboard.writeText(code);
					vscode.window.showInformationMessage('Aucun éditeur ouvert : le code est copié dans le presse-papiers.');
					break;
				}
				await editor.edit(edit => editor.selections.forEach(s => edit.replace(s, code)));
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
				const t = this.claude.list().find(x => terminalId(this.claude, x) === msg.key);
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
					const base = this.tracker.get(this.terminal && this.keyOf(this.terminal))?.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
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
		const state = this.tracker.get(this.keyOf(terminal));
		this.load(state?.transcriptPath ?? this.claude.sessionFileFor(terminal));
	}

	private keyOf(terminal: vscode.Terminal): string | undefined {
		return this.claude.keyOf(terminal);
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
		const buffer = Buffer.alloc(size - this.offset);
		try {
			const fd = fs.openSync(this.transcript, 'r');
			try {
				fs.readSync(fd, buffer, 0, buffer.length, this.offset);
			} finally {
				fs.closeSync(fd);
			}
		} catch {
			return false; // locked while Claude writes (Windows): the next change retries
		}
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
			terminals: this.claude.list().map(t => ({ key: terminalId(this.claude, t), name: t.name })),
			current: this.terminal && terminalId(this.claude, this.terminal),
		});
	}

	private postStatus(): void {
		const state = this.terminal ? this.tracker.get(this.keyOf(this.terminal)) : undefined;
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

/** Identifies a terminal in the page: its key, or its name until an old terminal reports its pid. */
function terminalId(claude: ClaudeTerminals, terminal: vscode.Terminal): string {
	return claude.keyOf(terminal) ?? `name:${terminal.name}`;
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

