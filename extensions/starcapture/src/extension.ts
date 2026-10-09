/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Bridge } from './bridge';
import { MontageDocument, MontageEditorProvider } from './editor';
import { PRESETS, exportProject } from './export';
import { tools } from './ffmpeg';
import { Home } from './home';
import { Recorder } from './recorder';
import { emptyProject, projectDuration } from './project';

export function activate(context: vscode.ExtensionContext): void {
	const orbit = vscode.extensions.getExtension('vscode.orbit')?.extensionUri;
	const provider = new MontageEditorProvider(context, orbit);
	const exporting = new Set<MontageDocument>();

	/** Renders a montage; returns the output file. Shared by the command and Claude's tool. */
	const runExport = async (doc: MontageDocument, presetId?: string, file?: string, range?: [number, number]): Promise<string> => {
		if (exporting.has(doc)) {
			throw new Error('Un export de ce montage est déjà en cours.');
		}
		await tools();
		const preset = PRESETS.find(p => p.id === presetId) ?? PRESETS[0];
		const folder = vscode.workspace.getConfiguration('starcapture').get<string>('exportFolder')?.trim() || path.join(path.dirname(doc.file), 'exports');
		const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
		const out = file ?? path.join(folder, `${safeName(doc.project.name)}-${stamp}.${preset.container}`);
		exporting.add(doc);
		const started = Date.now();
		try {
			await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Export de « ${doc.project.name} » (${preset.label})`, cancellable: true }, async (progress, token) => {
				let last = 0;
				await exportProject(doc.project, out, {
					preset,
					range,
					normalize: true,
					hardware: vscode.workspace.getConfiguration('starcapture').get<boolean>('hardwareEncoding') ?? true,
					fontsDir: fs.existsSync(path.join(context.extensionPath, 'media', 'fonts')) ? path.join(context.extensionPath, 'media', 'fonts') : undefined,
				}, (p, label) => {
					const left = p > 0.02 ? Math.round((Date.now() - started) / p * (1 - p) / 1000) : undefined;
					progress.report({ increment: (p - last) * 100, message: `${Math.round(p * 100)} %${left !== undefined ? ` · encore ${clock(left)}` : ''} · ${label}` });
					last = p;
				}, token);
			});
		} finally {
			exporting.delete(doc);
		}
		const seconds = Math.round((Date.now() - started) / 1000);
		vscode.window.showInformationMessage(`Vidéo exportée en ${clock(seconds)} : ${path.basename(out)}`, 'Afficher', 'Lire').then(choice => {
			if (choice === 'Afficher') {
				vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(out));
			} else if (choice === 'Lire') {
				vscode.env.openExternal(vscode.Uri.file(out));
			}
		});
		return out;
	};

	const bridge = new Bridge(context, provider, runExport);
	const home = new Home(context, provider);
	provider.onOpened = doc => home.remember(doc.file);
	context.subscriptions.push(home, new Recorder());

	context.subscriptions.push(
		bridge,
		vscode.window.registerCustomEditorProvider(MontageEditorProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }),
		vscode.commands.registerCommand('starcapture.newProject', async () => {
			const shape = await vscode.window.showQuickPick([
				{ label: '$(device-desktop) Horizontal 16:9', description: '1920 × 1080', detail: 'YouTube, vidéos classiques', size: [1920, 1080] },
				{ label: '$(device-mobile) Vertical 9:16', description: '1080 × 1920', detail: 'Shorts, TikTok, Reels', size: [1080, 1920] },
				{ label: '$(screen-full) Carré 1:1', description: '1080 × 1080', detail: 'Instagram, publicités', size: [1080, 1080] },
				{ label: '$(device-desktop) 4K 16:9', description: '3840 × 2160', detail: 'YouTube 4K', size: [3840, 2160] },
			], { title: 'Nouveau montage', placeHolder: 'Format de la vidéo' });
			if (!shape) {
				return;
			}
			const name = await vscode.window.showInputBox({ title: 'Nouveau montage', prompt: 'Nom du montage', value: 'Mon montage', ignoreFocusOut: true });
			if (!name) {
				return;
			}
			const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.join(os.homedir(), 'Videos');
			let file = path.join(folder, `${safeName(name)}.starcapture`);
			for (let i = 2; fs.existsSync(file); i++) {
				file = path.join(folder, `${safeName(name)}-${i}.starcapture`);
			}
			await fs.promises.mkdir(folder, { recursive: true });
			await fs.promises.writeFile(file, JSON.stringify(emptyProject(name, shape.size[0], shape.size[1], 30), null, '\t'));
			await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), MontageEditorProvider.viewType);
		}),
		vscode.commands.registerCommand('starcapture.openWith', async (uri?: vscode.Uri) => {
			const target = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (!target) {
				return;
			}
			if (/\.(mp4|mov|m4v|webm|mkv|avi|starcapture)$/i.test(target.fsPath)) {
				await vscode.commands.executeCommand('vscode.openWith', target, MontageEditorProvider.viewType);
			} else if (provider.active) {
				await provider.importFiles(provider.active, [target.fsPath], true);
			} else {
				vscode.window.showInformationMessage('Ouvre d\'abord une vidéo ou un montage : ce fichier y sera ajouté.');
			}
		}),
		vscode.commands.registerCommand('starcapture.export', async () => {
			const doc = provider.active;
			if (!doc) {
				vscode.window.showInformationMessage('Aucun montage ouvert.');
				return;
			}
			if (projectDuration(doc.project) <= 0) {
				vscode.window.showWarningMessage('La timeline est vide : rien à exporter.');
				return;
			}
			const pick = await vscode.window.showQuickPick(PRESETS.map(p => ({ label: p.label, description: p.detail, id: p.id })), { title: `Exporter « ${doc.project.name} »`, placeHolder: `${doc.project.width} × ${doc.project.height} · ${clock(Math.round(projectDuration(doc.project)))}` });
			if (!pick) {
				return;
			}
			try {
				await runExport(doc, pick.id);
			} catch (err) {
				if (!(err instanceof vscode.CancellationError)) {
					vscode.window.showErrorMessage(`Export impossible : ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}),
		vscode.commands.registerCommand('starcapture.askClaude', (text?: string) => askClaude(provider.active, text)),
	);
}

