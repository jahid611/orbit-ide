/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { assistantId } from './assistant';
import { runCodex } from './headless';
import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { claudeEnv, readConfig, resolveClaudeExecutable, workspaceRoot } from './config';

const execFileAsync = promisify(execFile);

/** Worktrees of a run live inside the project, in a folder git never sees. */
const WORKTREES = path.join('.orbit', 'worktrees');
const BRANCH_PREFIX = 'orbit/';
const TASK_FILE = '.orbit/task.md';
const JUNK = ['__pycache__', 'node_modules', '.pytest_cache', '.mypy_cache', '.venv', 'dist', 'build', '.next', 'coverage'];
const MAX_SUBTASKS = 4;
const PLAN_TIMEOUT_MS = 4 * 60 * 1000;

const PLANNER = `You are the conductor of a team of coding agents that work in parallel, each in its own git worktree of the same repository. Split the user's task into subtasks they can carry out at the same time.

Rules:
- Between 2 and ${MAX_SUBTASKS} subtasks. If the task cannot be usefully split, return exactly one.
- Subtasks MUST touch disjoint sets of files, so their branches merge without conflict. If two parts need the same file, put them in the same subtask.
- Each agent sees only its own prompt: make every prompt self-contained. Say which files to create or edit, what the result must do, and how to check it.
- Agents must not commit, push or touch git: they only leave their files in place.
- Look at the project first if it helps you split well.

Reply with ONLY a JSON array, no prose and no code fence:
[{"title": "short title, in the user's language", "slug": "short-kebab-case-ascii", "prompt": "full instructions for the agent, in the user's language"}]`;

interface Subtask {
	title: string;
	slug: string;
	prompt: string;
}

interface RunAgent {
	key: string;
	title: string;
	branch: string;
	dir: string;
}

interface Worktree {
	dir: string;
	branch: string;
}

/**
 * Conductor: turns one large request into several agents working in parallel, each isolated
 * in its own worktree, then gathers their branches back into the project.
 */
export class Conductor implements vscode.Disposable {

