/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'done';

export interface AgentState {
	/** Process id of the shell hosting `claude`, i.e. `Terminal.processId`. */
	pid: number;
	status: AgentStatus;
	sessionId?: string;
	transcriptPath?: string;
	cwd?: string;
	/** Last tool Claude started, with its input, so a pending permission can be shown. */
	tool?: { name: string; input: unknown };
	message?: string;
	updatedAt: number;
}

export const ORBIT_DIR = path.join(os.homedir(), '.orbit');
const EVENTS_DIR = path.join(ORBIT_DIR, 'agent-events');
const HOOK_SCRIPT = path.join(ORBIT_DIR, 'hook.sh');
export const HOOK_SETTINGS = path.join(ORBIT_DIR, 'claude-settings.json');

const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];

/**
 * Claude Code runs as a plain CLI in our terminals; its hooks tell Orbit what each
 * agent is doing. Every event is appended to `~/.orbit/agent-events/<shell pid>.jsonl`.
 */
const HOOK_SCRIPT_SOURCE = `#!/bin/sh
# Orbit: forwards Claude Code hook events to the IDE. Safe to delete; Orbit recreates it.
d="$HOME/.orbit/agent-events"
mkdir -p "$d"
pid=$PPID
target=$PPID
i=0
while [ $i -lt 5 ] && [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
	case "$(ps -o comm= -p "$pid" 2>/dev/null)" in
		*claude*) target=$(ps -o ppid= -p "$pid" | tr -d ' '); break ;;
	esac
	pid=$(ps -o ppid= -p "$pid" | tr -d ' ')
	i=$((i + 1))
done
{ cat; echo; } >> "$d/$target.jsonl"
exit 0
`;

export class AgentTracker implements vscode.Disposable {

	private readonly states = new Map<number, AgentState>();
	private readonly offsets = new Map<string, number>();
	private watcher: fs.FSWatcher | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	private readonly _onDidChange = new vscode.EventEmitter<AgentState>();
	readonly onDidChange = this._onDidChange.event;

	constructor(private readonly terminalName: (pid: number) => string | undefined, private readonly focusTerminal: (pid: number) => void) {
		installHooks();
		this.scanAll();
		try {
			this.watcher = fs.watch(EVENTS_DIR, (_event, file) => {
				if (file && file.endsWith('.jsonl')) {
					this.readFile(path.join(EVENTS_DIR, file));
				}
			});
		} catch {
			// directory missing: hooks will create it, fall back to polling
		}
		const poll = setInterval(() => this.scanAll(), 4000);
		this.disposables.push({ dispose: () => clearInterval(poll) });
	}

	get(pid: number | undefined): AgentState | undefined {
		return pid === undefined ? undefined : this.states.get(pid);
	}

	all(): AgentState[] {
		return [...this.states.values()];
	}

	findBySession(sessionId: string): AgentState | undefined {
		return this.all().find(s => s.sessionId === sessionId);
	}

	/** Forget a closed terminal and its event log. */
	forget(pid: number): void {
		this.states.delete(pid);
		const file = path.join(EVENTS_DIR, `${pid}.jsonl`);
		this.offsets.delete(file);
		fs.promises.rm(file, { force: true }).catch(() => undefined);
	}

	dispose(): void {
		this.watcher?.close();
		this.disposables.forEach(d => d.dispose());
		this._onDidChange.dispose();
	}

	private scanAll(): void {
		let files: string[] = [];
		try {
			files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.jsonl'));
		} catch {
			return;
		}
		if (!this.watcher) {
			try {
				this.watcher = fs.watch(EVENTS_DIR, (_e, file) => file && this.readFile(path.join(EVENTS_DIR, file)));
			} catch {
				// keep polling
			}
		}
		for (const f of files) {
			this.readFile(path.join(EVENTS_DIR, f));
		}
	}

