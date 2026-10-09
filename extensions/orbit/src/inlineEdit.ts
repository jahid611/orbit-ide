/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { assistantId } from './assistant';
import { runCodex } from './headless';
import { spawn } from 'child_process';
import { claudeEnv, keys, readConfig, resolveClaudeExecutable, workspaceRoot } from './config';

interface PendingEdit {
	uri: vscode.Uri;
	range: vscode.Range;
	originalText: string;
	originalDocument: string;
	instruction: string;
	/** Unique per edit, so its Diff never shows the original of an older one. */
	id: string;
}

const SYSTEM_PROMPT = 'You are a code rewriting engine inside an IDE. You receive a code region and an instruction. Reply with ONLY the new code for that region: no explanations, no Markdown fences, keep the original indentation style. If the region is empty, reply with the code to insert at the cursor.';

/** Cmd+K: rewrite the selection (or generate at the cursor) and let the user accept or reject. */
export class InlineEditController implements vscode.Disposable, vscode.CodeLensProvider {

	private pending: PendingEdit | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	private readonly addedDecoration = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
		isWholeLine: true,
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Left,
	});
	private readonly workingDecoration = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
		isWholeLine: true,
		after: { contentText: '   Claude écrit…', color: new vscode.ThemeColor('descriptionForeground'), fontStyle: 'italic' },
	});

	constructor() {
		this.disposables.push(
			vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this),
			vscode.workspace.registerTextDocumentContentProvider('orbit-inline', {
				provideTextDocumentContent: () => this.pending?.originalDocument ?? '',
			}),
			vscode.window.onDidChangeVisibleTextEditors(() => this.redecorate()),
		);
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (!this.pending || document.uri.toString() !== this.pending.uri.toString()) {
			return [];
		}
		const at = new vscode.Range(this.pending.range.start, this.pending.range.start);
		return [
			new vscode.CodeLens(at, { title: `$(check) Accepter ${keys('⌘⏎', 'Ctrl+Entrée')}`, command: 'orbit.acceptInlineEdit' }),
			new vscode.CodeLens(at, { title: `$(close) Rejeter ${keys('⌘⌫', 'Ctrl+Retour')}`, command: 'orbit.rejectInlineEdit' }),
			new vscode.CodeLens(at, { title: '$(diff) Diff', command: 'orbit.inlineEditDiff' }),
			new vscode.CodeLens(at, { title: '$(edit) Retoucher', command: 'orbit.inlineEditRefine' }),
		];
	}

	async run(presetInstruction?: string): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		if (this.pending) {
			await this.accept();
		}
		const instruction = presetInstruction ?? await vscode.window.showInputBox({
			title: 'Modifier avec Claude',
			placeHolder: editor.selection.isEmpty ? 'Décris le code à générer ici…' : 'Que faut-il changer dans la sélection ?',
			ignoreFocusOut: true,
		});
		if (!instruction) {
			return;
		}

		const doc = editor.document;
		const range = editor.selection.isEmpty
			? new vscode.Range(editor.selection.active, editor.selection.active)
			: new vscode.Range(doc.lineAt(editor.selection.start.line).range.start, editor.selection.end.character === 0 && editor.selection.end.line > editor.selection.start.line
				? doc.lineAt(editor.selection.end.line - 1).range.end
				: doc.lineAt(editor.selection.end.line).range.end);
		const original = doc.getText(range);
		const before = doc.getText(new vscode.Range(new vscode.Position(Math.max(0, range.start.line - 40), 0), range.start));
		// Near the end of the file, the context stops at its last character, never before the region.
		const afterEnd = range.end.line + 40 < doc.lineCount ? new vscode.Position(range.end.line + 40, 0) : doc.lineAt(doc.lineCount - 1).range.end;
		const after = doc.getText(new vscode.Range(range.end, afterEnd));

		const prompt = [
			`File: ${vscode.workspace.asRelativePath(doc.uri)} (${doc.languageId})`,
			`<before>\n${before}\n</before>`,
			`<region>\n${original}\n</region>`,
			`<after>\n${after}\n</after>`,
			`Instruction: ${instruction}`,
		].join('\n\n');

		editor.setDecorations(this.workingDecoration, [range]);
		let output: string;
		try {
			output = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: '$(orbit-claude) Claude écrit…', cancellable: false }, () => runClaude(prompt));
		} catch (err) {
			vscode.window.showErrorMessage(`Orbit : ${String(err)}`);
			return;
		} finally {
			editor.setDecorations(this.workingDecoration, []);
		}

		// The editor writes the document's own line endings: measure the code with them.
		const code = stripFences(output).replace(/\r?\n/g, doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
		const originalDocument = doc.getText();
		const ok = await editor.edit(edit => edit.replace(range, code));
		if (!ok) {
			return;
		}
		const startOffset = doc.offsetAt(range.start);
		const newRange = new vscode.Range(range.start, doc.positionAt(startOffset + code.length));
		this.pending = { uri: doc.uri, range: newRange, originalText: original, originalDocument, instruction, id: `${Date.now()}` };
		this.setContext(true);
		this.redecorate();
	}

	async accept(): Promise<void> {
		this.clear();
	}

	async reject(): Promise<void> {
		const pending = this.pending;
		if (!pending) {
			return;
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(pending.uri, pending.range, pending.originalText);
		await vscode.workspace.applyEdit(edit);
		this.clear();
	}

	async refine(): Promise<void> {
		const pending = this.pending;
		const editor = vscode.window.activeTextEditor;
		if (!pending || !editor) {
			return;
		}
		const more = await vscode.window.showInputBox({ title: 'Retoucher', placeHolder: 'Qu\'est-ce qui ne va pas ?', ignoreFocusOut: true });
		if (!more) {
			return;
		}
		editor.selection = new vscode.Selection(pending.range.start, pending.range.end);
		this.clear();
		await this.run(`${pending.instruction}\nThen also: ${more}`);
	}

	async diff(): Promise<void> {
		if (this.pending) {
			// A new query per edit: the editor caches virtual documents by URI.
			const left = vscode.Uri.from({ scheme: 'orbit-inline', path: this.pending.uri.path, query: this.pending.id });
			await vscode.commands.executeCommand('vscode.diff', left, this.pending.uri, 'Édition Claude');
		}
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.addedDecoration.dispose();
		this.workingDecoration.dispose();
		this._onDidChangeCodeLenses.dispose();
	}

	private clear(): void {
		this.pending = undefined;
		this.setContext(false);
		this.redecorate();
	}

	private setContext(value: boolean): void {
		vscode.commands.executeCommand('setContext', 'orbit.inlineEditPending', value);
		this._onDidChangeCodeLenses.fire();
	}

	private redecorate(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			const mine = this.pending && editor.document.uri.toString() === this.pending.uri.toString();
			editor.setDecorations(this.addedDecoration, mine ? [this.pending!.range] : []);
		}
	}
}

