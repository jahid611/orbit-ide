/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ORBIT_DIR } from './agentTracker';

const execFileAsync = promisify(execFile);
const PASTES = path.join(ORBIT_DIR, 'pastes');
const KEEP_DAYS = 7;

/** Reads the clipboard image (a screenshot) into ~/.orbit/pastes, Windows: also copied image files. */
const WINDOWS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$out = $env:ORBIT_PASTE_FILE
$data = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($data -eq $null) { exit 0 }
$files = [System.Windows.Forms.Clipboard]::GetFileDropList()
$images = @($files | Where-Object { $_ -match '\\.(png|jpe?g|gif|webp|bmp)$' })
if ($images.Count -gt 0) { $images | ForEach-Object { "file:$_" }; exit 0 }
if ($data.GetDataPresent('PNG')) {
	$stream = $data.GetData('PNG'); $file = [System.IO.File]::Create($out); $stream.CopyTo($file); $file.Close(); 'saved'; exit 0
}
if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
	[System.Windows.Forms.Clipboard]::GetImage().Save($out, [System.Drawing.Imaging.ImageFormat]::Png); 'saved'
}`;

/** Image files the clipboard holds: a saved screenshot, or image files copied in the file manager. */
export async function clipboardImages(): Promise<string[]> {
	await fs.promises.mkdir(PASTES, { recursive: true });
	cleanOld();
	const out = path.join(PASTES, `capture-${stamp()}.png`);
	try {
		if (process.platform === 'win32') {
			const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT], { env: { ...process.env, ORBIT_PASTE_FILE: out }, timeout: 8000, windowsHide: true });
			const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
			const files = lines.filter(l => l.startsWith('file:')).map(l => l.slice(5));
			return files.length ? files : lines.includes('saved') && fs.existsSync(out) ? [out] : [];
		}
		if (process.platform === 'darwin') {
			await execFileAsync('osascript', ['-e', 'on run argv', '-e', 'set f to open for access (POSIX file (item 1 of argv)) with write permission', '-e', 'write (the clipboard as «class PNGf») to f', '-e', 'close access f', '-e', 'end run', out], { timeout: 8000 });
		} else {
			const { stdout } = await execFileAsync('sh', ['-c', 'wl-paste --type image/png 2>/dev/null || xclip -selection clipboard -t image/png -o 2>/dev/null'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 8000 });
			if (stdout.length) {
				await fs.promises.writeFile(out, stdout);
			}
		}
		return fs.existsSync(out) && fs.statSync(out).size > 0 ? [out] : [];
	} catch {
		fs.rmSync(out, { force: true });
		return [];
	}
}

/** Saves an image pasted in a page (a data: URL) and returns its file. */
export async function saveDataUrl(dataUrl: string): Promise<string> {
	const match = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/s.exec(dataUrl);
	if (!match) {
		throw new Error('Image illisible');
	}
	await fs.promises.mkdir(PASTES, { recursive: true });
	const file = path.join(PASTES, `capture-${stamp()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`);
	await fs.promises.writeFile(file, Buffer.from(match[2], 'base64'));
	return file;
}

/**
 * Ctrl+V in a terminal: text pastes as usual; a screenshot (or copied image files)
 * reaches Claude as image files it can see. The integrated terminal only pastes text.
 */
export function registerImagePaste(): vscode.Disposable {
	return vscode.commands.registerCommand('orbit.claude.paste', async (): Promise<void> => {
		const terminal = vscode.window.activeTerminal;
		const text = await vscode.env.clipboard.readText();
		// Any terminal, not only those Orbit knows as agents: an agent that outlived an update,
		// or was started by hand, is not on that list, and its Ctrl+V pasted nothing at all.
		let images: string[] = [];
		if (terminal && !text) {
			// Reading a picture from the clipboard takes a few seconds: say so at once.
			const reading = vscode.window.setStatusBarMessage('$(loading~spin) Lecture de la capture…');
			images = await clipboardImages().finally(() => reading.dispose());
		}
		if (!terminal || !images.length) {
			await vscode.commands.executeCommand('workbench.action.terminal.paste');
			return;
		}
		// Pasted like a drag and drop: Claude Code turns image paths into attached images.
		terminal.sendText(`\x1b[200~${images.map(quoteForPrompt).join(' ')}\x1b[201~ `, false);
		vscode.window.setStatusBarMessage(`$(file-media) ${images.length > 1 ? `${images.length} images collées` : 'Capture collée'} pour Claude`, 3000);
	});
}

function quoteForPrompt(file: string): string {
	return /\s/.test(file) ? `"${file}"` : file;
}

function stamp(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Pasted captures are kept a week, long enough for Claude to come back to them. */
function cleanOld(): void {
	fs.promises.readdir(PASTES).then(files => {
		const limit = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
		for (const name of files) {
			const file = path.join(PASTES, name);
			fs.promises.stat(file).then(async s => {
				if (s.mtimeMs < limit) {
					await fs.promises.rm(file, { force: true });
				}
			}).catch(() => undefined);
		}
	}).catch(() => undefined);
}
