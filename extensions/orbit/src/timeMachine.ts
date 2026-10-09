/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AgentStatus, AgentTracker, ORBIT_DIR } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { timeAgo } from './sessions';

const execFileAsync = promisify(execFile);

const SNAPSHOTS_DIR = path.join(ORBIT_DIR, 'snapshots');
const TURNS_FILE = 'orbit-turns.jsonl';
const MAX_TURNS = 300;
const SCHEME = 'orbit-snapshot';
/** Never part of a snapshot, whatever the project's own ignore rules say. */
const ALWAYS_IGNORED = ['node_modules/', '.orbit/', '.venv/', '__pycache__/', '.next/', '.turbo/', '.cache/'];
/** Snapshots are Orbit's own: no signing, no line-ending rewriting, the bytes on disk as they are. */
const GIT_OPTIONS = ['-c', 'user.name=Orbit', '-c', 'user.email=orbit@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.longpaths=true', '-c', 'core.quotepath=false'];

export interface Turn {
	id: string;
	root: string;
	agent: string;
	prompt: string;
	at: number;
	/** Snapshot taken when the message was sent. */
	before: string;
	/** Snapshot taken when the agent finished; missing while it works. */
	after?: string;
	/** Set on the entries a rewind creates, so it can itself be undone. */
	rewind?: boolean;
}

interface ChangedFile {
	status: string;
	file: string;
	/** Lines added and removed; missing for binary files. */
	added?: number;
	removed?: number;
}

/**
 * A private git repository per project, kept outside of it, that photographs the working
 * tree. It never touches the project's own `.git`, branches or index.
 */
class ShadowRepo {

	readonly gitDir: string;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(readonly root: string) {
		const id = createHash('sha1').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('hex').slice(0, 16);
		this.gitDir = path.join(SNAPSHOTS_DIR, id);
	}

	/** One git operation at a time: snapshots share an index. */
	private run<T>(task: () => Promise<T>): Promise<T> {
		const next = this.queue.then(task, task);
		this.queue = next.catch(() => undefined);
		return next;
	}