/** One-shot `claude -p` without tools, billed like the terminals. Rejects with a message for the user. */
export function runClaude(prompt: string, systemPrompt: string = SYSTEM_PROMPT, cwd: string = workspaceRoot()): Promise<string> {
	if (assistantId() === 'chatgpt') {
		return runCodex(prompt, systemPrompt, cwd);
	}
	const config = readConfig();
	return new Promise((resolve, reject) => {
		const proc = spawn(resolveClaudeExecutable(), [
			'-p', '--output-format', 'json',
			'--model', config.inlineModel,
			'--effort', 'low',
			'--tools', '',
			'--no-session-persistence',
			'--system-prompt', systemPrompt,
		], { cwd, env: claudeEnv() });
		let out = '';
		let err = '';
		proc.stdout.on('data', d => out += d);
		proc.stderr.on('data', d => err += d);
		proc.on('error', e => reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'Claude Code introuvable : installe-le ou règle orbit.claude.path.' : e));
		proc.on('close', code => {
			try {
				const parsed = JSON.parse(out);
				if (parsed.is_error) {
					reject(parsed.result || 'Erreur Claude');
				} else {
					resolve(String(parsed.result ?? ''));
				}
			} catch {
				reject(`Claude a échoué (code ${code}) ${err.slice(-500)}`);
			}
		});
		proc.stdin.end(prompt);
	});
}

export function stripFences(text: string): string {
	const trimmed = text.replace(/^\s*\n/, '').replace(/\s+$/, '');
	const fence = trimmed.match(/^```[\w+-]*\n([\s\S]*?)\n```$/);
	return fence ? fence[1] : trimmed;
}
