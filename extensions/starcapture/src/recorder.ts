/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { MontageEditorProvider } from './editor';
import { tools } from './ffmpeg';

/**
 * Screen recording: one command starts filming the screen, the same command stops it, and the
 * recording opens in StarCapture, ready to cut. ffmpeg does the capture with what each system
 * provides (gdigrab on Windows, avfoundation on macOS, x11grab on Linux).
 */
export class Recorder implements vscode.Disposable {

	private proc: ChildProcess | undefined;
	private file: string | undefined;
	private startedAt = 0;
	private timer: NodeJS.Timeout | undefined;
	private readonly status = vscode.window.createStatusBarItem('starcapture.record', vscode.StatusBarAlignment.Left, 94);
	private readonly disposables: vscode.Disposable[] = [];

	constructor() {
		this.status.name = 'Enregistrement StarCapture';
		this.status.command = 'starcapture.record';
		this.disposables.push(this.status, vscode.commands.registerCommand('starcapture.record', () => this.toggle()));
	}

	dispose(): void {
		clearInterval(this.timer);
		this.proc?.kill();
		this.disposables.forEach(d => d.dispose());
	}

	private async toggle(): Promise<void> {
		try {
			if (this.proc) {
				await this.stop();
			} else {
				await this.start();
			}
		} catch (err) {
			vscode.window.showErrorMessage(`Enregistrement impossible : ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private captureArgs(): string[] {
		const rate = String(vscode.workspace.getConfiguration('starcapture').get<number>('recordFps') ?? 30);
		if (process.platform === 'win32') {
			return ['-f', 'gdigrab', '-framerate', rate, '-draw_mouse', '1', '-i', 'desktop'];
		}
		if (process.platform === 'darwin') {
			// Device "1" is the first screen on a Mac with one camera; macOS asks for the screen recording permission once.
			return ['-f', 'avfoundation', '-framerate', rate, '-capture_cursor', '1', '-i', '1:none'];
		}
		return ['-f', 'x11grab', '-framerate', rate, '-i', process.env.DISPLAY ?? ':0.0'];
	}

	private async start(): Promise<void> {
		const { ffmpeg } = await tools();
		const folder = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.join(os.homedir(), 'Videos', 'StarCapture'), 'enregistrements');
		await fs.promises.mkdir(folder, { recursive: true });
		const now = new Date();
		const two = (n: number) => String(n).padStart(2, '0');
		// Local time: the name is read by the person who recorded.
		const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
		this.file = path.join(folder, `ecran-${stamp}.mp4`);
		// Even dimensions for the encoder; a quick preset so the capture never falls behind.
		const args = ['-y', ...this.captureArgs(), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', this.file];
		let err = '';
		const proc = spawn(ffmpeg, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
		proc.stderr?.on('data', d => { err = (err + d).slice(-600); });
		proc.on('close', code => {
			if (this.proc === proc) {
				// ffmpeg stopped by itself: the capture could not start or broke.
				this.proc = undefined;
				this.render();
				vscode.window.showErrorMessage(`L'enregistrement s'est arrêté (code ${code}). ${err.split('\n').filter(Boolean).pop() ?? ''}`);
			}
		});
		this.proc = proc;
		this.startedAt = Date.now();
		this.timer = setInterval(() => this.render(), 1000);
		this.render();
	}

	private async stop(): Promise<void> {
		const proc = this.proc;
		const file = this.file;
		if (!proc || !file) {
			return;
		}
		this.proc = undefined;
		clearInterval(this.timer);
		this.render();
		// "q" lets ffmpeg close the file properly; killing it would leave a video that does not open.
		await new Promise<void>(resolve => {
			proc.on('close', () => resolve());
			proc.stdin?.write('q');
			proc.stdin?.end();
			setTimeout(() => { proc.kill(); resolve(); }, 8000);
		});
		if (!fs.existsSync(file) || fs.statSync(file).size < 2048) {
			throw new Error('la vidéo est vide');
		}
		await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), MontageEditorProvider.viewType);
	}

	private render(): void {
		if (!this.proc) {
			this.status.hide();
			return;
		}
		const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
		this.status.text = `$(record) ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
		this.status.tooltip = 'Enregistrement de l\'écran en cours : cliquer pour arrêter et ouvrir dans StarCapture';
		this.status.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		this.status.show();
	}
}
