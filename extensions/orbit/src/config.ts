/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { HOOK_SETTINGS } from './agentTracker';

export const MODELS = [
	{ id: '', label: 'Par défaut (Claude Code)' },
	{ id: 'opus', label: 'Opus' },
	{ id: 'sonnet', label: 'Sonnet' },
	{ id: 'haiku', label: 'Haiku' },
	{ id: 'claude-fable-5-1', label: 'Fable 5.1' },
];

export const PERMISSION_MODES = [
	{ id: '', label: 'Par défaut', hint: 'Claude demande avant chaque action sensible' },
	{ id: 'acceptEdits', label: 'Accepter les modifications', hint: 'Modifie les fichiers sans demander, demande pour les commandes' },
	{ id: 'plan', label: 'Plan', hint: 'Explore et propose un plan avant d\'agir' },
	{ id: 'auto', label: 'Auto', hint: 'Autonome, actions validées par un classifieur de sécurité' },
];

export function readConfig() {
	const c = vscode.workspace.getConfiguration('orbit');
	return {
		claudePath: c.get<string>('claude.path') || 'claude',
		billing: c.get<string>('claude.billing') || 'subscription',
		model: c.get<string>('claude.model') ?? '',
		permissionMode: c.get<string>('claude.permissionMode') ?? '',
		language: c.get<string>('claude.language') ?? '',
		persona: c.get<string>('claude.persona') ?? '',
		extraArgs: c.get<string>('claude.extraArgs') ?? '',
		autoStart: c.get<boolean>('claude.autoStart') ?? true,
		revealNewFiles: c.get<boolean>('claude.revealNewFiles') ?? true,
		projectsFolder: c.get<string>('claude.projectsFolder') || path.join(os.homedir(), 'Orbit'),
		inlineModel: c.get<string>('inlineEdit.model') || 'sonnet',
	};
}

const ORBIT_CONTEXT = 'You are running in a terminal inside Orbit, a desktop IDE. The user sees the project file tree and an editor right next to this terminal, and files you write open there live. Always produce real files and folders inside the current working directory (never hosted artifacts, pastebins or remote documents), and mention the relative path of each file you create.';

export interface ClaudeLaunch {
	model?: string;
	permissionMode?: string;
	/** Extra CLI flags such as `--resume` or `--continue`. */
	flags?: string[];
}

/** The shell command line that starts Claude Code with the user's preferences. */
export function claudeCommandLine(launch: ClaudeLaunch = {}): string {
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
	const system = [ORBIT_CONTEXT, config.language ? `Always answer in ${config.language}.` : '', config.persona.trim()].filter(Boolean).join('\n\n');
	args.push('--append-system-prompt', system);
	// Hooks report what the agent is doing to the IDE (tab status, notifications, chat view).
	args.push('--settings', HOOK_SETTINGS);
	args.push(...(launch.flags ?? []));
	// Work lands on disk where the user can see it, never in hosted artifacts.
	args.push('--disallowedTools', 'Artifact');
	const extra = config.extraArgs.trim();
	return [shellQuote(config.claudePath), ...args.map(shellQuote), extra].filter(Boolean).join(' ');
}

function shellQuote(value: string): string {
	return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Environment for Claude processes: keeps billing on the subscription unless the user opted into an API key. */
export function claudeTerminalEnv(): { [key: string]: string | null } {
	const env: { [key: string]: string | null } = {};
	// Orbit may itself be launched from a Claude Code session; don't let each terminal
	// inherit that parent session, so every `claude` here is a normal, resumable session.
	for (const key of Object.keys(process.env)) {
		if (key === 'CLAUDECODE' || key === 'CLAUDE_PID' || key === 'CLAUDE_EFFORT' || key.startsWith('CLAUDE_CODE_')) {
			env[key] = null;
		}
	}
	if (readConfig().billing !== 'apiKey') {
		env.ANTHROPIC_API_KEY = null;
		env.ANTHROPIC_AUTH_TOKEN = null;
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
	const extra = [
		path.join(home, '.local', 'bin'),
		path.join(home, '.claude', 'local'),
		'/opt/homebrew/bin',
		'/usr/local/bin',
	];
	const current = process.env.PATH ?? '';
	const env: NodeJS.ProcessEnv = { ...process.env, PATH: [...extra, current].join(path.delimiter) };
	for (const [key, value] of Object.entries(claudeTerminalEnv())) {
		if (value === null) {
			delete env[key];
		}
	}
	return env;
}

export function workspaceRoot(): string {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
}
