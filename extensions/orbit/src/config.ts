/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HOOK_SETTINGS, ORBIT_DIR, TERMINAL_ID_ENV } from './agentTracker';
import { AssistantMode, AssistantModel, assistant, assistantId } from './assistant';
import { controlMcpConfig } from './orbitControl';
import { unityMcpConfig } from './unity';

/** Models and permission modes of the assistant in use: read when needed, the choice can change. */
export function models(): AssistantModel[] {
	return assistant().models;
}

export function modes(): AssistantMode[] {
	return assistant().modes;
}

export function readConfig() {
	const c = vscode.workspace.getConfiguration('orbit');
	return {
		// The program of the assistant in use: Claude Code, or Codex when the user works with ChatGPT.
		claudePath: assistantId() === 'chatgpt' ? (c.get<string>('chatgpt.path') || 'codex') : (c.get<string>('claude.path') || 'claude'),
		billing: c.get<string>('claude.billing') || 'subscription',
		// Each assistant keeps its own model and extra arguments: Claude's would mean nothing to Codex.
		model: c.get<string>(assistantId() === 'chatgpt' ? 'chatgpt.model' : 'claude.model') ?? '',
		permissionMode: c.get<string>('claude.permissionMode') ?? '',
		/** Mode of the agents the team lead (or the conductor) starts: they work unattended. */
		agentMode: (c.get<string>('team.agentMode') ?? 'auto') || c.get<string>('claude.permissionMode') || 'acceptEdits',
		language: c.get<string>('claude.language') ?? '',
		persona: c.get<string>('claude.persona') ?? '',
		extraArgs: c.get<string>(assistantId() === 'chatgpt' ? 'chatgpt.extraArgs' : 'claude.extraArgs') ?? '',
		autoStart: c.get<boolean>('claude.autoStart') ?? true,
		resumeOnOpen: c.get<boolean>('claude.resumeOnOpen') ?? true,
		revealNewFiles: c.get<boolean>('claude.revealNewFiles') ?? true,
		projectsFolder: c.get<string>('claude.projectsFolder') || path.join(os.homedir(), 'Orbit'),
		inlineModel: c.get<string>('inlineEdit.model') || 'sonnet',
	};
}

