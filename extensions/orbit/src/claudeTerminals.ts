/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ClaudeLaunch, claudeCommandLine, claudeTerminalEnv, MODELS, PERMISSION_MODES, readConfig, workspaceRoot } from './config';

const execFileAsync = promisify(execFile);

const COLORS = ['terminal.ansiMagenta', 'terminal.ansiCyan', 'terminal.ansiGreen', 'terminal.ansiYellow', 'terminal.ansiBlue', 'terminal.ansiRed'];

interface CreateOptions extends ClaudeLaunch {
	cwd?: string;
	label?: string;
	location?: vscode.TerminalOptions['location'];
	preserveFocus?: boolean;
}

/**
 * Claude Code lives in real integrated terminals: one `claude` per terminal,
 * organised as tabs, splits or an editor grid.
 */
export class ClaudeTerminals implements vscode.Disposable {

	private readonly terminals = new Set<vscode.Terminal>();
	private lastActive: vscode.Terminal | undefined;
	private counter = 0;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly statusItem = vscode.window.createStatusBarItem('orbit.claudeTerminals', vscode.StatusBarAlignment.Right, 1000);

	constructor() {
		// Terminals revived after a reload keep their name, so adopt them.
		for (const t of vscode.window.terminals) {
			this.adopt(t);
		}
		this.disposables.push(
			vscode.window.onDidOpenTerminal(t => this.adopt(t)),
			vscode.window.onDidCloseTerminal(t => {
				this.terminals.delete(t);
				if (this.lastActive === t) {
					this.lastActive = undefined;
				}
				this.updateStatus();
			}),
			vscode.window.onDidChangeActiveTerminal(t => {
				if (t && this.terminals.has(t)) {
					this.lastActive = t;
				}
			}),
			vscode.window.registerTerminalProfileProvider('orbit.claude', {
				provideTerminalProfile: () => new vscode.TerminalProfile(this.profileOptions()),
			}),
		);
		this.statusItem.name = 'Claude Terminals';
		this.statusItem.command = 'orbit.claude.switch';
		this.updateStatus();
		this.statusItem.show();
	}

	/** Open a terminal with `claude` already running in it. */
	create(options: CreateOptions = {}): vscode.Terminal {
		const terminal = vscode.window.createTerminal({
			...this.baseOptions(options.label),
			cwd: options.cwd ?? workspaceRoot(),
			location: options.location ?? vscode.TerminalLocation.Panel,
		});
		this.adopt(terminal);
		terminal.sendText(claudeCommandLine(options), true);
		terminal.show(options.preserveFocus);
		this.lastActive = terminal;
		return terminal;
	}

	/** Focus the most recent Claude terminal, or start one. */
	focus(): void {
		const target = this.lastActive ?? [...this.terminals].pop();
		if (target) {
			target.show();
		} else {
			this.create();
		}
	}

	split(): void {
		const parent = vscode.window.activeTerminal ?? this.lastActive;
		this.create(parent ? { location: { parentTerminal: parent } } : {});
	}

	inEditor(): void {
		this.create({ location: { viewColumn: vscode.ViewColumn.Beside } });
	}

	async grid(): Promise<void> {
		const pick = await vscode.window.showQuickPick([
			{ label: '2 agents', detail: 'Côte à côte', n: 2 },
			{ label: '3 agents', detail: 'Trois colonnes', n: 3 },
			{ label: '4 agents', detail: 'Grille 2 × 2', n: 4 },
			{ label: '6 agents', detail: 'Grille 3 × 2', n: 6 },
		], { title: 'Grille de terminaux Claude' });
		if (!pick) {
			return;
		}
		const rows = pick.n >= 4 ? 2 : 1;
		const cols = pick.n / rows;
		const row = { groups: Array.from({ length: cols }, () => ({})) };
		await vscode.commands.executeCommand('vscode.setEditorLayout', rows === 1
			? { orientation: 0, groups: row.groups }
			: { orientation: 1, groups: Array.from({ length: rows }, () => ({ groups: row.groups.map(() => ({})) })) });
		for (let i = 0; i < pick.n; i++) {
			this.create({ location: { viewColumn: (i + 1) as vscode.ViewColumn }, preserveFocus: i !== 0 });
		}
	}

	/** Start Claude in an isolated git worktree so it can't step on your working copy. */
	async worktree(): Promise<void> {
		const root = workspaceRoot();
		const branch = await vscode.window.showInputBox({
			title: 'Claude dans un worktree isolé',
			prompt: 'Nom de la branche',
			value: `orbit/${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`,
			validateInput: v => /^[\w./-]+$/.test(v) ? undefined : 'Lettres, chiffres, / . - _ uniquement',
		});
		if (!branch) {
			return;
		}
		const dir = path.join(path.dirname(root), `${path.basename(root)}-${branch.replace(/[/.]/g, '-')}`);
		try {
			await execFileAsync('git', ['worktree', 'add', '-b', branch, dir], { cwd: root });
		} catch (err) {
			vscode.window.showErrorMessage(`Impossible de créer le worktree : ${String(err).split('\n')[0]}`);
			return;
		}
		this.create({ cwd: dir, label: `Claude · ${branch}` });
	}

