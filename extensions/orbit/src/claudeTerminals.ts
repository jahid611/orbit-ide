/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { projectSessionsDir } from './sessions';
import { assistant, assistantId } from './assistant';
import { TERMINAL_ID_ENV } from './agentTracker';
import { attention, pageInFront } from './attention';
import { ClaudeLaunch, claudeCommandLine, claudeShell, claudeTerminalEnv, keys, models, modes, readConfig, workspaceRoot } from './config';

const execFileAsync = promisify(execFile);

const PENDING_LAUNCH_KEY = 'orbit.launchClaudeIn';
/** What Orbit knows of each agent terminal, kept across a reload of the window (see `revive`). */
const KNOWN_TERMINALS_KEY = 'orbit.agentTerminals';

interface KnownTerminal {
	/** The shell of the terminal: it lives through a reload of the window, not through a restart. */
	pid: number;
	id?: string;
	session?: { id: string; cwd: string };
	mode?: string;
}
// Unity (Library, Temp, Logs, obj) and other tools write build output nobody wants opened in front of them.
const IGNORED_PATH = /[\\/](node_modules|\.git|dist|build|out|\.next|\.turbo|\.cache|coverage|\.venv|__pycache__|Library|Temp|Logs|obj|\.orbit)[\\/]/;
// Media too: a video being rendered or downloaded is opened by its own tool once complete.
const IGNORED_FILE = /\.(meta|dll|pdb|exe|so|dylib|lock|log|tmp|bin|db|sqlite|map|part|mp4|mov|m4v|mkv|webm|avi|mp3|wav|m4a|aac|flac|ogg|starcapture)$/i;

const COLORS = ['terminal.ansiMagenta', 'terminal.ansiCyan', 'terminal.ansiGreen', 'terminal.ansiYellow', 'terminal.ansiBlue', 'terminal.ansiRed'];

/** Set on every agent terminal: which assistant runs in it. */
const ASSISTANT_ENV = 'ORBIT_ASSISTANT';

export interface CreateOptions extends ClaudeLaunch {
	cwd?: string;
	label?: string;
	/** Codicon id for the tab; Claude's own mark when absent. */
	icon?: string;
	/** Theme colour id for the tab, e.g. `terminal.ansiCyan`. */
	color?: string;
	location?: vscode.TerminalOptions['location'];
	preserveFocus?: boolean;
}

/**
 * Claude Code lives in real integrated terminals: one `claude` per terminal,
 * organised as tabs, splits or an editor grid.
 */
export class ClaudeTerminals implements vscode.Disposable {

	private readonly terminals = new Set<vscode.Terminal>();
	private readonly pids = new Map<vscode.Terminal, number>();
	/** Orbit id of each terminal, handed to Claude's hooks through the environment. */
	private readonly ids = new Map<vscode.Terminal, string>();
	private readonly sessions = new Map<vscode.Terminal, { id: string; cwd: string }>();
	/** Permission mode each terminal was started in (hooks report later changes). */
	private readonly launchModes = new WeakMap<vscode.Terminal, string>();
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	/** Fires when Claude terminals open, close or get renamed. */
	readonly onDidChange = this._onDidChange.event;
	private readonly _onDidClose = new vscode.EventEmitter<string>();
	/** Fires with the key (see `keyOf`) of a Claude terminal that closed. */
	readonly onDidClose = this._onDidClose.event;
	private lastActive: vscode.Terminal | undefined;
	private isWaiting: (terminal: vscode.Terminal) => boolean = () => false;
	private counter = 0;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly statusItem = vscode.window.createStatusBarItem('orbit.claudeTerminals', vscode.StatusBarAlignment.Right, 1000);

	private revealTimer: NodeJS.Timeout | undefined;
	private lastCreated: vscode.Uri | undefined;

	private readonly extensionUri: vscode.Uri | undefined;
	private readonly _onDidStart = new vscode.EventEmitter<{ key: string; cwd: string }>();
	/** Fires when Orbit starts an agent in a terminal. */
	readonly onDidStart = this._onDidStart.event;