const ORBIT_CONTEXT = `You are running in a terminal inside Orbit, a desktop IDE. The user sees the project file tree and an editor right next to this terminal, and files you write open there live. Always produce real files and folders (never hosted artifacts, pastebins or remote documents), and mention the path of each file you create.

You control Orbit itself through the orbit tools (mcp__orbit__*), and you use them on your own, without asking, so the IDE always shows what you are working on:
- Before working in a folder the explorer does not show (see mcp__orbit__state), call mcp__orbit__show_folder on that project's root (mode "replace" when you move to another project, "add" when you work on several at once). Never tell the user to open a folder themselves.
- When the user asks to move on to another project (new or existing), finish the current one first (commit, push…), give your summary, then call mcp__orbit__open_project (create=true for a new folder) with a complete prompt for the Claude that will start there.
- Use mcp__orbit__open_file to show the user the important result, mcp__orbit__show_view and mcp__orbit__open_url for views and running apps, mcp__orbit__run_command (with mcp__orbit__find_commands) for anything else in the IDE.
- When the user asks you to generate something with Higgsfield (an image, a video, a 3D model, a voice, music…), go through Orbit's Higgsfield studio rather than answering only in the terminal: first call mcp__orbit__show_view with view "higgsfield" so the studio opens, generate with the Higgsfield tools, then download every result into the project's "assets/higgsfield/" folder (create it; short, meaningful file names without spaces) and add one entry per file to "assets/higgsfield/higgsfield.json" (a JSON array of { "file", "prompt", "type", "model", "date" }). The studio's gallery follows that folder, so the user sees each result appear there, ready to use. Answer in one sentence with the file names.
- Orbit has its own video editor, StarCapture, and you can edit in it yourself: cut, trim, titles, subtitles, transitions, zooms, colour, music, export. Whenever the user asks for anything about a video or a montage (even in passing, even from this terminal), use the StarCapture tools (mcp__starcapture__*) rather than writing ffmpeg commands by hand: call sc_guide first, once per conversation (the full manual: model, every operation, an editor's method), then sc_state to see the montage, sc_edit to change it, and sc_frame to look at the picture you produced before saying it is done.
- Never read, print or copy the values of the project's env files (.env, .env.local, .env.production…): they hold the user's secrets and stay out of this conversation. You may read .env.example and call mcp__orbit__env_names to know which variables exist; use those names in the code. When a variable is missing, call mcp__orbit__env_ask with its name and why you need it: the user fills it in Orbit's variables page.
- You know Orbit through its manual, mcp__orbit__guide: before answering any question about Orbit (how to do something, where a feature is, a shortcut, a setting) and before using one of its pages for the first time, read the matching page (no argument lists them, search finds them). Never guess how Orbit works, and never say Orbit cannot do something without having looked.
- When a service has a page in Orbit (Supabase, Vercel, Stripe, Figma, Higgsfield), go through Orbit's tools and that page: never open the service's website in a browser (Chrome tools included) to click through its dashboard, unless the user explicitly asks for the browser or the manual says Orbit cannot do that step.
- When the project uses Supabase, Orbit holds the access and you act through it: mcp__orbit__supabase_state (tables, protection), mcp__orbit__supabase_sql (read at once; with write=true the user sees the SQL in Orbit and accepts) and mcp__orbit__supabase_auth_urls (redirect addresses). Run migrations and checks yourself with these tools instead of telling the user to paste SQL into the Supabase dashboard. Orbit does not rotate keys: regenerating an API key or a secret stays the user's own action, in the dashboard.
- Orbit is your workbench, not a window around a plain terminal: when Orbit has a tool for something, use it rather than a hand-typed command or an instruction to the user. mcp__orbit__verify runs the project's checks (call it after changing code, before saying you are done); mcp__orbit__checkpoint marks a point to come back to before a risky change; mcp__orbit__vercel_state, mcp__orbit__vercel_publish and mcp__orbit__vercel_logs put the project online and explain a failed build; mcp__orbit__stripe_state and mcp__orbit__stripe_create_product handle payments; mcp__orbit__queue_add leaves work for the night queue. Show your work in Orbit as you go (open_file, show_view, open_url on the running app).
- You test what you build in Orbit's live view, in front of the user, the way a person would: mcp__orbit__open_url on the running app, mcp__orbit__preview_look to read the page and its errors, mcp__orbit__preview_act to click, type, submit and move from page to page, mcp__orbit__preview_screenshot to judge the layout. Do a real walk through the feature before saying it works. Never start a browser of your own (Chrome tools, a headless browser, Playwright, Puppeteer) for an app that runs on this machine, unless the user asks for it or the live view cannot do what the test needs; in that case say why.
- The project has a task board (mcp__orbit__board_list). When the user tells you to work through the board or to take a task, call mcp__orbit__board_take, do that task only, then mcp__orbit__board_move it to "review" with a short account of what you did. Never move a card to "done": that is the user's decision.`;

export interface ClaudeLaunch {
	model?: string;
	permissionMode?: string;
	/** Extra CLI flags such as `--resume` or `--continue`. */
	flags?: string[];
	/** Folder Claude starts in, when it is not the workspace root. */
	cwd?: string;
	/** Extra MCP server configuration files (e.g. the team tools of the lead agent). */
	mcpConfigs?: string[];
	/** Extra instructions appended to Orbit's own, with the name of the file that holds them. */
	instructions?: { name: string; text: string };
	/** Orbit id of the terminal, so a conversation log can be traced back to it. */
	terminalId?: string;
}