	async withOptions(): Promise<void> {
		const model = await vscode.window.showQuickPick(MODELS.map(m => ({ label: m.label, id: m.id })), { title: 'Modèle (1/2)' });
		if (!model) {
			return;
		}
		const mode = await vscode.window.showQuickPick(PERMISSION_MODES.map(m => ({ label: m.label, detail: m.hint, id: m.id })), { title: 'Mode de permission (2/2)' });
		if (!mode) {
			return;
		}
		this.create({ model: model.id, permissionMode: mode.id, label: `Claude · ${model.id || 'défaut'}` });
	}

	/** Type an @-mention of the current file/selection into the active Claude prompt. */
	async sendSelection(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		const target = this.lastActive ?? [...this.terminals].pop() ?? this.create();
		const file = vscode.workspace.asRelativePath(editor.document.uri, false);
		const sel = editor.selection;
		const ref = sel.isEmpty ? `@${file}` : `@${file}#L${sel.start.line + 1}-${sel.end.line + 1}`;
		target.show();
		target.sendText(`${ref} `, false);
	}

	async broadcast(): Promise<void> {
		if (!this.terminals.size) {
			vscode.window.showInformationMessage('Aucun terminal Claude ouvert.');
			return;
		}
		const text = await vscode.window.showInputBox({ title: `Envoyer à ${this.terminals.size} terminaux Claude`, placeHolder: 'Message envoyé à tous les agents…' });
		if (text) {
			for (const t of this.terminals) {
				t.sendText(text, true);
			}
		}
	}

	async switch(): Promise<void> {
		const items: (vscode.QuickPickItem & { terminal?: vscode.Terminal; action?: () => unknown })[] = [...this.terminals].map(t => ({
			label: `$(sparkle) ${t.name}`,
			description: t === vscode.window.activeTerminal ? 'actif' : undefined,
			terminal: t,
		}));
		items.push(
			{ label: '', kind: vscode.QuickPickItemKind.Separator },
			{ label: '$(add) Nouveau terminal Claude', action: () => this.create() },
			{ label: '$(split-horizontal) Claude en split', action: () => this.split() },
			{ label: '$(layout) Grille d\'agents…', action: () => this.grid() },
			{ label: '$(git-branch) Claude dans un worktree…', action: () => this.worktree() },
			{ label: '$(history) Reprendre une conversation…', action: () => this.create({ flags: ['--resume'] }) },
			{ label: '$(broadcast) Envoyer un message à tous…', action: () => this.broadcast() },
		);
		const pick = await vscode.window.showQuickPick(items, { title: 'Terminaux Claude', placeHolder: 'Aller à un agent ou en lancer un' });
		if (pick?.terminal) {
			pick.terminal.show();
		} else {
			await pick?.action?.();
		}
	}

	/** Open the first Claude terminal when a project opens, like a fresh Claude Code session. */
	autoStart(): void {
		if (!readConfig().autoStart || !vscode.workspace.workspaceFolders?.length) {
			return;
		}
		// Give revived terminals a moment to come back before deciding.
		setTimeout(() => {
			if (!this.terminals.size) {
				this.create();
			}
		}, 1200);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.statusItem.dispose();
	}

	private baseOptions(label?: string): vscode.TerminalOptions {
		this.counter++;
		return {
			name: label ?? (this.counter === 1 ? 'Claude' : `Claude ${this.counter}`),
			iconPath: new vscode.ThemeIcon('sparkle'),
			color: new vscode.ThemeColor(COLORS[(this.counter - 1) % COLORS.length]),
			env: claudeTerminalEnv(),
			isTransient: false,
		};
	}

	private profileOptions(): vscode.TerminalOptions {
		const shell = process.env.SHELL || '/bin/zsh';
		return {
			...this.baseOptions(),
			cwd: workspaceRoot(),
			shellPath: shell,
			// Run claude, then drop back to an interactive shell when it exits.
			shellArgs: ['-l', '-i', '-c', `${claudeCommandLine()}; exec ${shell} -l -i`],
		};
	}

	private adopt(terminal: vscode.Terminal): void {
		if (terminal.name.startsWith('Claude') && !this.terminals.has(terminal)) {
			this.terminals.add(terminal);
			this.updateStatus();
		}
	}

	private updateStatus(): void {
		const n = this.terminals.size;
		this.statusItem.text = n ? `$(sparkle) Claude × ${n}` : '$(sparkle) Claude';
		this.statusItem.tooltip = 'Terminaux Claude (⌥⌘A)';
	}
}
