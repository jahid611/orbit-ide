/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { ClaudeTerminals } from './claudeTerminals';

const MAX_PROBLEMS = 40;

/**
 * Problems to Claude in one click: a quick fix on any error or warning ("Corriger avec
 * Claude"), and commands that send every problem of the file or of the project.
 */
export function registerFixWithClaude(claude: ClaudeTerminals): vscode.Disposable[] {
	const send = (text: string) => {
		const terminal = claude.current();
		if (terminal) {
			claude.sendMessage(terminal, text);
			terminal.show(true);
		} else {
			// A message typed into a terminal that is still starting gets lost: pass it at launch.
			claude.create({ flags: [text] });
		}
	};

	const describe = (uri: vscode.Uri, d: vscode.Diagnostic): string => {
		const where = `${relative(uri)}:${d.range.start.line + 1}`;
		const source = [d.source, typeof d.code === 'object' ? d.code.value : d.code].filter(Boolean).join(' ');
		return `- ${where} — ${d.message.replace(/\s+/g, ' ')}${source ? ` (${source})` : ''}`;
	};

	const fixOne = async (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
		const document = await vscode.workspace.openTextDocument(uri);
		const from = Math.max(0, diagnostic.range.start.line - 4);
		const to = Math.min(document.lineCount - 1, diagnostic.range.end.line + 4);
		const code = document.getText(new vscode.Range(from, 0, to, document.lineAt(to).text.length));
		send(`Corrige ce problème signalé par l'éditeur :\n${describe(uri, diagnostic)}\n\nCode autour (lignes ${from + 1} à ${to + 1} de @${relative(uri)}) :\n\`\`\`\n${code}\n\`\`\`\nCorrige la cause, pas le symptôme, et vérifie qu'il n'y a pas le même problème ailleurs dans le fichier.`);
	};

	const fixMany = (scope: 'file' | 'project') => {
		const active = vscode.window.activeTextEditor?.document.uri;
		const entries = scope === 'file' && active ? [[active, vscode.languages.getDiagnostics(active)] as [vscode.Uri, vscode.Diagnostic[]]] : vscode.languages.getDiagnostics();
		const problems: { uri: vscode.Uri; d: vscode.Diagnostic }[] = [];
		for (const [uri, list] of entries) {
			if (uri.scheme !== 'file') {
				continue;
			}
			for (const d of list) {
				if (d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning) {
					problems.push({ uri, d });
				}
			}
		}
		if (!problems.length) {
			vscode.window.showInformationMessage(scope === 'file' ? 'Aucun problème dans ce fichier.' : 'Aucun problème dans le projet.');
			return;
		}
		// Errors first, then warnings; a long list is cut so the message stays readable.
		problems.sort((a, b) => a.d.severity - b.d.severity);
		const shown = problems.slice(0, MAX_PROBLEMS);
		const errors = problems.filter(p => p.d.severity === vscode.DiagnosticSeverity.Error).length;
		send(`L'éditeur signale ${errors} erreur${errors > 1 ? 's' : ''} et ${problems.length - errors} avertissement${problems.length - errors > 1 ? 's' : ''} ${scope === 'file' ? `dans @${relative(active!)}` : 'dans le projet'}. Corrige-les en commençant par les erreurs :\n${shown.map(p => describe(p.uri, p.d)).join('\n')}${problems.length > shown.length ? `\n… et ${problems.length - shown.length} autres du même genre.` : ''}`);
	};

	return [
		vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, {
			provideCodeActions(document, _range, context) {
				return context.diagnostics.slice(0, 3).map(diagnostic => {
					const action = new vscode.CodeAction(`Corriger avec Claude : ${diagnostic.message.replace(/\s+/g, ' ').slice(0, 60)}`, vscode.CodeActionKind.QuickFix);
					action.diagnostics = [diagnostic];
					action.command = { command: 'orbit.problems.fix', title: 'Corriger avec Claude', arguments: [document.uri, diagnostic] };
					return action;
				});
			},
		}, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
		vscode.commands.registerCommand('orbit.problems.fix', (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => fixOne(uri, diagnostic)),
		vscode.commands.registerCommand('orbit.problems.fixFile', () => fixMany('file')),
		vscode.commands.registerCommand('orbit.problems.fixAll', () => fixMany('project')),
	];
}

function relative(uri: vscode.Uri): string {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	return (folder ? path.relative(folder.uri.fsPath, uri.fsPath) : uri.fsPath).split(path.sep).join('/');
}