	constructor(private readonly state: vscode.Memento, extensionUri?: vscode.Uri) {
		this.extensionUri = extensionUri;
		// Terminals that come back with the window: those recognised at once, then those that only
		// their shell identifies.
		for (const t of vscode.window.terminals) {
			this.adopt(t);
			this.revive(t);
		}
		this.disposables.push(
			vscode.window.onDidOpenTerminal(t => {
				this.adopt(t);
				this.revive(t);
			}),
			vscode.window.onDidCloseTerminal(t => {
				const key = this.keyOf(t);
				if (key !== undefined) {
					this._onDidClose.fire(key);
				}
				this.pids.delete(t);
				this.ids.delete(t);
				this.sessions.delete(t);
				const had = this.terminals.delete(t);
				if (had) {
					this.remember();
					this._onDidChange.fire();
				}
				if (this.lastActive === t) {
					this.lastActive = undefined;
				}
				this.updateStatus();
			}),
			vscode.window.onDidChangeActiveTerminal(t => {
				if (t && this.terminals.has(t)) {
					this.lastActive = t;
				}
			}),
			...this.watchNewFiles(),
			vscode.window.registerTerminalProfileProvider('orbit.claude', {
				provideTerminalProfile: () => new vscode.TerminalProfile(this.profileOptions()),
			}),
		);
		this.statusItem.name = 'Claude Terminals';
		this.statusItem.command = 'orbit.claude.switch';
		this.updateStatus();
		this.statusItem.show();
	}

	/** Open a terminal with `claude` already running in it. */
	create(options: CreateOptions = {}): vscode.Terminal {
		const cwd = options.cwd ?? workspaceRoot();
		const flags = [...(options.flags ?? [])];
		// Pin the session id so Orbit knows which transcript belongs to this terminal.
		const resumeIndex = flags.indexOf('--resume');
		let sessionId = resumeIndex >= 0 ? flags[resumeIndex + 1] : undefined;
		// Codex names its sessions itself: Orbit learns the id from the conversation log.
		if (!sessionId && !flags.includes('--continue') && resumeIndex < 0 && assistantId() === 'claude') {
			sessionId = randomUUID();
			flags.push('--session-id', sessionId);
		}
		const terminal = vscode.window.createTerminal({
			...this.baseOptions(options.label, options.icon, options.color),
			...claudeShell(),
			cwd,
			location: options.location ?? vscode.TerminalLocation.Panel,
		});
		if (sessionId) {
			this.sessions.set(terminal, { id: sessionId, cwd });
		}
		this.adopt(terminal);
		this.launchModes.set(terminal, (options.permissionMode ?? readConfig().permissionMode) || claudeDefaultMode());
		const key = this.keyOf(terminal);
		terminal.sendText(claudeCommandLine({ ...options, flags, terminalId: key }), true);
		if (key) {
			this._onDidStart.fire({ key, cwd });
		}
		terminal.show(options.preserveFocus);
		this.lastActive = terminal;
		return terminal;
	}

	/**
	 * Entry point for "New Claude Terminal": without an open project, Claude would write
	 * files where the user can't see them, so offer to create or open one first.
	 */
	async start(): Promise<void> {
		if (vscode.workspace.workspaceFolders?.length) {
			this.create();
			return;
		}
		// Without a folder, what Claude writes would be invisible: start from a project instead.
		const pick = await vscode.window.showQuickPick([
			{ label: '$(rocket) Projet rapide', detail: `Un nouveau dossier tout de suite, sans question : tu vois chaque fichier apparaître pendant que Claude code`, id: 'quick' },
			{ label: '$(new-folder) Nouveau projet…', detail: `Tu choisis le nom ; le dossier est créé dans ${readConfig().projectsFolder}`, id: 'new' },
			{ label: '$(folder-opened) Ouvrir un dossier…', detail: 'Lance Claude dans un projet existant', id: 'open' },
			{ label: '$(repo-clone) Partir d\'un dépôt GitHub ou GitLab…', detail: 'Un de tes dépôts, ou une adresse : il est récupéré et Claude s\'y lance', id: 'repo' },
			{ label: '$(home) Sans dossier', detail: 'Déconseillé : Claude travaille dans ton dossier personnel et l\'explorateur reste vide', id: 'home' },
		], { title: 'Démarrer Claude', placeHolder: 'Où Claude doit-il travailler ?' });
		if (pick?.id === 'quick') {
			await this.quickProject();
		} else if (pick?.id === 'new') {
			await this.newProject();
		} else if (pick?.id === 'open') {
			const folder = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Lancer Claude ici' });
			if (folder?.[0]) {
				await this.openAndLaunch(folder[0].fsPath);
			}
		} else if (pick?.id === 'repo') {
			await vscode.commands.executeCommand('orbit.project.fromRepo');
		} else if (pick?.id === 'home') {
			this.create();
		}
	}