/** The shell command line that starts Claude Code with the user's preferences. */
export function claudeCommandLine(launch: ClaudeLaunch = {}): string {
	if (assistantId() === 'chatgpt') {
		return codexCommandLine(launch);
	}
	const config = readConfig();
	const args: string[] = [];
	const model = launch.model ?? config.model;
	const mode = launch.permissionMode ?? config.permissionMode;
	if (model) {
		args.push('--model', model);
	}
	if (mode) {
		args.push('--permission-mode', mode);
	}
	// The prompt goes through a file: multi-line text typed into a shell is fragile, and quoting differs per shell.
	args.push('--append-system-prompt-file', writeSystemPrompt(config, launch.instructions));
	// In a Unity project, Claude gets tools to see and drive the open Unity Editor.
	// Every Claude also gets the orbit tools, to drive the IDE (explorer, projects, views).
	// Orbit's own extensions (StarCapture…) hand Claude their tools through ~/.orbit/mcp/ext-*.json.
	const mcpConfigs = [controlMcpConfig(), unityMcpConfig(launch.cwd), ...extensionMcpConfigs(), ...(launch.mcpConfigs ?? [])].filter((f): f is string => !!f);
	if (mcpConfigs.length) {
		args.push('--mcp-config', ...mcpConfigs);
	}
	// Hooks report what the agent is doing to the IDE (tab status, notifications, chat view).
	args.push('--settings', HOOK_SETTINGS);
	args.push(...(launch.flags ?? []));
	// Work lands on disk where the user can see it, never in hosted artifacts.
	// A connector that comes with the user's claude.ai account cannot be signed out from here:
	// « disconnected » in Orbit means its agents are started without those tools.
	const higgsfield = vscode.workspace.getConfiguration('orbit').get<boolean>('higgsfield.enabled', true);
	args.push('--disallowedTools', higgsfield ? 'Artifact' : 'Artifact mcp__claude_ai_Higgsfield mcp__higgsfield');
	const extra = config.extraArgs.trim();
	const program = shellQuote(IS_WINDOWS ? resolveClaudeExecutable() : config.claudePath);
	// PowerShell only runs a quoted program through the call operator.
	return [IS_WINDOWS ? `& ${program}` : program, ...args.map(shellQuote), extra].filter(Boolean).join(' ');
}

const IS_WINDOWS = process.platform === 'win32';

/** Marker written in a Codex session's instructions: which Orbit terminal the conversation belongs to. */
export const CODEX_TERMINAL_MARK = 'orbit-terminal:';

