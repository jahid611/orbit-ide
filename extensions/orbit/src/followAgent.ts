/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { assistant } from './assistant';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { projectRoot } from './orbitControl';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);
/** Claude's and Orbit's own files, system folders: reading them is never "working on a project". */
const PRIVATE_AREAS = [
	path.join(os.homedir(), '.claude'),
	path.join(os.homedir(), '.orbit'),
	path.join(os.homedir(), 'AppData'),
	path.join(os.homedir(), 'Library'),
	os.tmpdir(),
	process.env.ProgramFiles ?? 'C:\\Program Files',
	process.env.SystemRoot ?? 'C:\\Windows',
];
const SWEEP_STEPS = 36;
const SWEEP_TICK_MS = 22;
const HOLD_MS = 1400;

/**
 * Watch Claude code live: each file the agent you are looking at writes opens in the editor,
 * the explorer unfolds to it, and the lines it wrote light up from top to bottom, then fade.
 */
export class FollowAgent implements vscode.Disposable {

	private readonly before = new Map<string, string | undefined>();
	private readonly warned = new Set<string>();
	private readonly disposables: vscode.Disposable[] = [];
	private sweep: NodeJS.Timeout | undefined;
	private readonly writing = vscode.window.createTextEditorDecorationType({
		backgroundColor: 'rgba(94, 234, 212, .16)',
		isWholeLine: true,
		overviewRulerColor: 'rgba(94, 234, 212, .8)',
		overviewRulerLane: vscode.OverviewRulerLane.Full,
	});
	private readonly cursor: vscode.TextEditorDecorationType;

	constructor(extensionUri: vscode.Uri, tracker: AgentTracker, private readonly claude: ClaudeTerminals, private readonly addFolder: (dir: string) => void) {
		// Claude's mark in the gutter rides the line being written.
		this.cursor = vscode.window.createTextEditorDecorationType({
			backgroundColor: 'rgba(94, 234, 212, .34)',
			isWholeLine: true,
			gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', assistant().image),
			gutterIconSize: '78%',
			after: { contentText: '   Claude écrit', color: 'rgba(94, 234, 212, .9)', fontStyle: 'italic' },
		});
		this.disposables.push(tracker.onDidUseTool(event => {
			const input = event.input as { file_path?: unknown; notebook_path?: unknown; path?: unknown } | undefined;
			const raw = input?.file_path ?? input?.notebook_path ?? (READ_TOOLS.has(event.tool) ? input?.path : undefined);
			if (typeof raw !== 'string' || !raw) {
				return;
			}
			const file = path.isAbsolute(raw) ? path.normalize(raw) : path.join(event.cwd ?? '', raw);
			if (!WRITE_TOOLS.has(event.tool)) {
				// Claude starts exploring another project: the explorer goes there with it.
				if (READ_TOOLS.has(event.tool) && event.phase === 'start' && this.follows(event.key)) {
					this.followFolder(file, false, event.cwd);
				}
				return;
			}
			const id = normal(file);
			if (event.phase === 'start') {
				this.before.set(id, read(file));
				return;
			}
			const previous = this.before.get(id);
			this.before.delete(id);
			this.followFolder(file, true, event.cwd);
			if (enabled() && this.follows(event.key)) {
				this.show(file, previous).catch(() => undefined);
			}
		}));
	}