	/**
	 * Create a project folder, switch this window to it, and start Claude there.
	 * `parent` defaults to the projects folder (~/Orbit); `ask` lets the user pick another one.
	 */
	async newProject(options: { askParent?: boolean } = {}): Promise<void> {
		let base = readConfig().projectsFolder;
		if (options.askParent) {
			const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri: vscode.Uri.file(base), openLabel: 'Créer le projet ici', title: 'Où créer le projet ?' });
			if (!picked?.[0]) {
				return;
			}
			base = picked[0].fsPath;
		}
		const name = await vscode.window.showInputBox({
			title: 'Nouveau projet',
			prompt: `Le dossier sera créé dans ${base}, puis Claude s'y lancera`,
			placeHolder: 'Nom du projet, ex. : mon-jeu, site-portfolio…',
			ignoreFocusOut: true,
			validateInput: value => {
				const slug = slugify(value);
				if (!value.trim()) {
					return 'Donne un nom au projet';
				}
				return slug && fs.existsSync(path.join(base, slug)) ? `Le dossier ${slug} existe déjà ici : choisis un autre nom` : undefined;
			},
		});
		if (!name) {
			return;
		}
		const dir = path.join(base, slugify(name) || 'projet');
		await fs.promises.mkdir(dir, { recursive: true });
		try {
			await execFileAsync('git', ['init', '-q'], { cwd: dir });
		} catch {
			// git is optional
		}
		await this.openAndLaunch(dir);
	}

	/** A fresh project folder with a dated name, opened at once with Claude ready. */
	async quickProject(): Promise<void> {
		const base = readConfig().projectsFolder;
		const now = new Date();
		const stamp = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
		let dir = path.join(base, `projet-${stamp}`);
		for (let i = 2; fs.existsSync(dir); i++) {
			dir = path.join(base, `projet-${stamp}-${i}`);
		}
		await fs.promises.mkdir(dir, { recursive: true });
		try {
			await execFileAsync('git', ['init', '-q'], { cwd: dir });
		} catch {
			// git is optional
		}
		await this.openAndLaunch(dir);
	}

	/** Every way to move to another project, in one list: new, existing, recent. */
	async switchProject(): Promise<void> {
		type Item = vscode.QuickPickItem & { run?: () => unknown };
		const current = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const items: Item[] = [
			{ label: '$(rocket) Projet rapide', detail: 'Un dossier daté, créé et ouvert tout de suite, Claude prêt', run: () => this.quickProject() },
			{ label: '$(add) Nouveau projet…', detail: `Tu choisis le nom, le dossier est créé dans ${readConfig().projectsFolder} et Claude s'y lance`, run: () => this.newProject() },
			{ label: '$(new-folder) Nouveau projet ailleurs…', detail: 'Choisis d\'abord le dossier parent', run: () => this.newProject({ askParent: true }) },
			{ label: '$(folder-opened) Ouvrir un dossier…', detail: 'Un projet existant ; Claude s\'y lance aussi', run: () => this.openFolder() },
			{ label: '$(repo-clone) Partir d\'un dépôt GitHub ou GitLab…', detail: 'Un de tes dépôts, ou une adresse : il est récupéré et Claude s\'y lance', run: () => vscode.commands.executeCommand('orbit.project.fromRepo') },
			{ label: '$(organization) Partir d\'un template de la communauté…', detail: 'Les projets partagés par les autres utilisateurs d\'Orbit', run: () => vscode.commands.executeCommand('orbit.community.show') },
		];
		const recent = (await recentFolders()).filter(dir => !samePath(dir, current)).slice(0, 25);
		if (recent.length) {
			items.push({ label: 'Récents', kind: vscode.QuickPickItemKind.Separator });
			items.push(...recent.map(dir => ({ label: `$(folder) ${path.basename(dir)}`, description: path.dirname(dir), run: () => this.openAndLaunch(dir) })));
		}
		const pick = await vscode.window.showQuickPick(items, { title: 'Changer de projet', placeHolder: current ? `Projet actuel : ${path.basename(current)} — où veux-tu aller ?` : 'Où veux-tu travailler ?', matchOnDescription: true });
		await pick?.run?.();
	}

	private async openFolder(): Promise<void> {
		const folder = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Ouvrir et lancer Claude' });
		if (folder?.[0]) {
			await this.openAndLaunch(folder[0].fsPath);
		}
	}

	/** Open a project in this window with Claude ready in it. */
	openProject(dir: string): Promise<void> {
		return this.openAndLaunch(dir);
	}

	/**
	 * Where another project opens when this window already shows one: beside it, in a window of
	 * its own (both projects stay at work), or in its place. Asked every time unless the setting
	 * `orbit.project.openIn` decides. Undefined: the user changed their mind.
	 */
	async chooseWindow(dir: string): Promise<'new' | 'replace' | undefined> {
		const current = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!current || samePath(current, dir)) {
			return 'replace';
		}
		const setting = vscode.workspace.getConfiguration('orbit').get<string>('project.openIn', 'ask');
		if (setting === 'newWindow') {
			return 'new';
		}
		if (setting === 'replace') {
			return 'replace';
		}
		const agents = this.terminals.size;
		const beside = 'Ouvrir en plus';
		const instead = 'Remplacer celui-ci';
		const answer = await vscode.window.showInformationMessage(`Ouvrir « ${path.basename(dir)} »`, {
			modal: true,
			detail: `Tu travailles sur « ${path.basename(current)} ».\n\n« Ouvrir en plus » : une deuxième fenêtre Orbit s'ouvre sur « ${path.basename(dir)} », celle-ci reste telle quelle${agents ? `, avec ${agents > 1 ? `ses ${agents} agents` : 'son agent'}` : ''}.\n\n« Remplacer celui-ci » : cette fenêtre passe sur « ${path.basename(dir)} »${agents ? ` et ${agents > 1 ? `ses ${agents} agents sont fermés` : 'son agent est fermé'}` : ''}.`,
		}, beside, instead);
		return answer === beside ? 'new' : answer === instead ? 'replace' : undefined;
	}

	/** Open a folder with Claude starting in it: in this window, or in another one when the user says so. */
	private async openAndLaunch(dir: string): Promise<void> {
		const where = await this.chooseWindow(dir);
		if (!where) {
			return;
		}
		await this.prepareLaunch(dir);
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), where === 'new' ? { forceNewWindow: true } : { forceReuseWindow: true });
	}

	/** The window that opens `dir` next starts a Claude there, with `prompt` as its first message. */
	prepareLaunch(dir: string, prompt?: string): Thenable<void> {
		return this.state.update(PENDING_LAUNCH_KEY, { dir, prompt, at: Date.now() });
	}

	/** Focus the most recent Claude terminal, or start one. */
	focus(): void {
		const target = this.lastActive ?? [...this.terminals].pop();
		if (target) {
			target.show();
		} else {
			this.start();
		}
	}

	split(): void {
		const parent = vscode.window.activeTerminal ?? this.lastActive;
		this.create(parent ? { location: { parentTerminal: parent } } : {});
	}

	inEditor(): void {
		this.create({ location: { viewColumn: vscode.ViewColumn.Beside } });
	}

	async grid(): Promise<void> {
		const pick = await vscode.window.showQuickPick([
			{ label: '2 agents', detail: 'Côte à côte', n: 2 },
			{ label: '3 agents', detail: 'Trois colonnes', n: 3 },
			{ label: '4 agents', detail: 'Grille 2 × 2', n: 4 },
			{ label: '6 agents', detail: 'Grille 3 × 2', n: 6 },
		], { title: 'Grille de terminaux Claude' });
		if (!pick) {
			return;
		}
		const rows = pick.n >= 4 ? 2 : 1;
		const cols = pick.n / rows;
		const row = { groups: Array.from({ length: cols }, () => ({})) };
		await vscode.commands.executeCommand('vscode.setEditorLayout', rows === 1
			? { orientation: 0, groups: row.groups }
			: { orientation: 1, groups: Array.from({ length: rows }, () => ({ groups: row.groups.map(() => ({})) })) });
		for (let i = 0; i < pick.n; i++) {
			this.create({ location: { viewColumn: (i + 1) as vscode.ViewColumn }, preserveFocus: i !== 0 });
		}
	}

	/** Start Claude in an isolated git worktree so it can't step on your working copy. */
	async worktree(): Promise<void> {
		const root = workspaceRoot();
		const branch = await vscode.window.showInputBox({
			title: 'Claude dans un worktree isolé',
			prompt: 'Nom de la branche',
			value: `orbit/${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`,
			validateInput: v => /^[\w./-]+$/.test(v) ? undefined : 'Lettres, chiffres, / . - _ uniquement',
		});
		if (!branch) {
			return;
		}
		const dir = path.join(path.dirname(root), `${path.basename(root)}-${branch.replace(/[/.]/g, '-')}`);
		try {
			await execFileAsync('git', ['worktree', 'add', '-b', branch, dir], { cwd: root });
		} catch (err) {
			vscode.window.showErrorMessage(`Impossible de créer le worktree : ${String(err).split('\n')[0]}`);
			return;
		}
		this.create({ cwd: dir, label: `${assistant().name} · ${branch}` });
	}

	async withOptions(): Promise<void> {
		const model = await vscode.window.showQuickPick(models().map(m => ({ label: m.label, id: m.id })), { title: 'Modèle (1/2)' });
		if (!model) {
			return;
		}
		const mode = await vscode.window.showQuickPick(modes().map(m => ({ label: m.label, detail: m.hint, id: m.id })), { title: 'Mode de permission (2/2)' });
		if (!mode) {
			return;
		}
		this.create({ model: model.id, permissionMode: mode.id, label: `${assistant().name} · ${model.id || 'défaut'}` });
	}

	/** Run a slash command (or send a message) in a Claude terminal, as if typed and submitted. */
	sendCommand(terminal: vscode.Terminal, text: string): void {
		terminal.sendText(text, false);
		// Claude's prompt needs a beat to take the text before the Enter key.
		setTimeout(() => terminal.sendText('\r', false), 80);
	}

	/** Submit a message to Claude; bracketed paste keeps a multi-line message in one prompt. */
	sendMessage(terminal: vscode.Terminal, text: string): void {
		this.sendCommand(terminal, text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text);
	}

	/** Type an @-mention of the current file/selection into the active Claude prompt. */
	async sendSelection(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		const file = vscode.workspace.asRelativePath(editor.document.uri, false);
		const sel = editor.selection;
		const ref = sel.isEmpty ? `@${file}` : `@${file}#L${sel.start.line + 1}-${sel.end.line + 1}`;
		const target = this.lastActive ?? [...this.terminals].pop();
		if (!target) {
			// A Claude still starting would drop typed text: hand it the mention as its first message.
			this.create({ flags: [ref] });
			return;
		}
		target.show();
		target.sendText(`${ref} `, false);
	}

	/** Tells whether an agent waits for a permission: typing there would answer the prompt. */
	setWaitingProvider(provider: (terminal: vscode.Terminal) => boolean): void {
		this.isWaiting = provider;
	}

	async broadcast(): Promise<void> {
		if (!this.terminals.size) {
			vscode.window.showInformationMessage('Aucun terminal Claude ouvert.');
			return;
		}
		const text = await vscode.window.showInputBox({ title: `Envoyer à ${this.terminals.size} terminaux Claude`, placeHolder: 'Message envoyé à tous les agents…' });
		if (!text) {
			return;
		}
		const skipped: string[] = [];
		for (const t of this.terminals) {
			if (this.isWaiting(t)) {
				skipped.push(t.name);
			} else {
				this.sendMessage(t, text);
			}
		}
		if (skipped.length) {
			vscode.window.showWarningMessage(`Message non envoyé à ${skipped.join(', ')} : ${skipped.length > 1 ? 'ils attendent' : 'il attend'} une autorisation.`);
		}
	}

	async switch(): Promise<void> {
		const items: (vscode.QuickPickItem & { terminal?: vscode.Terminal; action?: () => unknown })[] = [...this.terminals].map(t => ({
			label: `$(sparkle) ${t.name}`,
			description: t === vscode.window.activeTerminal ? 'actif' : undefined,
			terminal: t,
		}));
		items.push(
			{ label: '', kind: vscode.QuickPickItemKind.Separator },
			{ label: '$(globe) Vue Orbite : tous les agents sur une carte', action: () => vscode.commands.executeCommand('orbit.map.show') },
			{ label: '$(eye) Vue vivante : voir et modifier l\'interface en direct', action: () => vscode.commands.executeCommand('orbit.preview.show') },
			{ label: '$(database) Base de données : explorer et modifier avec Claude', action: () => vscode.commands.executeCommand('orbit.database.show') },
			{ label: '$(game) Studio de jeu Unity : voir et piloter l\'éditeur', action: () => vscode.commands.executeCommand('orbit.unity.show') },
			{ label: '$(add) Nouveau terminal Claude', action: () => this.start() },
			{ label: '$(new-folder) Nouveau projet avec Claude…', action: () => this.newProject() },
			{ label: '$(split-horizontal) Claude en split', action: () => this.split() },
			{ label: '$(layout) Grille d\'agents…', action: () => this.grid() },
			{ label: '$(git-branch) Claude dans un worktree…', action: () => this.worktree() },
			{ label: '$(organization) Chef d\'orchestre : découper une tâche entre plusieurs agents…', action: () => vscode.commands.executeCommand('orbit.conductor.start') },
			{ label: '$(git-merge) Fusionner le travail des agents…', action: () => vscode.commands.executeCommand('orbit.conductor.merge') },
			{ label: '$(history) Discussions récentes…', action: () => vscode.commands.executeCommand('orbit.sessions.search') },
			{ label: '$(broadcast) Envoyer un message à tous…', action: () => this.broadcast() },
		);
		const pick = await vscode.window.showQuickPick(items, { title: 'Terminaux Claude', placeHolder: 'Aller à un agent ou en lancer un' });
		if (pick?.terminal) {
			pick.terminal.show();
		} else {
			await pick?.action?.();
		}
	}

	private goneProvider: ((terminal: vscode.Terminal) => boolean) | undefined;
	private lastDiscussion: (() => { id: string; name?: string; title: string } | undefined) | undefined;

	/** How to tell a terminal whose agent is gone, and which discussion the project was last on. */
	setReopening(gone: (terminal: vscode.Terminal) => boolean, lastDiscussion: () => { id: string; name?: string; title: string } | undefined, known: Promise<unknown>): void {
		this.goneProvider = gone;
		this.lastDiscussion = lastDiscussion;
		this.ghostsKnown = known;
	}
	/** Settles once every terminal that came back with the window has been looked at. */
	private ghostsKnown: Promise<unknown> = Promise.resolve();

	/** Open the first Claude terminal when a project opens, like a fresh Claude Code session. */
	autoStart(): void {
		const stored = this.state.get<string | { dir: string; prompt?: string; at?: number }>(PENDING_LAUNCH_KEY);
		const pending = typeof stored === 'string' ? { dir: stored } : stored;
		// Windows paths differ in drive-letter case between the dialog and the workspace.
		const requested = !!pending && samePath(pending.dir, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
		// The launch belongs to the window that opens that folder (with several windows, not to the others).
		if (requested || (pending?.at && Date.now() - pending.at > 5 * 60 * 1000)) {
			this.state.update(PENDING_LAUNCH_KEY, undefined);
		}
		if (requested && pending?.prompt) {
			// A Claude handed this project over with instructions: start the new one with them.
			setTimeout(() => this.create({ flags: [pending.prompt!] }), 1500);
			return;
		}
		if (!requested && (!readConfig().autoStart || !vscode.workspace.workspaceFolders?.length)) {
			return;
		}
		// Give revived terminals a moment to come back before deciding.
		setTimeout(async () => {
			// Telling an agent's terminal from the shell it left behind asks the system a question:
			// the answer used to come after the decision, and the dead shell stayed alone.
			await Promise.race([this.ghostsKnown, new Promise(resolve => setTimeout(resolve, 12000))]);
			for (const t of vscode.window.terminals) {
				this.adopt(t);
			}
			// The user changed assistant: terminals of the other one do not come back with the window.
			this.closeOtherAssistants();
			// Terminals that came back without their agent (the window was closed) are shells with
			// an old conversation on screen: they go, and the discussion itself comes back below.
			for (const ghost of [...this.terminals].filter(t => this.goneProvider?.(t))) {
				this.terminals.delete(ghost);
				ghost.dispose();
			}
			if (!this.terminals.size) {
				const last = readConfig().resumeOnOpen && assistantId() === 'claude' ? this.lastDiscussion?.() : undefined;
				if (last) {
					this.resume(last.id, last.name);
					vscode.window.showInformationMessage(`Discussion reprise : « ${last.title} »`, 'Nouvelle discussion').then(choice => choice && this.create());
				} else {
					this.create();
				}
			}
		}, 2500);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.statusItem.dispose();
		this._onDidChange.dispose();
		this._onDidClose.dispose();
		this._onDidStart.dispose();
	}

	/** Surface files Claude creates: preview them so the explorer reveals them, keeping focus in the terminal. */
	private watchNewFiles(): vscode.Disposable[] {
		const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, true);
		return [watcher, watcher.onDidCreate(uri => {
			if (!readConfig().revealNewFiles || !this.terminals.size || IGNORED_PATH.test(uri.fsPath) || IGNORED_FILE.test(uri.fsPath) || path.basename(uri.fsPath).startsWith('.')) {
				return;
			}
			this.lastCreated = uri;
			clearTimeout(this.revealTimer);
			this.revealTimer = setTimeout(async () => {
				const target = this.lastCreated;
				try {
					if (!target || attention.large || (await vscode.workspace.fs.stat(target)).type !== vscode.FileType.File) {
						return;
					}
					await vscode.commands.executeCommand('vscode.open', target, { preview: true, preserveFocus: true, background: pageInFront(), viewColumn: vscode.ViewColumn.One });
				} catch {
					// file vanished (temp file)
				}
			}, 500);
		})];
	}

	private baseOptions(label?: string, icon?: string, color?: string): vscode.TerminalOptions {
		this.counter++;
		return {
			name: label ?? (this.counter === 1 ? assistant().name : `${assistant().name} ${this.counter}`),
			// The assistant's mark on every agent tab; agents with a role show the icon of their job.
			iconPath: icon ? new vscode.ThemeIcon(icon) : this.extensionUri ? vscode.Uri.joinPath(this.extensionUri, 'media', assistant().image) : new vscode.ThemeIcon('sparkle'),
			color: new vscode.ThemeColor(color ?? COLORS[(this.counter - 1) % COLORS.length]),
			env: { ...claudeTerminalEnv(randomUUID()), [ASSISTANT_ENV]: assistantId() },
			isTransient: false,
		};
	}

	private profileOptions(): vscode.TerminalOptions {
		const base = { ...this.baseOptions(), cwd: workspaceRoot() };
		if (process.platform === 'win32') {
			// Run claude, and stay in PowerShell when it exits.
			return { ...base, shellPath: 'powershell.exe', shellArgs: ['-NoLogo', '-NoExit', '-Command', claudeCommandLine()] };
		}
		const shell = process.env.SHELL || '/bin/zsh';
		return {
			...base,
			shellPath: shell,
			// Run claude, then drop back to an interactive shell when it exits.
			shellArgs: ['-l', '-i', '-c', `${claudeCommandLine()}; exec ${shell} -l -i`],
		};
	}

	/**
	 * After a reload of the window, a terminal comes back with its agent still running in it, but
	 * not always with what Orbit set when it created it: its identifier is gone, and a terminal
	 * that is not called « Claude » (the team lead, a renamed agent) was not recognised at all.
	 * Its status was lost, pages took it for missing and opened a second agent beside it. What
	 * Orbit knew is therefore kept by the shell's process, which a reload does not change.
	 */
	private revive(terminal: vscode.Terminal): void {
		Promise.resolve(terminal.processId).then(pid => {
			const known = pid === undefined ? undefined : this.state.get<KnownTerminal[]>(KNOWN_TERMINALS_KEY, []).find(k => k.pid === pid);
			if (!known) {
				return;
			}
			const fresh = !this.terminals.has(terminal);
			this.terminals.add(terminal);
			this.pids.set(terminal, known.pid);
			if (known.id && !this.ids.has(terminal)) {
				this.ids.set(terminal, known.id);
			}
			if (known.session && !this.sessions.has(terminal)) {
				this.sessions.set(terminal, known.session);
			}
			if (known.mode && !this.launchModes.has(terminal)) {
				this.launchModes.set(terminal, known.mode);
			}
			if (fresh || known.id) {
				this.updateStatus();
				this._onDidChange.fire();
			}
		}, () => undefined);
	}

	/** Writes down what is known of the agent terminals that are open, for the next reload. */
	private remember(): void {
		const known: KnownTerminal[] = [];
		for (const terminal of this.terminals) {
			const pid = this.pids.get(terminal);
			if (pid !== undefined) {
				known.push({ pid, id: this.ids.get(terminal), session: this.sessions.get(terminal), mode: this.launchModes.get(terminal) });
			}
		}
		this.state.update(KNOWN_TERMINALS_KEY, known);
	}

	private adopt(terminal: vscode.Terminal, force = false): void {
		// The id survives reloads and renames; the name only identifies terminals from older builds.
		const env = 'env' in terminal.creationOptions ? terminal.creationOptions.env : undefined;
		const id = env?.[TERMINAL_ID_ENV] ?? undefined;
		if ((force || id || /^(Claude|ChatGPT|Chef d.équipe|✦)/.test(terminal.name) || /^(Claude|ChatGPT|Chef d.équipe|✦)/.test(terminal.creationOptions.name ?? '')) && !this.terminals.has(terminal)) {
			this.terminals.add(terminal);
			if (id) {
				this.ids.set(terminal, id);
			}
			terminal.processId.then(pid => {
				if (pid !== undefined) {
					this.pids.set(terminal, pid);
					this.remember();
					this._onDidChange.fire();
				}
			});
			this.updateStatus();
			this._onDidChange.fire();
		}
	}

	/** The assistant a terminal was started with (terminals from before the choice existed ran Claude). */
	assistantOf(terminal: vscode.Terminal): string {
		const env = 'env' in terminal.creationOptions ? terminal.creationOptions.env : undefined;
		return env?.[ASSISTANT_ENV] ?? 'claude';
	}

	/** Closes the agent terminals that run another assistant than the one in use. Returns how many. */
	closeOtherAssistants(): number {
		const others = [...this.terminals].filter(t => this.assistantOf(t) !== assistantId());
		for (const t of others) {
			this.terminals.delete(t);
			t.dispose();
		}
		if (others.length) {
			this.updateStatus();
			this._onDidChange.fire();
		}
		return others.length;
	}

	isClaude(terminal: vscode.Terminal): boolean {
		return this.terminals.has(terminal);
	}

	list(): vscode.Terminal[] {
		return [...this.terminals];
	}

	/** The Claude terminal the user is looking at, or the last one they used. */
	current(): vscode.Terminal | undefined {
		const active = vscode.window.activeTerminal;
		return active && this.terminals.has(active) ? active : this.lastActive ?? [...this.terminals].pop();
	}

	pidOf(terminal: vscode.Terminal): number | undefined {
		return this.pids.get(terminal);
	}

	/** Permission mode a terminal was started in, when Orbit started it in this session. */
	launchModeOf(terminal: vscode.Terminal): string | undefined {
		return this.launchModes.get(terminal);
	}

	/** Folder a Claude terminal was started in. */
	cwdOf(terminal: vscode.Terminal): string | undefined {
		const cwd = 'cwd' in terminal.creationOptions ? terminal.creationOptions.cwd : undefined;
		return typeof cwd === 'string' ? cwd : cwd?.fsPath;
	}

	/** Theme colour id of the terminal's tab, which identifies its agent everywhere in the IDE. */
	colorOf(terminal: vscode.Terminal): string {
		const color = 'color' in terminal.creationOptions ? terminal.creationOptions.color : undefined;
		return color?.id ?? COLORS[0];
	}

	/** What the agent tracker knows this terminal as: its Orbit id, or its shell pid for older terminals. */
	keyOf(terminal: vscode.Terminal): string | undefined {
		return this.ids.get(terminal) ?? this.pids.get(terminal)?.toString();
	}

	byKey(key: string): vscode.Terminal | undefined {
		return [...this.terminals].find(t => this.keyOf(t) === key);
	}

	/** Transcript of a terminal Orbit started, known before Claude reports it through hooks. */
	sessionFileFor(terminal: vscode.Terminal): string | undefined {
		const session = this.sessions.get(terminal);
		return session && path.join(projectSessionsDir(session.cwd), `${session.id}.jsonl`);
	}

	sessionIdFor(terminal: vscode.Terminal): string | undefined {
		return this.sessions.get(terminal)?.id;
	}

	async rename(terminal: vscode.Terminal, name: string): Promise<void> {
		const pid = this.pids.get(terminal) ?? await terminal.processId;
		if (pid !== undefined) {
			await vscode.commands.executeCommand('_orbit.renameTerminal', pid, name);
			this._onDidChange.fire();
		}
	}

	/** Resume a saved conversation, or jump to the terminal where it is already open. */
	resume(sessionId: string, name: string | undefined, isOpenIn?: vscode.Terminal): void {
		if (isOpenIn) {
			isOpenIn.show();
			return;
		}
		const open = [...this.sessions].find(([, s]) => s.id === sessionId)?.[0];
		if (open) {
			open.show();
			return;
		}
		this.create({ flags: ['--resume', sessionId], label: name ? `${assistant().name} · ${name}` : undefined });
	}

	private updateStatus(): void {
		const n = this.terminals.size;
		const who = assistant();
		this.statusItem.text = n ? `$(${who.icon}) ${who.name} ${n}` : `$(${who.icon}) ${who.name}`;
		this.statusItem.tooltip = `Terminaux ${who.name} (${keys('⌥⌘A', 'Ctrl+Alt+A')})`;
	}
}

