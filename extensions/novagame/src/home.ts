/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UnityEditor, createProject, findEditors, findHub, hubProjects, installBridge, installHub, isUnityProject, launchEditor, openHub, projectVersion, unityIsOpen } from './unity';

const CONFIG_KEY = 'novagame.config';
const GAMES_KEY = 'novagame.games';
const PENDING_KEY = 'novagame.pending';
const SANDBOX = 'Bac-a-sable';
const SETUP_POLL_MS = 4000;
const SETUP_TIMEOUT_MS = 60 * 60 * 1000;
const WATCH_MS = 3000;

/** What NovaGame found once and keeps: no detection, no question the next time. */
interface Config {
	editor?: UnityEditor;
	sandbox?: string;
}

type Node =
	| { kind: 'action'; label: string; icon: string; command: string; detail?: string }
	| { kind: 'group'; id: 'games' | 'setup'; label: string }
	| { kind: 'game'; root: string; sandbox: boolean; current: boolean; recent: boolean }
	| { kind: 'step'; label: string; done: boolean; detail: string; command?: string };

/**
 * NovaGame's tab in the activity bar: the sandbox, your games, and the state of the Unity setup.
 * Anything that needs Unity goes through `ensureUnity`, which walks the user through the install
 * when it is missing and resumes what they asked for once Unity is there.
 */
export class Home implements vscode.TreeDataProvider<Node>, vscode.Disposable {

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private readonly disposables: vscode.Disposable[] = [];
	private setupTimer: NodeJS.Timeout | undefined;
	private afterSetup: (() => void) | undefined;
	private unityOpen = false;
	private readonly watchTimer: NodeJS.Timeout;

	constructor(private readonly context: vscode.ExtensionContext) {
		const refresh = () => this._onDidChangeTreeData.fire();
		const view = vscode.window.createTreeView('novagame.home', { treeDataProvider: this });
		this.disposables.push(
			view,
			// Clicking the tab brings the game up when one is open.
			view.onDidChangeVisibility(e => {
				if (e.visible) {
					refresh();
					if (this.unityOpen) {
						vscode.commands.executeCommand('orbit.unity.show');
					}
				}
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(refresh),
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('novagame') && refresh()),
			vscode.commands.registerCommand('novagame.open', () => this.open()),
			vscode.commands.registerCommand('novagame.sandbox', () => this.guard(() => this.openSandbox())),
			vscode.commands.registerCommand('novagame.newGame', () => this.guard(() => this.newGame())),
			vscode.commands.registerCommand('novagame.openGame', (node?: Node) => this.guard(() => node?.kind === 'game' ? this.openGame(node.root) : this.pickGame())),
			vscode.commands.registerCommand('novagame.setup', () => this.guard(() => this.setup())),
			vscode.commands.registerCommand('novagame.launchUnity', () => this.guard(() => this.launchUnity())),
			vscode.commands.registerCommand('novagame.resetSandbox', () => this.guard(() => this.resetSandbox())),
			vscode.commands.registerCommand('novagame.forget', (node?: Node) => node?.kind === 'game' && this.forget(node.root)),
			vscode.commands.registerCommand('novagame.reveal', (node?: Node) => node?.kind === 'game' && vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(node.root))),
			vscode.commands.registerCommand('novagame.refresh', refresh),
		);
		this.watchTimer = setInterval(() => this.watchUnity(), WATCH_MS);
		this.watchUnity();
		this.resume();
	}

	/** The game view opens by itself as soon as Unity is running on the open game. */
	private watchUnity(): void {
		const game = this.workspaceGame();
		const open = !!game && unityIsOpen(game);
		if (open === this.unityOpen) {
			return;
		}
		this.unityOpen = open;
		this._onDidChangeTreeData.fire();
		if (open && vscode.workspace.getConfiguration('novagame').get<boolean>('autoOpen', true)) {
			vscode.commands.executeCommand('orbit.unity.show');
		}
	}