	private readonly runs: RunAgent[][] = [];
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly claude: ClaudeTerminals, private readonly tracker: AgentTracker) {
		this.disposables.push(
			tracker.onDidChange(() => this.checkRuns()),
			// A closed agent counts as finished: the run must not wait for it forever.
			claude.onDidChange(() => this.checkRuns()),
		);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}

	/** Ask for a task, plan it, and launch one agent per subtask. */
	async start(): Promise<void> {
		const root = workspaceRoot();
		if (!vscode.workspace.workspaceFolders?.length) {
			vscode.window.showInformationMessage('Ouvre un projet pour lancer le chef d\'orchestre.');
			return;
		}
		if (!await hasCommit(root)) {
			vscode.window.showWarningMessage('Le chef d\'orchestre isole chaque agent dans une branche git : le projet doit être un dépôt git avec au moins un commit.');
			return;
		}
		const task = await vscode.window.showInputBox({
			title: 'Chef d\'orchestre',
			prompt: 'Décris la grosse tâche : elle sera découpée entre plusieurs agents qui travailleront en parallèle',
			placeHolder: 'Ex. : ajoute une page de réglages, son API et ses tests',
			ignoreFocusOut: true,
		});
		if (!task?.trim()) {
			return;
		}

		let subtasks: Subtask[];
		try {
			subtasks = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Chef d\'orchestre : découpage de la tâche…', cancellable: true },
				(_progress, token) => plan(task, root, token));
		} catch (err) {
			if (!(err instanceof vscode.CancellationError)) {
				vscode.window.showErrorMessage(`Le découpage a échoué : ${String(err instanceof Error ? err.message : err).slice(0, 300)}`);
			}
			return;
		}

		const picks = await vscode.window.showQuickPick(
			subtasks.map(s => ({ label: s.title, description: `${BRANCH_PREFIX}${s.slug}`, detail: s.prompt.replace(/\s+/g, ' ').slice(0, 300), picked: true, subtask: s })),
			{ title: `Chef d'orchestre · ${subtasks.length} agent${subtasks.length > 1 ? 's' : ''} proposé${subtasks.length > 1 ? 's' : ''}`, placeHolder: 'Décoche ce que tu ne veux pas lancer, puis valide', canPickMany: true, ignoreFocusOut: true });
		if (!picks?.length) {
			return;
		}

		await ignoreWorktreesFolder(root);
		const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '');
		const run: RunAgent[] = [];
		for (const { subtask } of picks) {
			const branch = `${BRANCH_PREFIX}${subtask.slug}-${stamp}`;
			const dir = path.join(root, WORKTREES, `${subtask.slug}-${stamp}`);
			try {
				await execFileAsync('git', ['worktree', 'add', '-q', '-b', branch, dir], { cwd: root });
			} catch (err) {
				vscode.window.showErrorMessage(`Impossible de créer la branche de « ${subtask.title} » : ${String(err).split('\n')[0]}`);
				continue;
			}
			// The task travels as a file: no command-line length limit, no shell quoting to get wrong.
			// `.orbit/` is ignored by git, so it never ends up in the agent's branch.
			await fs.promises.mkdir(path.join(dir, '.orbit'), { recursive: true });
			await fs.promises.writeFile(path.join(dir, TASK_FILE), `# ${subtask.title}\n\n${subtask.prompt}\n`);
			// The agent is alone in its worktree, so it may edit freely; commands still ask.
			const terminal = this.claude.create({
				cwd: dir,
				label: `Claude · ${subtask.title.slice(0, 28)}`,
				permissionMode: readConfig().permissionMode || 'acceptEdits',
				flags: [`Lis le fichier ${TASK_FILE} puis fais la tâche décrite.`],
				preserveFocus: true,
			});
			run.push({ key: this.claude.keyOf(terminal) ?? '', title: subtask.title, branch, dir });
		}
		if (run.length) {
			this.runs.push(run);
			vscode.commands.executeCommand('orbit.map.show');
		}
	}

	/** Gather finished branches back into the project. */
	async merge(): Promise<void> {
		const root = workspaceRoot();
		const worktrees = await listWorktrees(root);
		if (!worktrees.length) {
			vscode.window.showInformationMessage('Aucune branche d\'agent à fusionner dans ce projet.');
			return;
		}
		const picks = await vscode.window.showQuickPick(
			worktrees.map(w => ({ label: w.branch, description: vscode.workspace.asRelativePath(w.dir, false), picked: true, worktree: w })),
			{ title: 'Fusionner le travail des agents', placeHolder: 'Branches à ramener dans le projet', canPickMany: true });
		if (!picks?.length) {
			return;
		}
		if ((await git(root, ['status', '--porcelain', '--untracked-files=no'])).trim()) {
			vscode.window.showWarningMessage('Le projet a des modifications non commitées : commite-les ou mets-les de côté avant de fusionner, pour qu\'elles ne se mélangent pas au travail des agents.');
			return;
		}

		// The merge commits are the user's: Orbit never signs them with a made-up identity.
		if (!(await git(root, ['config', 'user.email']).catch(() => '')).trim()) {
			vscode.window.showWarningMessage('Git ne connaît pas encore ton identité, nécessaire pour enregistrer la fusion. Dans un terminal : git config --global user.name "Ton Nom" puis git config --global user.email "toi@exemple.com".');
			return;
		}

		const merged: Worktree[] = [];
		const failed: string[] = [];
		for (const { worktree } of picks) {
			try {
				// Agents leave their files in place; their work becomes one commit on their branch.
				if ((await git(worktree.dir, ['status', '--porcelain'])).trim()) {
					// Build and tool caches the agent's own checks left behind are not part of its work.
					await git(worktree.dir, ['add', '-A', '--', '.', ...JUNK.map(pattern => `:(exclude,glob)**/${pattern}/**`)]);
					await git(worktree.dir, ['commit', '-q', '-m', worktree.branch.slice(BRANCH_PREFIX.length)]);
				}
				await git(root, ['merge', '--no-ff', '--no-edit', worktree.branch]);
				merged.push(worktree);
			} catch (err) {
				await git(root, ['merge', '--abort']).catch(() => undefined);
				failed.push(`${worktree.branch} (${String(err instanceof Error ? err.message : err).split('\n').find(l => /conflict|error|fatal/i.test(l))?.slice(0, 120) ?? 'échec'})`);
			}
		}

		if (failed.length) {
			vscode.window.showWarningMessage(`Fusion incomplète. Restent à traiter à la main : ${failed.join(' ; ')}. Leurs dossiers sont conservés.`);
		}
		if (!merged.length) {
			return;
		}
		const choice = await vscode.window.showInformationMessage(
			`${merged.length} branche${merged.length > 1 ? 's' : ''} fusionnée${merged.length > 1 ? 's' : ''} dans le projet. Supprimer leurs dossiers de travail et leurs branches ?`,
			'Supprimer', 'Garder');
		if (choice === 'Supprimer') {
			for (const worktree of merged) {
				this.claude.list().filter(t => samePath(this.claude.cwdOf(t), worktree.dir)).forEach(t => t.dispose());
				await git(root, ['worktree', 'remove', '--force', worktree.dir]).catch(() => undefined);
				await git(root, ['branch', '-d', worktree.branch]).catch(() => undefined);
			}
		}
	}

	/** Tell the user when every agent of a run has finished. */
	private checkRuns(): void {
		for (const run of [...this.runs]) {
			const finished = run.every(agent => !this.claude.byKey(agent.key) || this.tracker.get(agent.key)?.status === 'done');
			if (!finished) {
				continue;
			}
			this.runs.splice(this.runs.indexOf(run), 1);
			vscode.window.showInformationMessage(
				`Chef d'orchestre : les ${run.length} agents ont terminé (${run.map(a => a.title).join(', ')}).`,
				'Fusionner leur travail', 'Voir la carte',
			).then(choice => {
				if (choice === 'Fusionner leur travail') {
					this.merge();
				} else if (choice) {
					vscode.commands.executeCommand('orbit.map.show');
				}
			});
		}
	}
}

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
	return stdout;
}

