/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { assistant } from './assistant';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'done';

export interface AgentState {
	/** Terminal the agent runs in: its Orbit id, or the shell pid for terminals from older builds. */
	key: string;
	status: AgentStatus;
	sessionId?: string;
	transcriptPath?: string;
	cwd?: string;
	/** Claude Code's permission mode as last reported by a hook (default, acceptEdits, plan, auto…). */
	permissionMode?: string;
	/** Last tool Claude started, with its input, so a pending permission can be shown. */
	tool?: { name: string; input: unknown };
	message?: string;
	/** What the user last asked, and when: one turn of work. */
	prompt?: string;
	turnStartedAt?: number;
	/** The agent has quit: its terminal is a bare shell until an agent starts in it again. */
	ended?: boolean;
	updatedAt: number;
}

/** A tool an agent starts or finishes using. */
export interface AgentToolEvent {
	key: string;
	phase: 'start' | 'end';
	tool: string;
	input: unknown;
	cwd?: string;
}

/** What the tracker needs to know about the terminals hosting agents. */
export interface AgentTerminals {
	byKey(key: string): vscode.Terminal | undefined;
	pidOf(terminal: vscode.Terminal): number | undefined;
}

export const ORBIT_DIR = path.join(os.homedir(), '.orbit');
const EVENTS_DIR = path.join(ORBIT_DIR, 'agent-events');
const HOOK_SCRIPT = path.join(ORBIT_DIR, 'hook.sh');
export const HOOK_SETTINGS = path.join(ORBIT_DIR, 'claude-settings.json');
/** Set on every Claude terminal; the hook files events under it. */
export const TERMINAL_ID_ENV = 'ORBIT_TERMINAL_ID';

const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];

/**
 * Claude Code runs as a plain CLI in our terminals; its hooks tell Orbit what each
 * agent is doing. Every event is appended to `~/.orbit/agent-events/<terminal id>.jsonl`.
 * Claude Code runs hooks through sh everywhere (Git Bash on Windows), so one script fits all.
 */
const HOOK_SCRIPT_SOURCE = `#!/bin/sh
# Orbit: forwards Claude Code hook events to the IDE. Safe to delete; Orbit recreates it.
d="$HOME/.orbit/agent-events"
mkdir -p "$d"
id="$${TERMINAL_ID_ENV}"
if [ -z "$id" ]; then
	# Terminal from an older Orbit: use the pid of the shell hosting claude.
	pid=$PPID
	id=$PPID
	i=0
	while [ $i -lt 5 ] && [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
		case "$(ps -o comm= -p "$pid" 2>/dev/null)" in
			*claude*) id=$(ps -o ppid= -p "$pid" | tr -d ' '); break ;;
		esac
		pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
		i=$((i + 1))
	done
fi
case "$id" in
	''|*[!A-Za-z0-9-]*) cat > /dev/null; exit 0 ;;
esac
{ cat; echo; } >> "$d/$id.jsonl"
exit 0
`;

export class AgentTracker implements vscode.Disposable {

	private readonly states = new Map<string, AgentState>();
	private readonly offsets = new Map<string, number>();
	/** Event logs already there at activation: their first read is history, not news. */
	private readonly history = new Set<string>();
	private watcher: fs.FSWatcher | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	private readonly _onDidChange = new vscode.EventEmitter<AgentState>();
	readonly onDidChange = this._onDidChange.event;
	private readonly _onDidUseTool = new vscode.EventEmitter<AgentToolEvent>();
	/** Fires live for every tool call, so the IDE can show which files each agent touches. */
	readonly onDidUseTool = this._onDidUseTool.event;

	/** One-line job of an agent, shown first when hovering its tab (set by the team). */
	private roleOf: (key: string) => string | undefined = () => undefined;

	constructor(private readonly terminals: AgentTerminals) {
		installHooks();
		try {
			for (const f of fs.readdirSync(EVENTS_DIR)) {
				if (f.endsWith('.jsonl')) {
					this.history.add(path.join(EVENTS_DIR, f));
				}
			}
		} catch {
			// no log yet
		}
		this.scanAll();
		this.ensureWatcher();
		const poll = setInterval(() => this.scanAll(), 4000);
		this.disposables.push({ dispose: () => clearInterval(poll) });
	}

	setRoleProvider(provider: (key: string) => string | undefined): void {
		this.roleOf = provider;
	}

	get(key: string | undefined): AgentState | undefined {
		return key === undefined ? undefined : this.states.get(key);
	}

	all(): AgentState[] {
		return [...this.states.values()];
	}

	findBySession(sessionId: string): AgentState | undefined {
		return this.all().find(s => s.sessionId === sessionId);
	}

