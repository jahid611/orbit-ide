/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MontageEditorProvider } from './editor';
import { emptyProject } from './project';

const RECENT_KEY = 'starcapture.recent';
const MEDIA_GLOB = '**/*.{mp4,mov,m4v,webm,mkv,avi,mp3,wav,m4a,aac,ogg,flac,png,jpg,jpeg,gif,webp}';
const MEDIA_EXCLUDE = '**/{node_modules,.git,dist,build,out,.next,exports,.orbit,Library,Temp}/**';
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
export const MEDIA_FILTERS = { 'Vidéos, sons et images': ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'png', 'jpg', 'jpeg', 'gif', 'webp'] };

type Node =
	| { kind: 'group'; id: 'montages' | 'media'; label: string }
	| { kind: 'montage'; file: string; open: boolean }
	| { kind: 'media'; uri: vscode.Uri }
	| { kind: 'action'; label: string; icon: string; command: string };

/**
 * StarCapture's own tab in the activity bar: your montages, the media of the open folder,
 * and the ways in (new montage, open a video, import files).
 */
export class Home implements vscode.TreeDataProvider<Node>, vscode.Disposable {

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private readonly disposables: vscode.Disposable[] = [];
	private media: vscode.Uri[] | undefined;
	private readonly view: vscode.TreeView<Node>;

	constructor(private readonly context: vscode.ExtensionContext, private readonly provider: MontageEditorProvider) {
		const watcher = vscode.workspace.createFileSystemWatcher(MEDIA_GLOB.replace('}', ',starcapture}'), false, true, false);
		const refresh = () => {
			this.media = undefined;
			this._onDidChangeTreeData.fire();
		};
		this.disposables.push(
			watcher, watcher.onDidCreate(refresh), watcher.onDidDelete(refresh),
			vscode.workspace.onDidChangeWorkspaceFolders(refresh),
			this.view = vscode.window.createTreeView('starcapture.home', { treeDataProvider: this }),
			// Clicking the tab brings the editor up: the open montage, else the last one.
			this.view.onDidChangeVisibility(e => {
				if (e.visible && (this.provider.active || this.recent().length)) {
					this.open();
				}
			}),
			vscode.commands.registerCommand('starcapture.open', () => this.open()),
			vscode.commands.registerCommand('starcapture.openFile', () => this.openFile()),
			vscode.commands.registerCommand('starcapture.importMedia', () => this.importMedia()),
			vscode.commands.registerCommand('starcapture.addToMontage', (node?: Node) => this.addToMontage(node)),
			vscode.commands.registerCommand('starcapture.refreshHome', refresh),
		);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this._onDidChangeTreeData.dispose();
	}

	/** Called whenever a montage opens: the list of recent montages follows. */
	remember(file: string): void {
		const list = [file, ...this.recent().filter(f => !same(f, file))].slice(0, 12);
		this.context.globalState.update(RECENT_KEY, list);
		this._onDidChangeTreeData.fire();
	}

	private recent(): string[] {
		return this.context.globalState.get<string[]>(RECENT_KEY, []).filter(f => fs.existsSync(f));
	}

	// --- tree

	async getChildren(node?: Node): Promise<Node[]> {
		if (!node) {
			return [
				{ kind: 'action', label: 'Nouveau montage', icon: 'add', command: 'starcapture.newProject' },
				{ kind: 'action', label: 'Ouvrir une vidéo ou un montage…', icon: 'folder-opened', command: 'starcapture.openFile' },
				{ kind: 'action', label: 'Importer des vidéos, sons, images…', icon: 'cloud-upload', command: 'starcapture.importMedia' },
				{ kind: 'action', label: 'Enregistrer l\'écran', icon: 'record', command: 'starcapture.record' },
				{ kind: 'group', id: 'montages', label: 'Montages' },
				{ kind: 'group', id: 'media', label: 'Médias du dossier' },
			];
		}
		if (node.kind !== 'group') {
			return [];
		}
		if (node.id === 'montages') {
			const open = [...this.provider.documents].map(d => d.file);
			const inFolder = (await vscode.workspace.findFiles('**/*.starcapture', MEDIA_EXCLUDE, 50)).map(u => u.fsPath);
			const all = [...new Set([...open, ...this.recent(), ...inFolder].map(f => path.normalize(f)))];
			return all.map(file => ({ kind: 'montage', file, open: open.some(o => same(o, file)) }));
		}
		this.media ??= (await vscode.workspace.findFiles(MEDIA_GLOB, MEDIA_EXCLUDE, 300)).sort((a, b) => rank(a.fsPath) - rank(b.fsPath) || a.fsPath.localeCompare(b.fsPath));
		return this.media.map(uri => ({ kind: 'media', uri }));
	}