	async git(args: string[]): Promise<string> {
		// Another Orbit window may hold the repository's lock for a moment: wait and retry.
		for (let attempt = 0; ; attempt++) {
			try {
				const { stdout } = await execFileAsync('git', ['--git-dir', this.gitDir, '--work-tree', this.root, ...GIT_OPTIONS, ...args], { cwd: this.root, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
				return stdout;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (attempt >= 4 || !/\.lock|could not lock|File exists/.test(message)) {
					throw err;
				}
				await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
			}
		}
	}

	snapshot(message: string): Promise<string> {
		return this.run(async () => {
			if (!fs.existsSync(path.join(this.gitDir, 'HEAD'))) {
				await fs.promises.mkdir(this.gitDir, { recursive: true });
				await this.git(['init', '-q']).catch(err => {
					// Initialised meanwhile by another window: fine.
					if (!fs.existsSync(path.join(this.gitDir, 'HEAD'))) {
						throw err;
					}
				});
				await fs.promises.mkdir(path.join(this.gitDir, 'info'), { recursive: true });
				await fs.promises.writeFile(path.join(this.gitDir, 'info', 'exclude'), ALWAYS_IGNORED.join('\n') + '\n');
			}
			await this.git(['add', '-A']);
			await this.git(['commit', '-q', '--allow-empty', '-m', message]);
			return (await this.git(['rev-parse', 'HEAD'])).trim();
		});
	}

	async changes(from: string, to: string): Promise<ChangedFile[]> {
		const out = await this.git(['diff', '--no-renames', '--name-status', from, to]);
		const stats = new Map<string, [number, number]>();
		try {
			for (const line of (await this.git(['diff', '--no-renames', '--numstat', from, to])).split('\n')) {
				const [added, removed, ...rest] = line.split('\t');
				if (rest.length && added !== '-') {
					stats.set(rest.join('\t'), [Number(added), Number(removed)]);
				}
			}
		} catch {
			// counts are a nicety: the list of files is what matters
		}
		return out.split('\n').filter(Boolean).map(line => {
			const [status, ...rest] = line.split('\t');
			const file = rest.join('\t');
			const [added, removed] = stats.get(file) ?? [];
			return { status, file, added, removed };
		});
	}

	/** Put one file back as it was in `sha` (or remove it if it did not exist then). */
	restoreFile(sha: string, file: string): Promise<void> {
		return this.run(async () => {
			const existed = (await this.git(['ls-tree', '--name-only', sha, '--', file])).trim().length > 0;
			if (existed) {
				await this.git(['checkout', sha, '--', file]);
			} else {
				await fs.promises.rm(path.join(this.root, file), { force: true });
			}
		});
	}

	async show(sha: string, file: string): Promise<string> {
		try {
			return await this.git(['show', `${sha}:${file}`]);
		} catch {
			return ''; // the file did not exist in that snapshot
		}
	}

	/** Put the working tree back exactly as it was in `sha`. `current` is a snapshot of the present. */
	restore(sha: string, current: string): Promise<void> {
		return this.run(async () => {
			// Files born after the snapshot would survive a checkout; they have to go too.
			for (const { file } of (await this.changes(sha, current)).filter(c => c.status === 'A')) {
				await fs.promises.rm(path.join(this.root, file), { force: true });
			}
			try {
				await this.git(['checkout', sha, '--', '.']);
			} catch (err) {
				if (!/did not match any/.test(String(err))) {
					throw err;
				}
				// the snapshot was an empty project: nothing to put back
			}
		});
	}

	readTurns(): Turn[] {
		try {
			return fs.readFileSync(path.join(this.gitDir, TURNS_FILE), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Turn);
		} catch {
			return [];
		}
	}

	writeTurns(turns: Turn[]): void {
		try {
			fs.writeFileSync(path.join(this.gitDir, TURNS_FILE), turns.slice(-MAX_TURNS).map(t => JSON.stringify(t)).join('\n') + '\n');
		} catch (err) {
			console.error('[orbit] could not save the timeline', err);
		}
	}
}

type Node = { kind: 'turn'; turn: Turn } | { kind: 'file'; turn: Turn; change: ChangedFile } | { kind: 'info'; label: string };

/**
 * Time machine: every message sent to an agent becomes a save point of the whole project,
 * whatever changes it afterwards (Claude's edits, shell commands, scripts, you). The
 * timeline shows what each message changed and can rewind the project to just before it.
 */
export class TimeMachine implements vscode.TreeDataProvider<Node>, vscode.TextDocumentContentProvider, vscode.Disposable {

	private readonly repos = new Map<string, ShadowRepo>();
	private turns: Turn[] = [];
	private readonly open = new Map<string, Turn>();
	private readonly starting = new Map<string, Promise<void>>();
	private readonly seen = new Map<string, { turn?: number; status?: AgentStatus }>();
	private readonly disposables: vscode.Disposable[] = [];
	private gitMissing = false;

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(tracker: AgentTracker, private readonly claude: ClaudeTerminals) {
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			this.repo(folder.uri.fsPath); // loads its timeline
		}
		this.disposables.push(
			vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
			tracker.onDidChange(state => {
				if (!this.claude.byKey(state.key)) {
					return; // an agent of another window: that window photographs it
				}
				const last = this.seen.get(state.key) ?? {};
				this.seen.set(state.key, { turn: state.turnStartedAt, status: state.status });
				if (!enabled() || !state.cwd) {
					return;
				}
				if (state.turnStartedAt && state.turnStartedAt !== last.turn) {
					this.begin(state.key, state.cwd, state.prompt ?? '');
				} else if (state.status === 'done' && last.status !== 'done') {
					this.finish(state.key);
				}
			}),
		);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this._onDidChangeTreeData.dispose();
	}

	// --- tree

	async getChildren(node?: Node): Promise<Node[]> {
		if (!node) {
			if (!this.turns.length) {
				return [];
			}
			return [...this.turns].reverse().map(turn => ({ kind: 'turn', turn }));
		}
		if (node.kind !== 'turn') {
			return [];
		}
		const { turn } = node;
		if (!turn.after) {
			return [{ kind: 'info', label: 'En cours : les changements apparaîtront à la fin du tour' }];
		}
		try {
			const changes = await this.repo(turn.root).changes(turn.before, turn.after);
			return changes.length ? changes.map(change => ({ kind: 'file', turn, change })) : [{ kind: 'info', label: 'Aucun fichier modifié' }];
		} catch {
			return [{ kind: 'info', label: 'Point de sauvegarde illisible' }];
		}
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.kind === 'info') {
			const item = new vscode.TreeItem(node.label);
			item.iconPath = new vscode.ThemeIcon('info');
			return item;
		}
		if (node.kind === 'file') {
			const { turn, change } = node;
			const item = new vscode.TreeItem(vscode.Uri.file(path.join(turn.root, change.file)));
			const counts = change.added !== undefined ? `+${change.added} −${change.removed}` : '';
			item.description = [STATUS_LABELS[change.status[0]] ?? change.status, counts, path.dirname(change.file) === '.' ? '' : path.dirname(change.file)].filter(Boolean).join(' · ');
			item.command = { command: 'orbit.time.diff', title: 'Voir le changement', arguments: [node] };
			item.contextValue = 'file';
			return item;
		}
		const { turn } = node;
		const item = new vscode.TreeItem(turn.prompt.replace(/\s+/g, ' ').slice(0, 90) || 'Message sans texte', vscode.TreeItemCollapsibleState.Collapsed);
		item.id = turn.id;
		item.description = `${turn.agent} · ${timeAgo(turn.at)}`;
		item.iconPath = new vscode.ThemeIcon(turn.rewind ? 'discard' : turn.after ? 'history' : 'loading~spin');
		item.tooltip = new vscode.MarkdownString(`**${turn.agent}** · ${new Date(turn.at).toLocaleString()}\n\n${turn.prompt.slice(0, 600)}`);
		item.contextValue = 'turn';
		return item;
	}

