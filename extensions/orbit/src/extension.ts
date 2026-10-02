/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { ClaudeTerminals } from './claudeTerminals';
import { workspaceRoot } from './config';
import { InlineEditController } from './inlineEdit';
import { applyPreset, LAYOUT_PRESETS, StudioPanel } from './studio';

const WELCOME_KEY = 'orbit.welcomed.v2';

export function activate(context: vscode.ExtensionContext): void {
	const claude = new ClaudeTerminals(context.globalState);
	const studio = new StudioPanel(context.extensionUri);
	const inline = new InlineEditController();

	context.subscriptions.push(
		claude, studio, inline,

		vscode.commands.registerCommand('orbit.claude.focus', () => claude.focus()),
		vscode.commands.registerCommand('orbit.claude.new', () => claude.start()),
		vscode.commands.registerCommand('orbit.claude.newProject', () => claude.newProject()),
		vscode.commands.registerCommand('orbit.claude.split', () => claude.split()),
		vscode.commands.registerCommand('orbit.claude.inEditor', () => claude.inEditor()),
		vscode.commands.registerCommand('orbit.claude.grid', () => claude.grid()),
		vscode.commands.registerCommand('orbit.claude.worktree', () => claude.worktree()),
		vscode.commands.registerCommand('orbit.claude.withOptions', () => claude.withOptions()),
		vscode.commands.registerCommand('orbit.claude.resume', () => claude.create({ flags: ['--resume'] })),
		vscode.commands.registerCommand('orbit.claude.continue', () => claude.create({ flags: ['--continue'] })),
		vscode.commands.registerCommand('orbit.claude.sendSelection', () => claude.sendSelection()),
		vscode.commands.registerCommand('orbit.claude.broadcast', () => claude.broadcast()),
		vscode.commands.registerCommand('orbit.claude.switch', () => claude.switch()),

		vscode.commands.registerCommand('orbit.inlineEdit', () => inline.run()),
		vscode.commands.registerCommand('orbit.acceptInlineEdit', () => inline.accept()),
		vscode.commands.registerCommand('orbit.rejectInlineEdit', () => inline.reject()),
		vscode.commands.registerCommand('orbit.inlineEditDiff', () => inline.diff()),
		vscode.commands.registerCommand('orbit.inlineEditRefine', () => inline.refine()),

		vscode.commands.registerCommand('orbit.openStudio', () => studio.show()),
		vscode.commands.registerCommand('orbit.applyLayoutPreset', async () => {
			const pick = await vscode.window.showQuickPick(
				Object.entries(LAYOUT_PRESETS).map(([id, p]) => ({ label: p.label, detail: p.detail, id })),
				{ title: 'Disposition Orbit' });
			if (pick) {
				await applyPreset(pick.id);
			}
		}),
		vscode.commands.registerCommand('orbit.editRules', async () => {
			// Claude Code reads CLAUDE.md natively, so project rules live there.
			const uri = vscode.Uri.file(path.join(workspaceRoot(), 'CLAUDE.md'));
			try {
				await vscode.workspace.fs.stat(uri);
			} catch {
				await vscode.workspace.fs.writeFile(uri, Buffer.from('# Règles du projet pour Claude\n\n- Stack :\n- Conventions de code :\n- À ne jamais faire :\n'));
			}
			await vscode.window.showTextDocument(uri);
		}),
	);

	claude.autoStart();

	if (!context.globalState.get(WELCOME_KEY)) {
		context.globalState.update(WELCOME_KEY, true);
		setTimeout(() => {
			vscode.window.showInformationMessage('Bienvenue dans Orbit ✦ — ⌘L terminal Claude, ⌥⌘N nouveau, ⌥⌘A organiser les agents, ⌘K édition inline, ⌥⌘, tout personnaliser.', 'Ouvrir le Studio')
				.then(choice => choice && studio.show());
		}, 2500);
	}
}

export function deactivate(): void { }
