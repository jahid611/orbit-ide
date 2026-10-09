/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { assistant } from './assistant';

type Kind = 'pdf' | 'pptx';

const OFFICE = ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe', '/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice', '/usr/bin/libreoffice', '/snap/bin/libreoffice'];

/** LibreOffice, when the machine has it: it turns a presentation into a PDF that looks exactly like it. */
function libreOffice(): string | undefined {
	return OFFICE.find(candidate => fs.existsSync(candidate));
}

/** PowerPoint itself, on Windows, does the same through its automation interface. */
function powerPoint(): Promise<boolean> {
	if (process.platform !== 'win32') {
		return Promise.resolve(false);
	}
	return new Promise(resolve => execFile('reg.exe', ['query', 'HKCR\\PowerPoint.Application\\CLSID'], { windowsHide: true, timeout: 8000 }, err => resolve(!err)));
}

/**
 * PDF and PowerPoint files open in Orbit, in their own viewer (they used to open as unreadable
 * binary). PDFs are drawn by pdf.js (Mozilla, Apache 2.0): sharp at every zoom, selectable text,
 * search, thumbnails, links. Presentations are drawn in the page by pptx-preview; when PowerPoint
 * or LibreOffice is installed, « Rendu exact » converts the file to a PDF that is shown instead.
 * The file is never modified.
 */
class DocumentViewer implements vscode.CustomReadonlyEditorProvider {

	constructor(private readonly context: vscode.ExtensionContext, private readonly kind: Kind, private readonly tellAgent: (message: string) => unknown) { }

	openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return { uri, dispose: () => undefined };
	}

	async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		const cache = vscode.Uri.joinPath(this.context.globalStorageUri, 'documents');
		const folder = vscode.Uri.file(path.dirname(document.uri.fsPath));
		panel.webview.options = { enableScripts: true, localResourceRoots: [media, folder, cache] };
		const file = (name: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
		const nonce = randomBytes(16).toString('base64');
		const source = panel.webview.cspSource;
		// pdf.js works in a worker started from a blob.
		const csp = [
			`default-src 'none'`,
			`img-src ${source} data: blob:`,
			`style-src ${source} 'unsafe-inline'`,
			`font-src ${source} data: blob:`,
			`script-src 'nonce-${nonce}' blob:`,
			`worker-src blob:`,
			`connect-src ${source} blob: data:`,
			`media-src ${source} blob: data:`,
		].join('; ');
		const setup = {
			kind: this.kind,
			name: path.basename(document.uri.fsPath),
			url: panel.webview.asWebviewUri(document.uri).toString(),
			worker: file('pdfjs/pdf.worker.min.js'),
			cmaps: file('pdfjs/cmaps/'),
			fonts: file('pdfjs/standard_fonts/'),
			assistant: assistant().name,
			exact: this.kind === 'pptx' && (!!libreOffice() || await powerPoint()),
		};
		panel.webview.html = `<!DOCTYPE html>
<html lang="fr">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${file('base.css')}" rel="stylesheet">
	<link href="${file('viewer.css')}" rel="stylesheet">
</head>
<body class="page-viewer kind-${this.kind}">
	<div id="app"></div>
	<script nonce="${nonce}">window.OrbitViewer = ${JSON.stringify(setup)};</script>
	<script nonce="${nonce}" src="${file('icons.js')}"></script>
	<script nonce="${nonce}" src="${file('pdfjs/pdf.min.js')}"></script>
${this.kind === 'pptx' ? ['pptx/jszip.min.js', 'pptx/chart.umd.js', 'pptx/PptxViewJS.min.js'].map(name => `	<script nonce="${nonce}" src="${file(name)}"></script>\n`).join('') : ''}	<script nonce="${nonce}" src="${file('viewer.js')}"></script>
</body>
</html>`;
		let presenting = false;
		const listener = panel.webview.onDidReceiveMessage(async msg => {
			switch (msg?.type) {
				case 'agent': {
					const where = typeof msg.page === 'number' ? ` (${this.kind === 'pdf' ? 'page' : 'diapositive'} ${msg.page})` : '';
					const ask = String(msg.ask ?? '').trim();
					this.tellAgent(`${ask || 'Lis ce document et dis-moi ce qu\'il contient d\'important.'}\nFichier : ${document.uri.fsPath}${where}${typeof msg.text === 'string' && msg.text.trim() ? `\n\nPassage sélectionné :\n${msg.text.trim().slice(0, 4000)}` : ''}`);
					break;
				}
				case 'present':
					// Zen mode: the page alone on the whole screen. Left the same way, only if this viewer entered it.
					if (!!msg.on !== presenting) {
						presenting = !!msg.on;
						await vscode.commands.executeCommand('workbench.action.toggleZenMode');
					}
					break;
				case 'external':
					vscode.env.openExternal(document.uri);
					break;
				case 'reveal':
					vscode.commands.executeCommand('revealFileInOS', document.uri);
					break;
				case 'open':
					if (/^(https?|mailto):/.test(String(msg.url))) {
						vscode.env.openExternal(vscode.Uri.parse(String(msg.url), true));
					}
					break;
				case 'exact': {
					const pdf = await this.convert(document.uri.fsPath, cache.fsPath);
					panel.webview.postMessage(pdf ? { type: 'exact', url: panel.webview.asWebviewUri(vscode.Uri.file(pdf)).toString() } : { type: 'exactFailed' });
					break;
				}
			}
		});
		// The file changed on disk (an agent rewrote it): the viewer shows the new version.
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, path.basename(document.uri.fsPath)));
		let timer: NodeJS.Timeout | undefined;
		const changed = watcher.onDidChange(() => {
			clearTimeout(timer);
			timer = setTimeout(() => panel.webview.postMessage({ type: 'reload', url: `${panel.webview.asWebviewUri(document.uri)}?v=${Date.now()}` }), 700);
		});
		panel.onDidDispose(() => {
			if (presenting) {
				vscode.commands.executeCommand('workbench.action.toggleZenMode');
			}
			clearTimeout(timer);
			listener.dispose();
			changed.dispose();
			watcher.dispose();
		});
	}

	/** The presentation as a PDF, made by LibreOffice or PowerPoint; kept until the file changes. */
	private async convert(file: string, cache: string): Promise<string | undefined> {
		const stat = fs.statSync(file);
		const folder = path.join(cache, createHash('sha1').update(`${file}|${stat.mtimeMs}|${stat.size}`).digest('hex').slice(0, 16));
		const out = path.join(folder, `${path.basename(file, path.extname(file))}.pdf`);
		if (fs.existsSync(out)) {
			return out;
		}
		fs.mkdirSync(folder, { recursive: true });
		const office = libreOffice();
		if (office) {
			const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-office-'));
			await new Promise<void>(resolve => execFile(office, [`-env:UserInstallation=${vscode.Uri.file(profile).toString()}`, '--headless', '--convert-to', 'pdf', '--outdir', folder, file], { windowsHide: true, timeout: 120000 }, () => resolve()));
			fs.promises.rm(profile, { recursive: true, force: true }).catch(() => undefined);
		} else if (await powerPoint()) {
			const quote = (value: string) => `'${value.replace(/'/g, `''`)}'`;
			const script = `$app = New-Object -ComObject PowerPoint.Application; try { $deck = $app.Presentations.Open(${quote(file)}, -1, 0, 0); $deck.SaveAs(${quote(out)}, 32); $deck.Close() } finally { $app.Quit() }`;
			await new Promise<void>(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 120000 }, () => resolve()));
		}
		return fs.existsSync(out) ? out : undefined;
	}
}

export function registerDocumentViewers(context: vscode.ExtensionContext, tellAgent: (message: string) => unknown): vscode.Disposable[] {
	const options = { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true };
	return [
		vscode.window.registerCustomEditorProvider('orbit.pdf', new DocumentViewer(context, 'pdf', tellAgent), options),
		vscode.window.registerCustomEditorProvider('orbit.pptx', new DocumentViewer(context, 'pptx', tellAgent), options),
	];
}