function codexHome(): string {
	return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/**
 * The same launch, for Codex (ChatGPT). Codex takes its tools and instructions from a
 * configuration layer rather than from flags: Orbit writes one per terminal and names it with -p.
 */
function codexCommandLine(launch: ClaudeLaunch): string {
	const config = readConfig();
	const flags = [...(launch.flags ?? [])];
	// What Claude Code takes as flags are subcommands here.
	let sub: string[] = [];
	const resume = flags.indexOf('--resume');
	if (resume >= 0) {
		sub = ['resume', flags[resume + 1]];
		flags.splice(resume, 2);
	}
	const last = flags.indexOf('--continue');
	if (last >= 0) {
		sub = ['resume', '--last'];
		flags.splice(last, 1);
	}
	const args = ['-p', writeCodexProfile(config, launch)];
	const model = launch.model ?? config.model;
	if (model) {
		args.push('-m', model);
	}
	const mode = launch.permissionMode ?? config.permissionMode;
	if (mode === 'plan') {
		args.push('-s', 'read-only');
	} else if (mode === 'auto') {
		args.push('--approve-for-me');
	} else if (mode === 'acceptEdits') {
		args.push('-s', 'workspace-write', '-a', 'on-request');
	}
	const program = shellQuote(IS_WINDOWS ? resolveClaudeExecutable() : config.claudePath);
	return [IS_WINDOWS ? `& ${program}` : program, ...[...sub, ...args, ...flags].map(shellQuote), config.extraArgs.trim()].filter(Boolean).join(' ');
}

/** Writes the configuration layer of one Codex launch and returns its profile name. */
function writeCodexProfile(config: ReturnType<typeof readConfig>, launch: ClaudeLaunch): string {
	const name = `orbit-${(launch.terminalId ?? launch.instructions?.name ?? 'default').replace(/[^\w-]/g, '').slice(0, 40)}`;
	const instructions = [
		launch.terminalId ? `[${CODEX_TERMINAL_MARK}${launch.terminalId}]` : '',
		// Codex names the tools after their server: the Claude-style prefix would only confuse it.
		ORBIT_CONTEXT.replace(/\(mcp__orbit__\*\)/g, '(the MCP server named "orbit")').replace(/mcp__orbit__/g, '').replace(/the Claude that will start there/g, 'the agent that will start there'),
		config.language ? `Always answer in ${config.language}.` : '',
		config.persona.trim(),
		launch.instructions?.text ?? '',
	].filter(Boolean).join('\n\n');
	const lines = [
		'# Written by Orbit for one terminal. Safe to delete; Orbit recreates it.',
		`developer_instructions = ${JSON.stringify(instructions)}`,
		'',
	];
	const mcpConfigs = [controlMcpConfig(), unityMcpConfig(launch.cwd), ...extensionMcpConfigs(), ...(launch.mcpConfigs ?? [])].filter((f): f is string => !!f);
	for (const file of mcpConfigs) {
		let servers: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> = {};
		try {
			servers = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers ?? {};
		} catch {
			continue;
		}
		for (const [id, server] of Object.entries(servers)) {
			if (!server.command || !/^[\w-]+$/.test(id)) {
				continue;
			}
			lines.push(`[mcp_servers.${id}]`, `command = ${JSON.stringify(server.command)}`, `args = [${(server.args ?? []).map(a => JSON.stringify(a)).join(', ')}]`);
			const env = Object.entries(server.env ?? {});
			if (env.length) {
				lines.push('', `[mcp_servers.${id}.env]`, ...env.map(([key, value]) => `${key} = ${JSON.stringify(String(value))}`));
			}
			lines.push('');
		}
	}
	const home = codexHome();
	try {
		fs.mkdirSync(home, { recursive: true });
		fs.writeFileSync(path.join(home, `${name}.config.toml`), lines.join('\n'));
		// One layer per terminal: clear those of terminals long gone.
		for (const old of fs.readdirSync(home).filter(f => /^orbit-[\w-]+\.config\.toml$/.test(f))) {
			const full = path.join(home, old);
			if (Date.now() - fs.statSync(full).mtimeMs > 3 * 24 * 3600 * 1000) {
				fs.rmSync(full, { force: true });
			}
		}
	} catch (err) {
		console.error('[orbit] could not write the Codex configuration', err);
	}
	return name;
}

/** MCP configurations that Orbit's built-in extensions registered for every Claude. */
function extensionMcpConfigs(): string[] {
	const dir = path.join(ORBIT_DIR, 'mcp');
	try {
		return fs.readdirSync(dir).filter(f => /^ext-[\w.-]+\.json$/.test(f)).map(f => path.join(dir, f));
	} catch {
		return [];
	}
}

/** Shortcut label for the current platform, e.g. `keys('⌥⌘A', 'Ctrl+Alt+A')`. */
export function keys(mac: string, other: string): string {
	return process.platform === 'darwin' ? mac : other;
}

function writeSystemPrompt(config: ReturnType<typeof readConfig>, extra?: { name: string; text: string }): string {
	const file = path.join(ORBIT_DIR, extra ? `system-prompt-${extra.name}.md` : 'system-prompt.md');
	const text = [ORBIT_CONTEXT, config.language ? `Always answer in ${config.language}.` : '', config.persona.trim(), extra?.text ?? ''].filter(Boolean).join('\n\n');
	try {
		fs.mkdirSync(ORBIT_DIR, { recursive: true });
		if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
			fs.writeFileSync(file, text);
		}
	} catch (err) {
		console.error('[orbit] could not write the system prompt', err);
	}
	return file;
}