	/**
	 * The agent of this terminal is gone without having said so (Orbit was closed and the terminal
	 * came back as a bare shell). Written to its event log, so it still holds after a reload.
	 */
	markEnded(key: string): void {
		const state = this.states.get(key);
		if (state) {
			state.ended = true;
			state.status = 'idle';
			state.tool = undefined;
		}
		fs.promises.appendFile(path.join(EVENTS_DIR, `${key}.jsonl`), `${JSON.stringify({ hook_event_name: 'SessionEnd', reason: 'orbit-revived' })}\n`).catch(() => undefined);
	}

	/** Forget a closed terminal and its event log. */
	forget(key: string): void {
		this.states.delete(key);
		const file = path.join(EVENTS_DIR, `${key}.jsonl`);
		this.offsets.delete(file);
		fs.promises.rm(file, { force: true }).catch(() => undefined);
	}

	dispose(): void {
		this.watcher?.close();
		this.disposables.forEach(d => d.dispose());
		this._onDidChange.dispose();
		this._onDidUseTool.dispose();
	}

	/** An event from another source than the hooks (the Codex log reader): same shape, same handling. */
	ingest(key: string, event: unknown): void {
		this.apply(key, event, false);
	}

	private ensureWatcher(): void {
		if (this.watcher) {
			return;
		}
		try {
			this.watcher = fs.watch(EVENTS_DIR, (_event, file) => {
				if (file && file.endsWith('.jsonl')) {
					this.readFile(path.join(EVENTS_DIR, file));
				}
			});
		} catch {
			// directory missing: hooks will create it, keep polling
		}
	}

	private scanAll(): void {
		let files: string[] = [];
		try {
			files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.jsonl'));
		} catch {
			return;
		}
		this.ensureWatcher();
		for (const f of files) {
			this.readFile(path.join(EVENTS_DIR, f));
		}
	}