	// --- snapshots viewed as documents

	provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const { root, sha, file } = JSON.parse(uri.query) as { root: string; sha: string; file: string };
		return this.repo(root).show(sha, file);
	}

	async diff(node: Node | undefined): Promise<void> {
		if (node?.kind !== 'file' || !node.turn.after) {
			return;
		}
		const { turn, change } = node;
		const at = (sha: string) => vscode.Uri.from({ scheme: SCHEME, path: `/${change.file}`, query: JSON.stringify({ root: turn.root, sha, file: change.file }) });
		await vscode.commands.executeCommand('vscode.diff', at(turn.before), at(turn.after!), `${path.basename(change.file)} · avant ↔ après « ${turn.prompt.slice(0, 40)} »`);
	}

	// --- actions

	/** A save point taken by hand, outside any agent's turn. */
	async snapshotNow(): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!root) {
			vscode.window.showInformationMessage('Ouvre un projet pour créer un point de sauvegarde.');
			return;
		}
		const name = await vscode.window.showInputBox({ title: 'Point de sauvegarde', prompt: 'Nom du point de sauvegarde', value: `Sauvegarde du ${new Date().toLocaleString()}` });
		if (!name) {
			return;
		}
		const sha = await this.take(root, name);
		if (sha) {
			this.add({ id: `${Date.now()}`, root, agent: 'Toi', prompt: name, at: Date.now(), before: sha, after: sha });
		}
	}

	/** Put the project back as it was just before a message was sent. */
	async rewind(node: Node | undefined): Promise<void> {
		if (node?.kind !== 'turn') {
			return;
		}
		const { turn } = node;
		const repo = this.repo(turn.root);
		const present = await this.take(turn.root, 'before rewind');
		if (!present) {
			return;
		}
		const changes = await repo.changes(turn.before, present);
		if (!changes.length) {
			vscode.window.showInformationMessage('Le projet est déjà dans cet état.');
			return;
		}
		const working = this.claude.list().length ? '\n\nSi des agents travaillent encore, arrête-les d\'abord : ils continueraient à écrire par-dessus.' : '';
		const choice = await vscode.window.showWarningMessage(
			`Revenir avant « ${turn.prompt.slice(0, 80)} » ?`,
			{ modal: true, detail: `${changes.length} fichier${changes.length > 1 ? 's' : ''} du projet ${changes.length > 1 ? 'reprendront' : 'reprendra'} son contenu de ce moment-là (${changes.slice(0, 6).map(c => c.file).join(', ')}${changes.length > 6 ? '…' : ''}).\n\nL'état actuel est gardé dans la frise : tu pourras y revenir.${working}` },
			'Revenir en arrière');
		if (choice !== 'Revenir en arrière') {
			return;
		}
		try {
			await repo.restore(turn.before, present);
			const after = await this.take(turn.root, 'after rewind');
			this.add({ id: `${Date.now()}`, root: turn.root, agent: 'Toi', prompt: `Retour avant « ${turn.prompt.slice(0, 60)} »`, at: Date.now(), before: present, after: after ?? present, rewind: true });
			vscode.window.showInformationMessage(`Projet revenu avant « ${turn.prompt.slice(0, 60)} ». L'état précédent reste dans la frise.`);
		} catch (err) {
			vscode.window.showErrorMessage(`Le retour arrière a échoué : ${String(err).split('\n')[0]}`);
		}
	}

	/** Undo what one turn did to one file, keeping everything else. The present stays in the timeline. */
	async revertFile(node: Node | undefined): Promise<void> {
		if (node?.kind !== 'file') {
			return;
		}
		const { turn, change } = node;
		const created = change.status.startsWith('A');
		const choice = await vscode.window.showWarningMessage(
			created ? `Supprimer ${change.file} ?` : `Annuler les changements de ${change.file} ?`,
			{ modal: true, detail: `${created ? 'Ce fichier a été créé' : 'Le fichier reprendra son contenu d\'avant'} « ${turn.prompt.slice(0, 80)} ». Les autres fichiers ne bougent pas, et l'état actuel est gardé dans la frise.` },
			created ? 'Supprimer le fichier' : 'Annuler ce fichier');
		if (!choice) {
			return;
		}
		const present = await this.take(turn.root, 'before file revert');
		if (!present) {
			return;
		}
		try {
			await this.repo(turn.root).restoreFile(turn.before, change.file);
			const after = await this.take(turn.root, 'after file revert');
			this.add({ id: `${Date.now()}`, root: turn.root, agent: 'Toi', prompt: `Annulation de ${change.file}`, at: Date.now(), before: present, after: after ?? present, rewind: true });
			vscode.window.setStatusBarMessage(`$(discard) ${change.file} ${created ? 'supprimé' : 'remis comme avant'}`, 4000);
		} catch (err) {
			vscode.window.showErrorMessage(`L'annulation a échoué : ${String(err).split('\n')[0]}`);
		}
	}

	/** Tell the agent what is wrong with one file it changed, with the file attached. */
	async comment(node: Node | undefined): Promise<void> {
		if (node?.kind !== 'file') {
			return;
		}
		const { turn, change } = node;
		const remark = await vscode.window.showInputBox({ title: `Commenter ${path.basename(change.file)} pour Claude`, prompt: 'Ce qui ne va pas, ou ce que tu veux à la place', placeHolder: 'Ex. : garde l\'ancienne signature, ce changement casse l\'appel dans api.ts', ignoreFocusOut: true });
		if (!remark?.trim()) {
			return;
		}
		// The agent that made the change if it is still open, else the current one.
		const terminal = this.claude.list().find(t => t.name === turn.agent) ?? this.claude.current();
		const text = `À propos de @${change.file.split(path.sep).join('/')}, modifié pendant « ${turn.prompt.replace(/\s+/g, ' ').slice(0, 100)} » : ${remark.trim()}`;
		if (terminal) {
			this.claude.sendMessage(terminal, text);
			terminal.show(true);
		} else {
			this.claude.create({ cwd: turn.root, flags: [text] });
		}
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	// --- internals

	/** Registered as soon as a turn begins, so a Stop arriving during its snapshot waits for it. */
	private begin(key: string, cwd: string, prompt: string): Promise<void> {
		const task = (this.starting.get(key) ?? Promise.resolve())
			.then(() => this.start(key, cwd, prompt))
			.catch(err => console.error('[orbit] could not start a turn', err))
			.finally(() => {
				if (this.starting.get(key) === task) {
					this.starting.delete(key);
				}
			});
		this.starting.set(key, task);
		return task;
	}

	private async start(key: string, cwd: string, prompt: string): Promise<void> {
		if (!snapshotable(cwd)) {
			return;
		}
		// An agent that never reported its end still closes its previous turn here.
		await this.close(key);
		const before = await this.take(cwd, `before: ${prompt.slice(0, 60)}`);
		if (!before) {
			return;
		}
		const turn: Turn = { id: `${key}-${Date.now()}`, root: cwd, agent: this.claude.byKey(key)?.name ?? 'Claude', prompt, at: Date.now(), before };
		this.open.set(key, turn);
		this.add(turn);
	}

	private async finish(key: string): Promise<void> {
		await this.starting.get(key);
		await this.close(key);
	}

	private async close(key: string): Promise<void> {
		const turn = this.open.get(key);
		if (!turn) {
			return;
		}
		this.open.delete(key);
		turn.after = await this.take(turn.root, `after: ${turn.prompt.slice(0, 60)}`);
		this.save(turn.root);
		this.refresh();
	}

	private async take(root: string, message: string): Promise<string | undefined> {
		if (this.gitMissing) {
			return undefined;
		}
		try {
			return await this.repo(root).snapshot(message);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				this.gitMissing = true;
				vscode.window.showWarningMessage('La machine à remonter le temps a besoin de git : installe-le pour garder un point de sauvegarde à chaque message.');
			} else {
				console.error('[orbit] snapshot failed', err);
			}
			return undefined;
		}
	}

	private add(turn: Turn): void {
		this.turns.push(turn);
		this.save(turn.root);
		this.refresh();
	}

	private save(root: string): void {
		this.repo(root).writeTurns(this.turns.filter(t => t.root === root));
	}

	private repo(root: string): ShadowRepo {
		const key = process.platform === 'win32' ? root.toLowerCase() : root;
		let repo = this.repos.get(key);
		if (!repo) {
			this.repos.set(key, repo = new ShadowRepo(root));
			// First touch of this project: its saved timeline joins ours, so a save never drops it.
			this.turns.push(...repo.readTurns());
			this.turns.sort((a, b) => a.at - b.at);
		}
		return repo;
	}
}

const STATUS_LABELS: Record<string, string> = { A: 'ajouté', M: 'modifié', D: 'supprimé', T: 'modifié' };

function enabled(): boolean {
	return vscode.workspace.getConfiguration('orbit').get<boolean>('timeMachine.enabled') ?? true;
}

/** A home directory or a drive root is not a project: photographing it would take forever. */
function snapshotable(dir: string): boolean {
	const normal = path.resolve(dir);
	return normal !== path.resolve(os.homedir()) && path.dirname(normal) !== normal;
}