/** Quotes for the shell Orbit runs Claude in: PowerShell on Windows, a POSIX shell elsewhere. */
export function shellQuote(value: string): string {
	if ((IS_WINDOWS ? /^[\w%+=:,./\\-]+$/ : /^[\w@%+=:,./-]+$/).test(value)) {
		return value;
	}
	return IS_WINDOWS ? `'${value.replace(/'/g, `''`)}'` : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Shell of Claude terminals. Windows pins PowerShell so the command line above always parses. */
export function claudeShell(): { shellPath?: string; shellArgs?: string[] } {
	return IS_WINDOWS ? { shellPath: 'powershell.exe', shellArgs: ['-NoLogo'] } : {};
}

/** Environment for Claude processes: keeps billing on the subscription unless the user opted into an API key. */
export function claudeTerminalEnv(terminalId?: string): { [key: string]: string | null } {
	const env: { [key: string]: string | null } = {};
	if (terminalId) {
		// Claude's hooks inherit this and file their events under it, whatever the OS or process tree.
		env[TERMINAL_ID_ENV] = terminalId;
	}
	// Orbit may itself be launched from a Claude Code session; don't let each terminal
	// inherit that parent session, so every `claude` here is a normal, resumable session.
	for (const key of Object.keys(process.env)) {
		if (key === 'CLAUDECODE' || key === 'CLAUDE_PID' || key === 'CLAUDE_EFFORT' || key.startsWith('CLAUDE_CODE_')) {
			env[key] = null;
		}
	}
	// A colourless parent (CI, another tool's shell) must not strip Claude's interface of its colours.
	env.NO_COLOR = null;
	if (process.env.FORCE_COLOR === '0') {
		env.FORCE_COLOR = null;
	}
	if (readConfig().billing !== 'apiKey') {
		env.ANTHROPIC_API_KEY = null;
		env.ANTHROPIC_AUTH_TOKEN = null;
		// Same rule for ChatGPT: the subscription, never pay-as-you-go by accident.
		env.OPENAI_API_KEY = null;
	}
	return env;
}

/**
 * GUI apps on macOS don't inherit the login shell PATH, so add the usual
 * install locations of the Claude Code CLI. Also keeps billing on the
 * user's subscription unless they opted into API-key billing.
 */
export function claudeEnv(): NodeJS.ProcessEnv {
	const home = os.homedir();
	const extra = IS_WINDOWS ? [
		path.join(home, '.local', 'bin'),
		path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'npm'),
	] : [
		path.join(home, '.local', 'bin'),
		path.join(home, '.claude', 'local'),
		'/opt/homebrew/bin',
		'/usr/local/bin',
	];
	// Windows spells it `Path`; a second `PATH` key would make the child's lookup unpredictable.
	const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
	const current = process.env[pathKey] ?? '';
	const env: NodeJS.ProcessEnv = { ...process.env, [pathKey]: [...extra, current].join(path.delimiter) };
	for (const [key, value] of Object.entries(claudeTerminalEnv())) {
		if (value === null) {
			delete env[key];
		}
	}
	return env;
}

let resolvedClaude: { from: string; to: string } | undefined;

/**
 * The real `claude` binary. On Windows the npm install only puts `claude.cmd`/`claude.ps1` shims on
 * the PATH: `spawn` can't run them without a shell, and cmd mangles quoted arguments, so go straight
 * to the `claude.exe` the shim points at.
 */
export function resolveClaudeExecutable(): string {
	const configured = readConfig().claudePath;
	if (!IS_WINDOWS || path.isAbsolute(configured) || /[\\/]/.test(configured)) {
		return configured;
	}
	if (resolvedClaude?.from === configured) {
		return resolvedClaude.to;
	}
	const env = claudeEnv();
	const dirs = (env[Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH'] ?? '').split(path.delimiter).filter(Boolean);
	let found = configured;
	for (const dir of dirs) {
		const exe = path.join(dir, `${configured}.exe`);
		if (fs.existsSync(exe)) {
			found = exe;
			break;
		}
		const shim = path.join(dir, `${configured}.cmd`);
		if (fs.existsSync(shim)) {
			try {
				const target = fs.readFileSync(shim, 'utf8').match(/"%dp0%\\([^"]+\.exe)"/i);
				if (target && fs.existsSync(path.join(dir, target[1]))) {
					found = path.join(dir, target[1]);
					break;
				}
			} catch {
				// unreadable shim, keep looking
			}
		}
	}
	resolvedClaude = { from: configured, to: found };
	return found;
}

export function workspaceRoot(): string {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
}