	dispose(): void {
		clearInterval(this.setupTimer);
		clearInterval(this.watchTimer);
		this.disposables.forEach(d => d.dispose());
		this._onDidChangeTreeData.dispose();
	}

	private async guard(run: () => Promise<void>): Promise<void> {
		try {
			await run();
		} catch (err) {
			vscode.window.showErrorMessage(`NovaGame : ${err instanceof Error ? err.message : String(err)}`);
		}
		this._onDidChangeTreeData.fire();
	}

	// --- saved state

	private get config(): Config {
		return this.context.globalState.get<Config>(CONFIG_KEY, {});
	}

	private async save(patch: Config): Promise<void> {
		await this.context.globalState.update(CONFIG_KEY, { ...this.config, ...patch });
	}

	private folder(): string {
		return vscode.workspace.getConfiguration('novagame').get<string>('folder')?.trim() || path.join(os.homedir(), 'Orbit', 'NovaGame');
	}

	private sandboxPath(): string {
		return this.config.sandbox ?? path.join(this.folder(), SANDBOX);
	}

	private recent(): string[] {
		return this.context.globalState.get<string[]>(GAMES_KEY, []).filter(isUnityProject);
	}

	private async remember(root: string): Promise<void> {
		await this.context.globalState.update(GAMES_KEY, [root, ...this.recent().filter(r => !same(r, root))].slice(0, 20));
	}

	private async forget(root: string): Promise<void> {
		await this.context.globalState.update(GAMES_KEY, this.recent().filter(r => !same(r, root)));
		this._onDidChangeTreeData.fire();
	}

	private workspaceGame(): string | undefined {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		return isUnityProject(root) ? root : undefined;
	}

	/** The editor NovaGame settled on, re-detected only when it has gone. */
	private editor(): UnityEditor | undefined {
		const saved = this.config.editor;
		if (saved && fs.existsSync(saved.path)) {
			return saved;
		}
		const found = findEditors()[0];
		if (found) {
			this.save({ editor: found });
		}
		return found;
	}

	// --- tree

	getChildren(node?: Node): Node[] {
		if (!node) {
			const game = this.workspaceGame();
			const actions: Node[] = [];
			if (!this.editor()) {
				actions.push({ kind: 'action', label: 'Installer et configurer Unity', icon: 'tools', command: 'novagame.setup', detail: 'requis' });
			}
			if (game) {
				actions.push({ kind: 'action', label: 'Studio de jeu', icon: 'game', command: 'orbit.unity.show', detail: path.basename(game) });
			}
			actions.push(
				{ kind: 'action', label: 'Ouvrir le bac à sable', icon: 'beaker', command: 'novagame.sandbox' },
				{ kind: 'action', label: 'Nouveau jeu…', icon: 'add', command: 'novagame.newGame' },
				{ kind: 'action', label: 'Ouvrir un jeu Unity…', icon: 'folder-opened', command: 'novagame.openGame' },
			);
			return [...actions, { kind: 'group', id: 'games', label: 'Mes jeux' }, { kind: 'group', id: 'setup', label: 'Configuration' }];
		}
		if (node.kind !== 'group') {
			return [];
		}
		if (node.id === 'games') {
			const current = this.workspaceGame();
			const recent = this.recent();
			const sandbox = this.sandboxPath();
			const all = [...new Map([...(current ? [current] : []), ...recent, ...hubProjects()].map(r => [key(r), path.normalize(r)])).values()];
			return all.map(root => ({ kind: 'game', root, sandbox: same(root, sandbox), current: !!current && same(root, current), recent: recent.some(r => same(r, root)) }));
		}
		return this.steps();
	}