	private readFile(file: string): void {
		const pid = Number(path.basename(file, '.jsonl'));
		if (!Number.isFinite(pid)) {
			return;
		}
		let size: number;
		try {
			size = fs.statSync(file).size;
		} catch {
			return;
		}
		const from = this.offsets.get(file) ?? 0;
		if (size <= from) {
			if (size < from) {
				this.offsets.set(file, 0);
			}
			return;
		}
		const fd = fs.openSync(file, 'r');
		const buffer = Buffer.alloc(size - from);
		fs.readSync(fd, buffer, 0, buffer.length, from);
		fs.closeSync(fd);
		const text = buffer.toString('utf8');
		const end = text.lastIndexOf('\n');
		if (end < 0) {
			return;
		}
		this.offsets.set(file, from + Buffer.byteLength(text.slice(0, end + 1)));
		const firstRead = from === 0;
		for (const line of text.slice(0, end).split('\n')) {
			if (!line.trim()) {
				continue;
			}
			try {
				this.apply(pid, JSON.parse(line), firstRead);
			} catch {
				// partial or foreign line
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private apply(pid: number, event: any, replaying: boolean): void {
		const prev = this.states.get(pid) ?? { pid, status: 'idle' as AgentStatus, updatedAt: 0 };
		const state: AgentState = {
			...prev,
			sessionId: event.session_id ?? prev.sessionId,
			transcriptPath: event.transcript_path ?? prev.transcriptPath,
			cwd: event.cwd ?? prev.cwd,
			updatedAt: Date.now(),
		};
		switch (event.hook_event_name) {
			case 'SessionStart':
				state.status = 'idle';
				state.tool = undefined;
				break;
			case 'UserPromptSubmit':
				state.status = 'running';
				state.message = undefined;
				break;
			case 'PreToolUse':
				state.status = 'running';
				state.tool = { name: event.tool_name, input: event.tool_input };
				break;
			case 'PostToolUse':
				state.status = 'running';
				break;
			case 'Notification': {
				const message = String(event.message ?? '');
				const permission = event.notification_type === 'permission_prompt' || /permission/i.test(message);
				if (!permission) {
					return; // idle reminders are not interesting
				}
				state.status = 'waiting';
				state.message = message;
				break;
			}
			case 'Stop':
				state.status = 'done';
				state.tool = undefined;
				break;
			case 'SessionEnd':
				state.status = 'idle';
				state.tool = undefined;
				break;
			default:
				return;
		}
		this.states.set(pid, state);
		if (replaying) {
			return; // history from before this window opened: update state silently
		}
		this.render(state, prev.status);
		this._onDidChange.fire(state);
	}

	private render(state: AgentState, previous: AgentStatus): void {
		const name = this.terminalName(state.pid) ?? 'Claude';
		const tooltips: Record<AgentStatus, string> = {
			running: state.tool ? `Claude travaille · ${state.tool.name}` : 'Claude travaille…',
			waiting: state.message || 'Claude attend ton autorisation',
			done: 'Claude a terminé',
			idle: 'Claude est prêt',
		};
		vscode.commands.executeCommand('_orbit.setTerminalStatus', state.pid, state.status, tooltips[state.status]).then(undefined, () => undefined);

		if (state.status === previous || (state.status !== 'waiting' && state.status !== 'done')) {
			return;
		}
		const isVisible = vscode.window.state.focused && vscode.window.activeTerminal && this.terminalName(state.pid) === vscode.window.activeTerminal.name;
		if (isVisible) {
			return;
		}
		const text = state.status === 'waiting' ? `${name} attend ton autorisation` : `${name} a terminé`;
		if (!vscode.window.state.focused) {
			notifyMac('Orbit', text, state.status === 'waiting' ? state.message : undefined);
		}
		vscode.window.showInformationMessage(`✦ ${text}`, 'Voir').then(choice => {
			if (choice) {
				this.focusTerminal(state.pid);
			}
		});
	}
}

function installHooks(): void {
	try {
		fs.mkdirSync(EVENTS_DIR, { recursive: true });
		if (!fs.existsSync(HOOK_SCRIPT) || fs.readFileSync(HOOK_SCRIPT, 'utf8') !== HOOK_SCRIPT_SOURCE) {
			fs.writeFileSync(HOOK_SCRIPT, HOOK_SCRIPT_SOURCE, { mode: 0o755 });
		}
		const command = `'${HOOK_SCRIPT}'`;
		const hooks = Object.fromEntries(HOOK_EVENTS.map(e => [e, [{ hooks: [{ type: 'command', command, timeout: 5 }] }]]));
		const settings = JSON.stringify({ hooks }, null, 2);
		if (!fs.existsSync(HOOK_SETTINGS) || fs.readFileSync(HOOK_SETTINGS, 'utf8') !== settings) {
			fs.writeFileSync(HOOK_SETTINGS, settings);
		}
	} catch (err) {
		console.error('[orbit] could not install Claude hooks', err);
	}
}

function notifyMac(title: string, text: string, subtitle?: string): void {
	if (process.platform !== 'darwin') {
		return;
	}
	const q = (s: string) => `"${s.replace(/["\\]/g, '\\$&').slice(0, 180)}"`;
	execFile('osascript', ['-e', `display notification ${q(text)} with title ${q(title)}${subtitle ? ` subtitle ${q(subtitle)}` : ''} sound name "Glass"`], () => undefined);
}
