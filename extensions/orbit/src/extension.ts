/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { AgentTracker } from './agentTracker';
import { ChatViewProvider } from './chatView';
import { ClaudeTerminals } from './claudeTerminals';
import { SessionsView, SessionStore, timeAgo } from './sessions';
import { workspaceRoot } from './config';
import { InlineEditController } from './inlineEdit';
import { applyPreset, LAYOUT_PRESETS, StudioPanel } from './studio';

const WELCOME_KEY = 'orbit.welcomed.v2';

export function activate(context: vscode.ExtensionContext): void {
	const claude = new ClaudeTerminals(context.globalState);
	const tracker = new AgentTracker(pid => claude.byPid(pid)?.name, pid => claude.byPid(pid)?.show());
	const store = new SessionStore(context.globalState);
	const sessionsView = new SessionsView(store, tracker);
	const chat = new ChatViewProvider(context.extensionUri, claude, tracker);
	const studio = new StudioPanel(context.extensionUri);
	const inline = new InlineEditController();

	const renameSession = async (sessionId: string | undefined, terminal?: vscode.Terminal) => {
		if (!sessionId) {
			vscode.window.showInformationMessage('Cette discussion n\'a pas encore commencé : envoie un premier message à Claude.');
			return;
		}
		const current = store.get(sessionId);
		const name = await vscode.window.showInputBox({ title: 'Renommer la discussion', value: current?.title ?? '', prompt: 'Laisse vide pour revenir au titre automatique' });
		if (name === undefined) {
			return;
		}
		await store.rename(sessionId, name);
		const live = terminal ?? (() => {
			const state = tracker.findBySession(sessionId);
			return state ? claude.byPid(state.pid) : undefined;
		})();
		if (live) {
			await claude.rename(live, name.trim() ? `✦ ${name.trim()}` : 'Claude');
		}
		sessionsView.refreshSoon();
	};
	const sessionOfTerminal = (t: vscode.Terminal | undefined) => {
		if (!t) {
			return undefined;
		}
		const pid = claude.pidOf(t);
		return tracker.get(pid)?.sessionId ?? claude.sessionIdFor(t);
	};

	context.subscriptions.push(
		claude, tracker, sessionsView, chat, studio, inline,
		claude.onDidClose(pid => tracker.forget(pid)),
		vscode.window.registerTreeDataProvider('orbit.sessions', sessionsView),
		vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chat, { webviewOptions: { retainContextWhenHidden: true } }),

		vscode.commands.registerCommand('orbit.chat.show', () => chat.show()),
		vscode.commands.registerCommand('orbit.chat.showTerminal', () => chat.showTerminal()),
		vscode.commands.registerCommand('orbit.chat.toggle', () => chat.toggle()),

		vscode.commands.registerCommand('orbit.sessions.open', (id: string) => {
			const state = tracker.findBySession(id);
			claude.resume(id, store.get(id)?.customName, state ? claude.byPid(state.pid) : undefined);
		}),
		vscode.commands.registerCommand('orbit.sessions.rename', (node?: { session?: { id: string } }) => renameSession(node?.session?.id)),
		vscode.commands.registerCommand('orbit.sessions.renameCurrent', () => {
			const t = claude.current();
			return renameSession(sessionOfTerminal(t), t);
		}),
		vscode.commands.registerCommand('orbit.sessions.refresh', () => sessionsView.refreshSoon()),
		vscode.commands.registerCommand('orbit.sessions.search', async () => {
			const sessions = store.list();
			if (!sessions.length) {
				vscode.window.showInformationMessage('Aucune discussion Claude dans ce projet pour l\'instant.');
				return;
			}
			const pick = await vscode.window.showQuickPick(sessions.map(s => {
				const live = tracker.findBySession(s.id);
				return {
					label: `${live ? '$(sparkle) ' : '$(comment-discussion) '}${s.title}`,
					description: live ? 'ouverte' : timeAgo(s.modified),
					detail: s.lastPrompt.slice(0, 160),
					id: s.id,
				};
			}), { title: 'Discussions récentes', placeHolder: 'Rechercher une discussion (titre ou contenu)…', matchOnDescription: true, matchOnDetail: true });
			if (pick) {
				await vscode.commands.executeCommand('orbit.sessions.open', pick.id);
			}
		}),

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