/** The mode Claude Code starts in without a flag: the user's own setting, else `default`. */
function claudeDefaultMode(): string {
	try {
		const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
		return typeof settings?.permissions?.defaultMode === 'string' ? settings.permissions.defaultMode : 'default';
	} catch {
		return 'default';
	}
}

function slugify(name: string): string {
	return name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '-').replace(/^\.+|\.+$/g, '');
}

function samePath(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) {
		return false;
	}
	const normal = (p: string) => process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p);
	return normal(a) === normal(b);
}

/** Folders opened recently in Orbit, plus the projects created in the projects folder. */
async function recentFolders(): Promise<string[]> {
	const found: string[] = [];
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const recent = await vscode.commands.executeCommand<any>('_workbench.getRecentlyOpened');
		for (const entry of recent?.workspaces ?? []) {
			const uri = entry?.folderUri;
			if (uri) {
				const folder = uri instanceof vscode.Uri ? uri : vscode.Uri.from(uri);
				if (folder.scheme === 'file' && fs.existsSync(folder.fsPath)) {
					found.push(folder.fsPath);
				}
			}
		}
	} catch {
		// internal command unavailable
	}
	const base = readConfig().projectsFolder;
	try {
		for (const entry of await fs.promises.readdir(base, { withFileTypes: true })) {
			const dir = path.join(base, entry.name);
			if (entry.isDirectory() && !found.some(f => samePath(f, dir))) {
				found.push(dir);
			}
		}
	} catch {
		// no projects folder yet
	}
	return found;
}
