/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CODEX_TERMINAL_MARK } from './config';

/** What a Codex conversation log line means for Orbit, in the shape of the hook events Orbit already understands. */
export interface AgentEvent {
	hook_event_name: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Notification' | 'Stop';
	session_id?: string;
	transcript_path?: string;
	cwd?: string;
	prompt?: string;
	tool_name?: string;
	tool_input?: unknown;
	message?: string;
	notification_type?: string;
}

interface Followed {
	file: string;
	key: string;
	offset: number;
	cwd?: string;
	session?: string;
	/** Tool calls in flight, by call id, to name the tool again when its result arrives. */
	calls: Map<string, { name: string; input: unknown }>;
}

const SCAN_MS = 1500;
const HEAD_BYTES = 256 * 1024;

/**
 * Follows the agents when the assistant is ChatGPT. Codex writes every session to a log
 * (`~/.codex/sessions/<date>/rollout-….jsonl`); Orbit reads those logs as they grow and turns
 * them into the same events Claude Code's hooks send. Nothing is installed in Codex and nothing
 * has to be approved by the user: the logs are only read.
 */
export class CodexTracker implements vscode.Disposable {

	private readonly followed = new Map<string, Followed>();
	/** Logs that belong to no Orbit terminal (Codex used elsewhere): looked at once, then left alone. */
	private readonly foreign = new Set<string>();
	/** Terminals waiting for their log to appear: key → where and when they started. */
	private readonly expected = new Map<string, { cwd: string; at: number }>();
	private readonly timer: NodeJS.Timeout;
	private readonly startedAt = Date.now();

	/**
	 * @param emit receives the events of a terminal's session
	 * @param owns tells whether a terminal id belongs to this window: logs of other windows, of
	 * closed terminals and of Codex used outside Orbit are never replayed here
	 */
	constructor(private readonly emit: (key: string, event: AgentEvent) => void, private readonly owns: (key: string) => boolean) {
		this.timer = setInterval(() => this.scan(), SCAN_MS);
	}

	dispose(): void {
		clearInterval(this.timer);
	}

	/** A terminal has just started Codex: its log will show up in a moment. */
	expect(key: string, cwd: string): void {
		this.expected.set(key, { cwd, at: Date.now() });
	}

	transcriptOf(key: string): string | undefined {
		return [...this.followed.values()].find(f => f.key === key)?.file;
	}

	private sessionsDir(): string {
		return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
	}

	/** Today's and yesterday's folders are enough: a session log lives in the day it started. */
	private recentLogs(): string[] {
		const out: string[] = [];
		for (const day of [new Date(), new Date(Date.now() - 24 * 3600 * 1000)]) {
			const dir = path.join(this.sessionsDir(), String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
			try {
				for (const name of fs.readdirSync(dir)) {
					if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
						out.push(path.join(dir, name));
					}
				}
			} catch {
				// no session that day
			}
		}
		return out;
	}

	private scan(): void {
		for (const file of this.recentLogs()) {
			if (this.foreign.has(file)) {
				continue;
			}
			let followed = this.followed.get(file);
			if (!followed) {
				const key = this.owner(file);
				if (key === undefined) {
					continue; // too early to tell, look again
				}
				if (!key) {
					this.foreign.add(file);
					continue;
				}
				if (!this.owns(key)) {
					this.foreign.add(file);
					continue;
				}
				// A session that began before this window (a terminal revived after a reload) is followed
				// from now on: what it did earlier is history, not news.
				let offset = 0;
				try {
					const stat = fs.statSync(file);
					if ((stat.birthtimeMs || stat.mtimeMs) < this.startedAt - 5000) {
						offset = stat.size;
					}
				} catch {
					continue;
				}
				followed = { file, key, offset, calls: new Map() };
				this.followed.set(file, followed);
				this.expected.delete(key);
			}
			this.read(followed);
		}
	}