	private steps(): Node[] {
		const editor = this.editor();
		const hub = findHub();
		const sandbox = this.sandboxPath();
		const steps: Node[] = [
			{ kind: 'step', label: 'Unity', done: !!editor, detail: editor ? editor.version : 'à installer', command: editor ? undefined : 'novagame.setup' },
			{ kind: 'step', label: 'Unity Hub', done: !!hub, detail: hub ? 'installé' : editor ? 'absent, facultatif' : 'à installer', command: hub || editor ? undefined : 'novagame.setup' },
			{ kind: 'step', label: 'Bac à sable', done: isUnityProject(sandbox), detail: isUnityProject(sandbox) ? 'prêt' : 'créé au premier lancement', command: 'novagame.sandbox' },
		];
		const game = this.workspaceGame();
		if (game) {
			const bridge = fs.existsSync(path.join(game, 'Packages', 'com.orbit.bridge', 'package.json'));
			const open = unityIsOpen(game);
			steps.push(
				{ kind: 'step', label: 'Pont Orbit', done: bridge, detail: bridge ? 'dans le projet' : 'à ajouter', command: 'novagame.launchUnity' },
				{ kind: 'step', label: 'Éditeur Unity', done: open, detail: open ? 'ouvert sur ce jeu' : 'fermé', command: open ? 'orbit.unity.show' : 'novagame.launchUnity' },
			);
		}
		return steps;
	}

	getTreeItem(node: Node): vscode.TreeItem {
		switch (node.kind) {
			case 'action': {
				const item = new vscode.TreeItem(node.label);
				item.description = node.detail;
				item.iconPath = new vscode.ThemeIcon(node.icon, new vscode.ThemeColor('charts.purple'));
				item.command = { command: node.command, title: node.label };
				return item;
			}
			case 'group':
				return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
			case 'game': {
				const item = new vscode.TreeItem(node.sandbox ? 'Bac à sable' : path.basename(node.root));
				item.description = `${node.current ? 'ouvert · ' : ''}Unity ${projectVersion(node.root) ?? '?'}`;
				item.iconPath = new vscode.ThemeIcon(node.sandbox ? 'beaker' : 'game', node.current ? new vscode.ThemeColor('charts.purple') : undefined);
				item.tooltip = node.root;
				item.command = { command: 'novagame.openGame', title: 'Ouvrir le jeu', arguments: [node] };
				item.contextValue = node.recent && !node.sandbox ? 'game' : 'game.fixed';
				return item;
			}
			case 'step': {
				const item = new vscode.TreeItem(node.label);
				item.description = node.detail;
				item.iconPath = new vscode.ThemeIcon(node.done ? 'pass-filled' : 'circle-large-outline', new vscode.ThemeColor(node.done ? 'charts.green' : 'charts.orange'));
				if (node.command) {
					item.command = { command: node.command, title: node.label };
				}
				return item;
			}
		}
	}

	// --- Unity setup

	/**
	 * Returns the editor to work with. When Unity is missing, starts the guided install and
	 * keeps `then` to run once Unity shows up: the user is never asked twice for the same thing.
	 */
	private async ensureUnity(then: () => void): Promise<UnityEditor | undefined> {
		const editor = this.editor();
		if (editor) {
			return editor;
		}
		this.afterSetup = then;
		await this.setup();
		return undefined;
	}