	dispose(): void {
		clearInterval(this.sweep);
		this.writing.dispose();
		this.cursor.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	/** Only the agent on screen is followed, so several agents never fight over the editor. */
	private follows(key: string): boolean {
		const terminal = this.claude.byKey(key);
		return !!terminal && terminal === this.claude.current();
	}

	private async show(file: string, previous: string | undefined): Promise<void> {
		if (!inWorkspace(file)) {
			// Its folder may just be appearing in the explorer.
			await new Promise(resolve => setTimeout(resolve, 1500));
			if (!inWorkspace(file)) {
				return;
			}
		}
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		// The explorer follows the active editor, so it unfolds down to the file by itself.
		const editor = await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true, viewColumn: vscode.ViewColumn.One });
		const [first, last] = changedLines(previous, document.getText());
		if (last < first) {
			return;
		}
		editor.revealRange(new vscode.Range(first, 0, Math.min(last, first + 30), 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		clearInterval(this.sweep);
		let step = 0;
		this.sweep = setInterval(() => {
			step++;
			const reached = Math.min(last, first + Math.ceil((last - first + 1) * step / SWEEP_STEPS) - 1);
			editor.setDecorations(this.writing, [new vscode.Range(first, 0, reached, 0)]);
			editor.setDecorations(this.cursor, [new vscode.Range(reached, 0, reached, 0)]);
			if (reached >= last) {
				clearInterval(this.sweep);
				editor.setDecorations(this.cursor, []);
				setTimeout(() => editor.setDecorations(this.writing, []), HOLD_MS);
			}
		}, SWEEP_TICK_MS);
	}

	/**
	 * The explorer shows what Claude works on: a project it writes in, or starts reading, outside
	 * the open folders appears there by itself (`orbit.claude.followFolder`), without a reload.
	 */
	private followFolder(file: string, wrote: boolean, cwd: string | undefined): void {
		const mode = vscode.workspace.getConfiguration('orbit').get<string>('claude.followFolder') ?? 'auto';
		if (mode === 'off' || inWorkspace(file) || PRIVATE_AREAS.some(area => normal(file).startsWith(normal(area) + path.sep))) {
			return;
		}
		let start = file;
		try {
			// A folder (Glob, Grep): look for the project from inside it.
			if (fs.statSync(file).isDirectory()) {
				start = path.join(file, '_');
			}
		} catch {
			// not written yet
		}
		let folder = projectRoot(start);
		if (!folder && wrote) {
			const base = cwd && normal(file).startsWith(normal(cwd) + path.sep) ? cwd : path.dirname(file);
			const relative = path.relative(base, file).split(path.sep);
			// A project folder Claude created next to its start folder, or the folder of the file itself.
			folder = relative.length > 1 ? path.join(base, relative[0]) : path.dirname(file);
		}
		if (!folder || this.warned.has(normal(folder))) {
			return;
		}
		this.warned.add(normal(folder));
		if (mode === 'ask') {
			vscode.window.showInformationMessage(`Claude travaille dans ${folder}, un dossier qui n'est pas affiché dans l'explorateur.`, 'Afficher ce dossier').then(choice => {
				if (choice) {
					this.addFolder(folder!);
				}
			});
			return;
		}
		this.addFolder(folder);
		vscode.window.setStatusBarMessage(`$(${assistant().icon}) Explorateur : ${path.basename(folder)}, le dossier où travaille Claude`, 5000);
	}
}

function enabled(): boolean {
	return vscode.workspace.getConfiguration('orbit').get<boolean>('claude.followAgent') ?? true;
}

function read(file: string): string | undefined {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}
}

function normal(file: string): string {
	const n = path.normalize(file);
	return process.platform === 'win32' ? n.toLowerCase() : n;
}

function inWorkspace(file: string): boolean {
	const id = normal(file);
	return (vscode.workspace.workspaceFolders ?? []).some(f => id.startsWith(normal(f.uri.fsPath) + path.sep));
}

/** First and last line that differ (0-based); the whole file when it is new. */
function changedLines(before: string | undefined, after: string): [number, number] {
	const b = before === undefined ? [] : before.split(/\r?\n/);
	const a = after.split(/\r?\n/);
	if (before === undefined) {
		return [0, a.length - 1];
	}
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		start++;
	}
	let endA = a.length - 1;
	let endB = b.length - 1;
	while (endA >= start && endB >= start && a[endA] === b[endB]) {
		endA--;
		endB--;
	}
	// A pure deletion leaves nothing to light up but the place where it happened.
	return endA < start ? [Math.min(start, a.length - 1), Math.min(start, a.length - 1)] : [start, endA];
}