	/** Which terminal a log belongs to: its key, '' for none, undefined when the log is still too short to say. */
	private owner(file: string): string | undefined {
		let head: string;
		let created: number;
		try {
			const stat = fs.statSync(file);
			created = stat.birthtimeMs || stat.mtimeMs;
			const fd = fs.openSync(file, 'r');
			const buffer = Buffer.alloc(Math.min(stat.size, HEAD_BYTES));
			fs.readSync(fd, buffer, 0, buffer.length, 0);
			fs.closeSync(fd);
			head = buffer.toString('utf8');
		} catch {
			return undefined;
		}
		// Orbit writes the terminal's id in the instructions of every Codex it starts.
		const marked = head.match(new RegExp(`${CODEX_TERMINAL_MARK}([A-Za-z0-9-]+)`));
		if (marked) {
			return marked[1];
		}
		if (created < this.startedAt - 5000) {
			return ''; // from before this window: not ours to follow
		}
		// No marker (a terminal opened from the profile menu): the terminal started in that folder just before.
		const cwd = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\\\/g, '\\');
		if (!cwd) {
			return head.length > 4000 ? '' : undefined;
		}
		const candidate = [...this.expected].filter(([, e]) => samePath(e.cwd, cwd) && created >= e.at - 2000).sort((a, b) => a[1].at - b[1].at)[0];
		return candidate ? candidate[0] : (Date.now() - created > 20000 ? '' : undefined);
	}

	private read(followed: Followed): void {
		let size: number;
		try {
			size = fs.statSync(followed.file).size;
		} catch {
			return;
		}
		if (size <= followed.offset) {
			return;
		}
		let text: string;
		try {
			const fd = fs.openSync(followed.file, 'r');
			const buffer = Buffer.alloc(size - followed.offset);
			fs.readSync(fd, buffer, 0, buffer.length, followed.offset);
			fs.closeSync(fd);
			text = buffer.toString('utf8');
		} catch {
			return;
		}
		const end = text.lastIndexOf('\n');
		if (end < 0) {
			return;
		}
		followed.offset += Buffer.byteLength(text.slice(0, end + 1));
		for (const line of text.slice(0, end).split('\n')) {
			if (!line.trim()) {
				continue;
			}
			try {
				this.translate(followed, JSON.parse(line));
			} catch {
				// partial or foreign line
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private translate(followed: Followed, entry: any): void {
		const payload = entry.payload ?? {};
		const base = { session_id: followed.session, transcript_path: followed.file, cwd: followed.cwd };
		const send = (event: Omit<AgentEvent, 'session_id' | 'transcript_path' | 'cwd'>) => this.emit(followed.key, { ...base, ...event });
		if (entry.type === 'session_meta') {
			followed.session = payload.session_id ?? payload.id;
			followed.cwd = payload.cwd;
			this.emit(followed.key, { hook_event_name: 'SessionStart', session_id: followed.session, transcript_path: followed.file, cwd: followed.cwd });
			return;
		}
		if (entry.type === 'event_msg') {
			switch (payload.type) {
				case 'item_completed':
					if (payload.item?.type === 'UserMessage') {
						const prompt = (payload.item.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n');
						send({ hook_event_name: 'UserPromptSubmit', prompt });
					}
					break;
				case 'task_complete':
				case 'turn_aborted':
					send({ hook_event_name: 'Stop' });
					break;
				case 'exec_approval_request':
				case 'apply_patch_approval_request':
				case 'request_permissions':
				case 'elicitation_request':
					send({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'ChatGPT attend ton accord' });
					break;
			}
			return;
		}
		if (entry.type === 'response_item') {
			if (payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'local_shell_call') {
				const call = toolOf(payload);
				followed.calls.set(String(payload.call_id ?? payload.id ?? ''), call);
				send({ hook_event_name: 'PreToolUse', tool_name: call.name, tool_input: call.input });
			} else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output' || payload.type === 'local_shell_call_output') {
				const id = String(payload.call_id ?? '');
				const call = followed.calls.get(id) ?? { name: 'Bash', input: {} };
				followed.calls.delete(id);
				send({ hook_event_name: 'PostToolUse', tool_name: call.name, tool_input: call.input });
			}
		}
	}
}

/**
 * Whether the Codex session started in a terminal has finished a turn, read straight from its
 * log: the night queue asks this itself, so a task is settled even if an event was missed.
 */
export function codexTurnEnded(terminalKey: string, since: number): { file: string; ended: boolean } | undefined {
	const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
	for (const day of [new Date(), new Date(Date.now() - 24 * 3600 * 1000)]) {
		const dir = path.join(root, String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
		let names: string[] = [];
		try {
			names = fs.readdirSync(dir).filter(n => n.startsWith('rollout-') && n.endsWith('.jsonl'));
		} catch {
			continue;
		}
		for (const name of names) {
			const file = path.join(dir, name);
			try {
				if (fs.statSync(file).mtimeMs < since - 5000) {
					continue;
				}
				const text = fs.readFileSync(file, 'utf8');
				if (text.includes(`${CODEX_TERMINAL_MARK}${terminalKey}`)) {
					return { file, ended: /"type":"(task_complete|turn_aborted)"/.test(text) };
				}
			} catch {
				// being written: the next look will read it
			}
		}
	}
	return undefined;
}

/**
 * A Codex tool call, renamed to what the rest of Orbit knows from Claude Code (Read, Edit, Write,
 * Bash) so file traces, the collision radar and "follow the agent" keep working unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toolOf(payload: any): { name: string; input: unknown } {
	const name = String(payload.name ?? payload.type ?? 'tool');
	let args: unknown = payload.arguments ?? payload.input ?? payload.action;
	if (typeof args === 'string') {
		try {
			args = JSON.parse(args);
		} catch {
			// free-form input (a patch, a script): keep the text
		}
	}
	const text = typeof args === 'string' ? args : JSON.stringify(args ?? '');
	// apply_patch names the files it touches in its own header lines. In serialised arguments the
	// line breaks and the backslashes of Windows paths are escaped: undo that before reading the path.
	const plain = (typeof args === 'string' ? args : text).replace(/(?:\\r)?\\n/g, '\n').replace(/\\\\/g, '\\');
	const patched = plain.match(/\*\*\* (Add|Update|Delete) File: ([^\n"]+)/);
	if (name === 'apply_patch' || patched) {
		return { name: patched?.[1] === 'Add' ? 'Write' : 'Edit', input: { file_path: patched?.[2]?.trim() } };
	}
	const command = typeof args === 'object' && args !== null ? (args as { command?: unknown; cmd?: unknown }).command ?? (args as { cmd?: unknown }).cmd : undefined;
	const line = Array.isArray(command) ? command.join(' ') : typeof command === 'string' ? command : text;
	if (/^mcp__|__/.test(name) && !/^(shell|exec|container)/.test(name)) {
		return { name, input: args };
	}
	return { name: 'Bash', input: { command: line.slice(0, 2000) } };
}

function samePath(a: string, b: string): boolean {
	const clean = (p: string) => path.normalize(p).replace(/[\\/]+$/, '');
	return process.platform === 'win32' ? clean(a).toLowerCase() === clean(b).toLowerCase() : clean(a) === clean(b);
}