	getTreeItem(node: Node): vscode.TreeItem {
		switch (node.kind) {
			case 'action': {
				const item = new vscode.TreeItem(node.label);
				item.iconPath = new vscode.ThemeIcon(node.icon, new vscode.ThemeColor('charts.yellow'));
				item.command = { command: node.command, title: node.label };
				return item;
			}
			case 'group': {
				const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
				item.contextValue = `group.${node.id}`;
				return item;
			}
			case 'montage': {
				const item = new vscode.TreeItem(path.basename(node.file, '.starcapture'));
				item.description = `${node.open ? 'ouvert · ' : ''}${shortDir(path.dirname(node.file))}`;
				item.iconPath = new vscode.ThemeIcon('device-camera-video', node.open ? new vscode.ThemeColor('charts.yellow') : undefined);
				item.tooltip = node.file;
				item.resourceUri = vscode.Uri.file(node.file);
				item.command = { command: 'vscode.openWith', title: 'Ouvrir le montage', arguments: [vscode.Uri.file(node.file), MontageEditorProvider.viewType] };
				item.contextValue = 'montage';
				return item;
			}
			case 'media': {
				const file = node.uri.fsPath;
				const item = new vscode.TreeItem(path.basename(file));
				item.description = shortDir(path.dirname(file));
				item.iconPath = new vscode.ThemeIcon(VIDEO.test(file) ? 'play-circle' : AUDIO.test(file) ? 'music' : 'file-media');
				item.resourceUri = node.uri;
				item.tooltip = `${file}\n${this.provider.active ? 'Clic : ajouter au montage ouvert' : 'Clic : ouvrir dans StarCapture'}`;
				// With a montage open, a click adds the file to it; otherwise a video opens as a new montage.
				item.command = { command: 'starcapture.addToMontage', title: 'Ajouter au montage', arguments: [node] };
				item.contextValue = 'media';
				return item;
			}
		}
	}

	// --- actions

	/** The tab's main action: bring StarCapture up, on the last montage or a fresh one. */
	async open(): Promise<void> {
		const active = this.provider.active;
		const panel = active && [...active.panels][0];
		if (panel) {
			panel.reveal();
			return;
		}
		const last = this.recent()[0];
		if (last) {
			await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(last), MontageEditorProvider.viewType);
			return;
		}
		await this.createMontage();
	}

	/** A montage without questions: the editor opens empty, ready for imports. */
	private async createMontage(): Promise<string> {
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.join(os.homedir(), 'Videos', 'StarCapture');
		await fs.promises.mkdir(folder, { recursive: true });
		let file = path.join(folder, 'Montage.starcapture');
		for (let i = 2; fs.existsSync(file); i++) {
			file = path.join(folder, `Montage ${i}.starcapture`);
		}
		await fs.promises.writeFile(file, JSON.stringify(emptyProject(path.basename(file, '.starcapture')), null, '\t'));
		await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), MontageEditorProvider.viewType);
		return file;
	}

	private async openFile(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Ouvrir dans StarCapture', filters: { 'Vidéos et montages': ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'starcapture'] } });
		if (picked?.[0]) {
			await vscode.commands.executeCommand('vscode.openWith', picked[0], MontageEditorProvider.viewType);
		}
	}

	/** Files into the open montage (creating one if none is open), placed on the timeline. */
	private async importMedia(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Importer dans StarCapture', filters: MEDIA_FILTERS });
		if (picked?.length) {
			await this.addFiles(picked.map(u => u.fsPath));
		}
	}

	private async addToMontage(node?: Node): Promise<void> {
		if (node?.kind === 'media') {
			await this.addFiles([node.uri.fsPath]);
		}
	}

	private async addFiles(files: string[]): Promise<void> {
		let doc = this.provider.active;
		if (!doc) {
			// No montage yet: a single video becomes its own montage, anything else starts a new one.
			if (files.length === 1 && VIDEO.test(files[0])) {
				await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(files[0]), MontageEditorProvider.viewType);
				return;
			}
			await this.createMontage();
			doc = await waitFor(() => this.provider.active);
			if (!doc) {
				vscode.window.showErrorMessage('StarCapture n\'a pas pu ouvrir de montage.');
				return;
			}
		}
		const media = await this.provider.importFiles(doc, files, true);
		[...doc.panels][0]?.reveal();
		vscode.window.setStatusBarMessage(`$(device-camera-video) ${media.length} média${media.length > 1 ? 's' : ''} ajouté${media.length > 1 ? 's' : ''} à « ${doc.project.name} »`, 4000);
	}
}

function rank(file: string): number {
	return VIDEO.test(file) ? 0 : AUDIO.test(file) ? 1 : 2;
}

function same(a: string, b: string): boolean {
	return process.platform === 'win32' ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase() : path.normalize(a) === path.normalize(b);
}

function shortDir(dir: string): string {
	const folder = vscode.workspace.workspaceFolders?.find(f => dir.toLowerCase().startsWith(f.uri.fsPath.toLowerCase()));
	if (folder) {
		return path.relative(folder.uri.fsPath, dir).split(path.sep).join('/');
	}
	const home = os.homedir();
	return dir.toLowerCase().startsWith(home.toLowerCase()) ? `~${dir.slice(home.length)}` : dir;
}

async function waitFor<T>(get: () => T | undefined, timeoutMs = 15000): Promise<T | undefined> {
	const deadline = Date.now() + timeoutMs;
	for (; ;) {
		const value = get();
		if (value || Date.now() > deadline) {
			return value;
		}
		await new Promise(r => setTimeout(r, 150));
	}
}