	private async setup(): Promise<void> {
		const ready = this.editor();
		if (ready) {
			vscode.window.showInformationMessage(`NovaGame est prêt : Unity ${ready.version} est installé et retenu.`);
			return;
		}
		const hub = findHub();
		const install = hub ? 'Ouvrir Unity Hub' : 'Installer Unity Hub';
		const locate = 'J\'ai déjà Unity…';
		const choice = await vscode.window.showInformationMessage(
			'NovaGame a besoin de Unity',
			{
				modal: true,
				detail: hub
					? 'Unity Hub est là, mais aucun éditeur Unity. Dans le Hub : Installs, Install Editor, puis la version recommandée (LTS). NovaGame continue tout seul dès que l\'éditeur est installé.'
					: 'Unity n\'est pas installé sur cette machine. NovaGame installe Unity Hub, puis tu y choisis la version recommandée (LTS). NovaGame continue tout seul dès que l\'éditeur est installé, et retient la configuration.',
			},
			install, locate,
		);
		if (choice === locate) {
			const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Utiliser cet éditeur Unity', title: 'Choisis l\'éditeur Unity (Unity.exe)', filters: process.platform === 'win32' ? { 'Unity': ['exe'] } : undefined });
			if (picked?.[0]) {
				await vscode.workspace.getConfiguration('novagame').update('unityPath', picked[0].fsPath, vscode.ConfigurationTarget.Global);
				this.finishSetup();
			}
			return;
		}
		if (choice !== install) {
			this.afterSetup = undefined;
			return;
		}
		if (hub) {
			openHub(hub);
		} else {
			installHub();
		}
		this.watchSetup(!!hub);
	}

	/** Waits for the Hub, then for an editor, and picks the user's request back up. */
	private watchSetup(hubOpened: boolean): void {
		clearInterval(this.setupTimer);
		const started = Date.now();
		this.setupTimer = setInterval(() => {
			if (this.finishSetup()) {
				return;
			}
			if (!hubOpened) {
				const hub = findHub();
				if (hub) {
					hubOpened = true;
					openHub(hub);
					vscode.window.showInformationMessage('Unity Hub est installé. Dans le Hub : Installs, Install Editor, version recommandée (LTS). NovaGame attend la fin de l\'installation.');
					this._onDidChangeTreeData.fire();
				}
			}
			if (Date.now() - started > SETUP_TIMEOUT_MS) {
				clearInterval(this.setupTimer);
			}
		}, SETUP_POLL_MS);
	}

	private finishSetup(): boolean {
		const editor = this.editor();
		if (!editor) {
			return false;
		}
		clearInterval(this.setupTimer);
		this._onDidChangeTreeData.fire();
		const then = this.afterSetup;
		this.afterSetup = undefined;
		vscode.window.showInformationMessage(`Unity ${editor.version} détecté : NovaGame est configuré.`);
		then?.();
		return true;
	}

	// --- actions

	/** The tab's main action: show NovaGame, and the game studio when a game is open. */
	private async open(): Promise<void> {
		await vscode.commands.executeCommand('novagame.home.focus');
		if (this.workspaceGame()) {
			await vscode.commands.executeCommand('orbit.unity.show');
		}
	}

	private async openSandbox(): Promise<void> {
		const editor = await this.ensureUnity(() => vscode.commands.executeCommand('novagame.sandbox'));
		if (!editor) {
			return;
		}
		const root = this.sandboxPath();
		if (!isUnityProject(root)) {
			await createProject(root, editor, 'sandbox');
		}
		await this.save({ sandbox: root });
		await this.openGame(root);
	}

	private async newGame(): Promise<void> {
		const editor = await this.ensureUnity(() => vscode.commands.executeCommand('novagame.newGame'));
		if (!editor) {
			return;
		}
		const name = await vscode.window.showInputBox({
			title: 'Nouveau jeu',
			prompt: `Nom du jeu (créé dans ${this.folder()})`,
			value: 'Mon jeu',
			ignoreFocusOut: true,
			validateInput: value => !safeName(value) ? 'Donne un nom au jeu.' : fs.existsSync(path.join(this.folder(), safeName(value))) ? 'Un dossier porte déjà ce nom.' : undefined,
		});
		if (!name) {
			return;
		}
		const root = path.join(this.folder(), safeName(name));
		await createProject(root, editor, 'game');
		await this.openGame(root);
	}

	private async pickGame(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Ouvrir ce jeu', title: 'Dossier du projet Unity (celui qui contient Assets et ProjectSettings)' });
		const root = picked?.[0]?.fsPath;
		if (!root) {
			return;
		}
		if (!isUnityProject(root)) {
			vscode.window.showWarningMessage('Ce dossier n\'est pas un projet Unity : il doit contenir Assets et ProjectSettings.');
			return;
		}
		await this.openGame(root);
	}

	/** Shows the game in Orbit, then Unity and the game studio follow (see `start`). */
	private async openGame(root: string): Promise<void> {
		await this.remember(root);
		const current = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (current && same(current, root)) {
			await this.start(root);
			return;
		}
		// The window that opens on the game finishes the job: Unity, bridge, studio.
		await this.context.globalState.update(PENDING_KEY, { root, at: Date.now() });
		// A project already open keeps its window (and its agents): the game gets its own.
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), { forceNewWindow: !!current, forceReuseWindow: !current });
	}

	private resume(): void {
		const pending = this.context.globalState.get<{ root: string; at: number }>(PENDING_KEY);
		const root = this.workspaceGame();
		if (pending && root && same(pending.root, root)) {
			this.context.globalState.update(PENDING_KEY, undefined);
			if (Date.now() - pending.at < 120_000) {
				this.guard(() => this.start(root));
			}
		}
	}

	/** Bridge in the project, Unity on it, game studio open. */
	private async start(root: string): Promise<void> {
		await installBridge(root);
		if (vscode.workspace.getConfiguration('novagame').get<boolean>('launchUnity', true)) {
			await this.launchUnity(root);
		}
		await vscode.commands.executeCommand('novagame.home.focus');
		await vscode.commands.executeCommand('orbit.unity.show');
	}

	private async launchUnity(root = this.workspaceGame()): Promise<void> {
		if (!root) {
			vscode.window.showInformationMessage('Ouvre d\'abord un jeu : le bac à sable, ou un de tes jeux.');
			return;
		}
		await installBridge(root);
		if (unityIsOpen(root)) {
			return;
		}
		if (!await this.ensureUnity(() => vscode.commands.executeCommand('novagame.launchUnity'))) {
			return;
		}
		const wanted = projectVersion(root);
		const editors = findEditors();
		let editor = editors.find(e => e.version === wanted);
		if (!editor) {
			const other = editors[0];
			const hub = findHub();
			const choice = await vscode.window.showWarningMessage(
				`Ce jeu a été fait avec Unity ${wanted ?? 'inconnu'}, et tu as Unity ${other.version}.`,
				{ modal: true, detail: 'L\'ouvrir avec une autre version convertit le projet : fais une copie avant si le jeu compte.' },
				`Ouvrir avec Unity ${other.version}`, ...(hub ? ['Installer la bonne version (Unity Hub)'] : []),
			);
			if (choice?.startsWith('Installer') && hub) {
				openHub(hub);
				return;
			}
			if (!choice) {
				return;
			}
			editor = other;
		}
		launchEditor(editor, root);
		vscode.window.setStatusBarMessage(`$(game) Unity ${editor.version} démarre… le Studio de jeu se connecte tout seul.`, 15000);
	}

	private async resetSandbox(): Promise<void> {
		const root = this.sandboxPath();
		if (!isUnityProject(root)) {
			vscode.window.showInformationMessage('Le bac à sable n\'existe pas encore : il est créé à sa première ouverture.');
			return;
		}
		if (unityIsOpen(root)) {
			vscode.window.showWarningMessage('Unity a le bac à sable ouvert : ferme Unity avant de le remettre à zéro.');
			return;
		}
		const editor = this.editor();
		if (!editor) {
			return;
		}
		const confirm = 'Tout effacer et recommencer';
		const choice = await vscode.window.showWarningMessage('Remettre le bac à sable à zéro ?', { modal: true, detail: `Tout le contenu de ${root} est supprimé (scènes, scripts, objets). C'est définitif.` }, confirm);
		if (choice !== confirm) {
			return;
		}
		for (const name of ['Assets', 'Packages', 'ProjectSettings', 'Library', 'Temp', 'Logs', 'UserSettings', 'obj']) {
			await fs.promises.rm(path.join(root, name), { recursive: true, force: true });
		}
		await createProject(root, editor, 'sandbox');
		vscode.window.showInformationMessage('Bac à sable remis à zéro.');
	}
}

function key(file: string): string {
	return process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file);
}

function same(a: string, b: string): boolean {
	return key(a) === key(b);
}

function safeName(name: string): string {
	return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
}