	private readFile(file: string): void {
		const key = path.basename(file, '.jsonl');
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
		let buffer: Buffer;
		try {
			const fd = fs.openSync(file, 'r');
			buffer = Buffer.alloc(size - from);
			fs.readSync(fd, buffer, 0, buffer.length, from);
			fs.closeSync(fd);
		} catch {
			return; // being written or removed (Windows locks), the next event retries
		}
		const text = buffer.toString('utf8');
		const end = text.lastIndexOf('\n');
		if (end < 0) {
			return;
		}
		this.offsets.set(file, from + Buffer.byteLength(text.slice(0, end + 1)));
		const firstRead = from === 0 && this.history.has(file);
		this.history.delete(file);
		for (const line of text.slice(0, end).split('\n')) {
			if (!line.trim()) {
				continue;
			}
			try {
				this.apply(key, JSON.parse(line), firstRead);
			} catch {
				// partial or foreign line
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private apply(key: string, event: any, replaying: boolean): void {
		const prev = this.states.get(key) ?? { key, status: 'idle' as AgentStatus, updatedAt: 0 };
		const state: AgentState = {
			...prev,
			sessionId: event.session_id ?? prev.sessionId,
			transcriptPath: event.transcript_path ?? prev.transcriptPath,
			cwd: event.cwd ?? prev.cwd,
			permissionMode: typeof event.permission_mode === 'string' ? event.permission_mode : prev.permissionMode,
			updatedAt: Date.now(),
		};
		switch (event.hook_event_name) {
			case 'SessionStart':
				state.status = 'idle';
				state.tool = undefined;
				state.ended = false;
				break;
			case 'UserPromptSubmit':
				state.status = 'running';
				state.message = undefined;
				// Pasted text arrives wrapped in <pasted_content id="…"> … </pasted_content>: keep what the user wrote.
				state.prompt = typeof event.prompt === 'string' ? event.prompt.replace(/<\/?pasted_content[^>]*>/g, '').trim() : undefined;
				state.turnStartedAt = Date.now();
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
				state.ended = true;
				break;
			default:
				return;
		}
		this.states.set(key, state);
		if (replaying) {
			return; // history from before this window opened: update state silently
		}
		this.render(state, prev.status);
		this._onDidChange.fire(state);
		if (event.hook_event_name === 'PreToolUse' || event.hook_event_name === 'PostToolUse') {
			this._onDidUseTool.fire({ key, phase: event.hook_event_name === 'PreToolUse' ? 'start' : 'end', tool: String(event.tool_name ?? ''), input: event.tool_input, cwd: state.cwd });
		}
	}

	private render(state: AgentState, previous: AgentStatus): void {
		const terminal = this.terminals.byKey(state.key);
		const who = assistant().name;
		const name = terminal?.name ?? who;
		const tooltips: Record<AgentStatus, string> = {
			running: state.tool ? `${who} travaille · ${state.tool.name}` : `${who} travaille…`,
			waiting: state.message || `${who} attend ton autorisation`,
			done: `${who} a terminé`,
			idle: `${who} est prêt`,
		};
		const pid = terminal && this.terminals.pidOf(terminal);
		if (pid !== undefined) {
			const role = this.roleOf(state.key);
			vscode.commands.executeCommand('_orbit.setTerminalStatus', pid, state.status, role ? `${role}
${tooltips[state.status]}` : tooltips[state.status]).then(undefined, () => undefined);
		}

		if (!terminal || state.status === previous || (state.status !== 'waiting' && state.status !== 'done')) {
			return; // no terminal here: the agent belongs to another window, which notifies
		}
		if (vscode.window.state.focused && terminal && terminal === vscode.window.activeTerminal) {
			return;
		}
		const text = state.status === 'waiting' ? `${name} attend ton autorisation` : `${name} a terminé`;
		if (!vscode.window.state.focused) {
			notifyDesktop('Orbit', text, state.status === 'waiting' ? state.message : undefined);
		}
		vscode.window.showInformationMessage(text, 'Voir').then(choice => {
			if (choice) {
				this.terminals.byKey(state.key)?.show();
			}
		});
	}
}

/**
 * Env files hold the project's secrets. Claude Code is denied reading them (the example file,
 * which only lists names, stays readable); the user fills them in Orbit's variables page.
 */
const ENV_DENY = ['.env', '.env.local', '.env.*.local', '.env.production', '.env.development', '.env.staging', '.env.test', '.env.preview']
	.flatMap(name => [`Read(./${name})`, `Read(**/${name})`, `Edit(./${name})`, `Edit(**/${name})`]);

export function installHooks(): void {
	try {
		fs.mkdirSync(EVENTS_DIR, { recursive: true });
		if (!fs.existsSync(HOOK_SCRIPT) || fs.readFileSync(HOOK_SCRIPT, 'utf8') !== HOOK_SCRIPT_SOURCE) {
			fs.writeFileSync(HOOK_SCRIPT, HOOK_SCRIPT_SOURCE, { mode: 0o755 });
		}
		const command = `'${HOOK_SCRIPT.replace(/'/g, `'\\''`)}'`;
		const hooks = Object.fromEntries(HOOK_EVENTS.map(e => [e, [{ hooks: [{ type: 'command', command, timeout: 5 }] }]]));
		const hide = vscode.workspace.getConfiguration('orbit').get<boolean>('env.hideFromAgent', true);
		const settings = JSON.stringify(hide ? { hooks, permissions: { deny: ENV_DENY } } : { hooks }, null, 2);
		if (!fs.existsSync(HOOK_SETTINGS) || fs.readFileSync(HOOK_SETTINGS, 'utf8') !== settings) {
			fs.writeFileSync(HOOK_SETTINGS, settings);
		}
	} catch (err) {
		console.error('[orbit] could not install Claude hooks', err);
	}
}

/** Windows toasts need an app id registered in the Start menu; PowerShell's always is. */
const WINDOWS_TOAST_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

const WINDOWS_TOAST_SCRIPT = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText04)
$lines = $xml.GetElementsByTagName('text')
$lines.Item(0).AppendChild($xml.CreateTextNode($env:ORBIT_TOAST_TITLE)) > $null
$lines.Item(1).AppendChild($xml.CreateTextNode($env:ORBIT_TOAST_TEXT)) > $null
$lines.Item(2).AppendChild($xml.CreateTextNode($env:ORBIT_TOAST_SUBTITLE)) > $null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:ORBIT_TOAST_APP).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;

function notifyDesktop(title: string, text: string, subtitle?: string): void {
	if (process.platform === 'darwin') {
		const q = (s: string) => `"${s.replace(/["\\]/g, '\\$&').slice(0, 180)}"`;
		execFile('osascript', ['-e', `display notification ${q(text)} with title ${q(title)}${subtitle ? ` subtitle ${q(subtitle)}` : ''} sound name "Glass"`], () => undefined);
	} else if (process.platform === 'win32') {
		// Texts travel through the environment so nothing needs escaping.
		execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_TOAST_SCRIPT, 'utf16le').toString('base64')], {
			env: { ...process.env, ORBIT_TOAST_TITLE: title, ORBIT_TOAST_TEXT: text, ORBIT_TOAST_SUBTITLE: (subtitle ?? '').slice(0, 180), ORBIT_TOAST_APP: WINDOWS_TOAST_APP_ID },
			windowsHide: true,
		}, () => undefined);
	}
}