/**
 * Hands the montage to Claude: the prompt says which montage, where the playhead is and what
 * is selected; Claude then drives StarCapture with its tools.
 */
async function askClaude(doc: MontageDocument | undefined, text?: string): Promise<void> {
	if (!doc) {
		return;
	}
	const selected = doc.project.clips.filter(c => doc.view.selection.includes(c.id)).map(c => `${c.id} (${c.text ? `texte « ${c.text.content.slice(0, 30)} »` : doc.project.media.find(m => m.id === c.media)?.name ?? c.track}, ${c.start.toFixed(2)}-${(c.start + (c.out - c.in) / c.speed).toFixed(2)} s)`);
	const context = `[StarCapture : montage ${doc.file}, tête de lecture ${doc.view.playhead.toFixed(2)} s${selected.length ? `, sélection : ${selected.join(', ')}` : ''}. Utilise les outils sc_*.]`;
	const message = text?.trim() ? `${context} ${text.trim()}` : `${context} `;
	let terminal = vscode.window.terminals.find(t => isClaude(t) && t === vscode.window.activeTerminal) ?? vscode.window.terminals.find(isClaude);
	if (!terminal) {
		await vscode.commands.executeCommand('orbit.claude.new');
		terminal = await new Promise<vscode.Terminal | undefined>(resolve => {
			const found = vscode.window.terminals.find(isClaude);
			if (found) {
				return resolve(found);
			}
			const sub = vscode.window.onDidOpenTerminal(t => {
				if (isClaude(t)) {
					sub.dispose();
					resolve(t);
				}
			});
			setTimeout(() => { sub.dispose(); resolve(undefined); }, 8000);
		});
		// Claude Code needs a few seconds to start before it reads its prompt.
		await new Promise(r => setTimeout(r, 6000));
	}
	if (!terminal) {
		await vscode.env.clipboard.writeText(message);
		vscode.window.showInformationMessage('Aucun terminal Claude : le contexte du montage est copié, colle-le dans Claude.');
		return;
	}
	terminal.show(false);
	terminal.sendText(`\x1b[200~${message}\x1b[201~`, false);
	if (text?.trim()) {
		setTimeout(() => terminal!.sendText('\r', false), 120);
	}
}

function isClaude(t: vscode.Terminal): boolean {
	const env = 'env' in t.creationOptions ? t.creationOptions.env : undefined;
	return !!env?.ORBIT_TERMINAL_ID || /^(Claude|Chef d'équipe)/.test(t.name);
}

function safeName(name: string): string {
	return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'montage';
}

function clock(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}

export function deactivate(): void { }