async function hasCommit(root: string): Promise<boolean> {
	try {
		await git(root, ['rev-parse', '--verify', 'HEAD']);
		return true;
	} catch {
		return false;
	}
}

/** Keep the agents' folders out of the project's history without editing its tracked files. */
async function ignoreWorktreesFolder(root: string): Promise<void> {
	try {
		const exclude = path.join((await git(root, ['rev-parse', '--git-common-dir'])).trim(), 'info', 'exclude');
		const file = path.isAbsolute(exclude) ? exclude : path.join(root, exclude);
		const current = fs.existsSync(file) ? await fs.promises.readFile(file, 'utf8') : '';
		if (!/^\.orbit\/$/m.test(current)) {
			await fs.promises.mkdir(path.dirname(file), { recursive: true });
			await fs.promises.appendFile(file, `${current.endsWith('\n') || !current ? '' : '\n'}.orbit/\n`);
		}
	} catch {
		// worst case the folder shows up as untracked
	}
}

async function listWorktrees(root: string): Promise<Worktree[]> {
	let out: string;
	try {
		out = await git(root, ['worktree', 'list', '--porcelain']);
	} catch {
		return [];
	}
	const worktrees: Worktree[] = [];
	for (const block of out.split(/\r?\n\r?\n/)) {
		const dir = block.match(/^worktree (.+)$/m)?.[1];
		const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
		if (dir && branch?.startsWith(BRANCH_PREFIX)) {
			worktrees.push({ dir: path.normalize(dir.trim()), branch: branch.trim() });
		}
	}
	return worktrees;
}

function samePath(a: string | undefined, b: string): boolean {
	const normal = (p: string) => process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p);
	return !!a && normal(a) === normal(b);
}

/** Ask Claude, headless and read-only, how to split the task. */
function plan(task: string, root: string, token: vscode.CancellationToken): Promise<Subtask[]> {
	if (assistantId() === 'chatgpt') {
		// Codex reads the project in its read-only sandbox, as Claude does with its reading tools.
		return runCodex(task, PLANNER, root, { onCancel: listener => token.onCancellationRequested(listener) }).then(parseSubtasks);
	}
	return new Promise((resolve, reject) => {
		const proc = spawn(resolveClaudeExecutable(), [
			'-p', '--output-format', 'json',
			'--model', readConfig().model || 'sonnet',
			'--tools', 'Read,Glob,Grep',
			'--no-session-persistence',
			'--system-prompt', PLANNER,
		], { cwd: root, env: claudeEnv(), windowsHide: true });
		let out = '';
		let err = '';
		const timer = setTimeout(() => proc.kill(), PLAN_TIMEOUT_MS);
		const cancel = token.onCancellationRequested(() => {
			proc.kill();
			reject(new vscode.CancellationError());
		});
		proc.stdout.on('data', d => out += d);
		proc.stderr.on('data', d => err += d);
		proc.on('error', e => reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('Claude Code introuvable : installe-le ou règle orbit.claude.path.') : e));
		proc.on('close', code => {
			clearTimeout(timer);
			cancel.dispose();
			try {
				const parsed = JSON.parse(out);
				if (parsed.is_error) {
					throw new Error(String(parsed.result || 'Erreur Claude'));
				}
				resolve(parseSubtasks(String(parsed.result ?? '')));
			} catch (e) {
				reject(e instanceof SyntaxError ? new Error(`Claude a échoué (code ${code}) ${err.slice(-300)}`) : e);
			}
		});
		proc.stdin.end(task);
	});
}

function parseSubtasks(text: string): Subtask[] {
	const start = text.indexOf('[');
	const end = text.lastIndexOf(']');
	if (start < 0 || end <= start) {
		throw new Error('Claude n\'a pas renvoyé de plan exploitable.');
	}
	const raw = JSON.parse(text.slice(start, end + 1)) as { title?: unknown; slug?: unknown; prompt?: unknown }[];
	const used = new Set<string>();
	const subtasks = raw.filter(s => typeof s?.title === 'string' && typeof s?.prompt === 'string' && String(s.prompt).trim()).slice(0, MAX_SUBTASKS).map((s, i) => {
		let slug = String(s.slug ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || `agent-${i + 1}`;
		while (used.has(slug)) {
			slug = `${slug}-${i + 1}`;
		}
		used.add(slug);
		return { title: String(s.title), slug, prompt: String(s.prompt) };
	});
	if (!subtasks.length) {
		throw new Error('Le plan renvoyé par Claude est vide.');
	}
	return subtasks;
}
