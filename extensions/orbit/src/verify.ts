/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const CHECKS_FILE = path.join('.orbit', 'checks.json');
const MAX_OUTPUT = 6000;
/** Automatic returns to Claude per user message, so a check Claude cannot fix never loops. */
const MAX_AUTO_RETURNS = 2;

interface Check {
	name: string;
	command: string;
	/** Relative to the project folder. */
	cwd?: string;
}

interface Result {
	check: Check;
	ok: boolean;
	code: number | null;
	output: string;
	ms: number;
	timedOut?: boolean;
}

type Mode = 'off' | 'notify' | 'auto';

/**
 * The closed loop: when Claude finishes a turn in which it wrote files, Orbit runs the
 * project's checks (types, lint, tests…) and hands the failures back to Claude. Checks come
 * from `.orbit/checks.json`, or are found in the project (npm scripts, tsconfig, Cargo, Go).
 */
export class Verifier implements vscode.Disposable {

	private readonly wrote = new Set<string>();
	private readonly returns = new Map<string, number>();
	private readonly running = new Map<string, { children: ChildProcess[]; cancelled: boolean }>();
	private readonly last = new Map<string, { results: Result[]; key: string }>();
	private readonly status = vscode.window.createStatusBarItem('orbit.verify', vscode.StatusBarAlignment.Left, 96);
	private readonly output = vscode.window.createOutputChannel('Orbit · Vérification');
	private readonly disposables: vscode.Disposable[] = [];

	constructor(tracker: AgentTracker, private readonly claude: ClaudeTerminals) {
		this.status.name = 'Vérification automatique';
		this.status.command = 'orbit.verify.menu';
		this.disposables.push(
			tracker.onDidUseTool(event => {
				if (event.phase === 'end' && WRITE_TOOLS.has(event.tool)) {
					this.wrote.add(event.key);
				}
			}),
			tracker.onDidChange(state => {
				if (state.status === 'running' && state.prompt !== undefined && !this.isOurMessage(state.prompt)) {
					// A message from the user opens a new turn: the automatic returns start over.
					this.returns.delete(state.key);
				}
				if (state.status === 'done' && this.wrote.delete(state.key)) {
					const terminal = this.claude.byKey(state.key);
					const root = state.cwd ?? (terminal && this.claude.cwdOf(terminal)) ?? '';
					if (root && this.mode() !== 'off') {
						this.run(root, state.key, false);
					}
				}
			}),
			vscode.commands.registerCommand('orbit.verify.run', () => this.runNow()),
			vscode.commands.registerCommand('orbit.verify.menu', () => this.menu()),
			vscode.commands.registerCommand('orbit.verify.configure', () => this.configure()),
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('orbit.verify') && this.render()),
		);
		this.render();
	}

	dispose(): void {
		for (const run of this.running.values()) {
			run.cancelled = true;
			run.children.forEach(c => c.kill());
		}
		this.status.dispose();
		this.output.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	private mode(): Mode {
		return vscode.workspace.getConfiguration('orbit').get<Mode>('verify.mode') ?? 'notify';
	}

	private isOurMessage(prompt: string): boolean {
		return prompt.startsWith('[Vérification automatique d\'Orbit]');
	}

	private async runNow(): Promise<void> {
		const terminal = this.claude.current();
		const root = (terminal && this.claude.cwdOf(terminal)) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!root) {
			vscode.window.showInformationMessage('Ouvre un projet pour lancer sa vérification.');
			return;
		}
		const results = await this.run(root, (terminal && this.claude.keyOf(terminal)) ?? '', true);
		if (results && !results.length) {
			const choice = await vscode.window.showInformationMessage('Aucun contrôle trouvé dans ce projet (ni script typecheck/lint, ni tsconfig, ni Cargo, ni Go).', 'Configurer les contrôles');
			if (choice) {
				this.configure();
			}
		}
	}

	/** Runs the checks of a project. A newer run for the same project replaces the one in flight. */
	private async run(root: string, key: string, manual: boolean): Promise<Result[] | undefined> {
		const id = normal(root);
		const previous = this.running.get(id);
		if (previous) {
			previous.cancelled = true;
			previous.children.forEach(c => c.kill());
		}
		const checks = detectChecks(root);
		if (!checks.length) {
			this.last.delete(id);
			this.render();
			return [];
		}
		const run = { children: [] as ChildProcess[], cancelled: false };
		this.running.set(id, run);
		this.render();
		const timeout = (vscode.workspace.getConfiguration('orbit').get<number>('verify.timeoutSeconds') ?? 180) * 1000;
		const results: Result[] = [];
		for (const check of checks) {
			if (run.cancelled) {
				return undefined;
			}
			results.push(await execute(check, root, timeout, run));
		}
		if (run.cancelled) {
			return undefined;
		}
		this.running.delete(id);
		this.last.set(id, { results, key });
		this.log(root, results);
		this.render();
		const failed = results.filter(r => !r.ok);
		if (!failed.length) {
			if (manual) {
				vscode.window.showInformationMessage(`Vérification réussie : ${results.map(r => r.check.name).join(', ')}.`);
			}
			return results;
		}
		const terminal = key ? this.claude.byKey(key) : this.claude.current();
		const count = this.returns.get(key) ?? 0;
		if (this.mode() === 'auto' && terminal && !manual && count < MAX_AUTO_RETURNS) {
			this.returns.set(key, count + 1);
			this.send(terminal, failed);
			vscode.window.setStatusBarMessage(`$(sync) Orbit renvoie ${failed.length} contrôle${failed.length > 1 ? 's' : ''} en échec à ${terminal.name}`, 5000);
			return results;
		}
		const stuck = this.mode() === 'auto' && count >= MAX_AUTO_RETURNS;
		const choice = await vscode.window.showWarningMessage(
			`${failed.map(r => r.check.name).join(', ')} : ${failed.length > 1 ? 'contrôles en échec' : 'contrôle en échec'} après le travail de ${terminal?.name ?? 'Claude'}${stuck ? ` (déjà renvoyé ${count} fois)` : ''}.`,
			...(terminal ? ['Renvoyer à Claude'] : []), 'Voir le détail');
		if (choice === 'Renvoyer à Claude' && terminal) {
			this.send(terminal, failed);
		} else if (choice === 'Voir le détail') {
			this.output.show(true);
		}
		return results;
	}

	private send(terminal: vscode.Terminal, failed: Result[]): void {
		const parts = failed.map(r => `### ${r.check.command} — ${r.timedOut ? 'trop long, arrêté' : `code ${r.code}`}\n\`\`\`\n${tail(r.output, MAX_OUTPUT)}\n\`\`\``);
		this.claude.sendMessage(terminal, `[Vérification automatique d'Orbit] Après ton dernier tour, ${failed.length > 1 ? 'ces contrôles échouent' : 'ce contrôle échoue'}. Corrige la cause (pas le contrôle), relance-${failed.length > 1 ? 'les' : 'le'} toi-même pour confirmer, puis dis-moi ce qui n'allait pas.\n\n${parts.join('\n\n')}`);
		terminal.show(true);
	}

	private log(root: string, results: Result[]): void {
		this.output.appendLine(`\n── ${new Date().toLocaleTimeString()} · ${root}`);
		for (const r of results) {
			this.output.appendLine(`${r.ok ? 'OK    ' : 'ÉCHEC '} ${r.check.command}  (${(r.ms / 1000).toFixed(1)} s${r.timedOut ? ', arrêté : trop long' : ''})`);
			if (!r.ok) {
				this.output.appendLine(tail(r.output, 20000));
			}
		}
	}

	private render(): void {
		const mode = this.mode();
		if (mode === 'off') {
			this.status.text = '$(circle-slash) Vérif.';
			this.status.tooltip = 'Vérification automatique désactivée. Clique pour la régler.';
			this.status.backgroundColor = undefined;
			this.status.show();
			return;
		}
		if (this.running.size) {
			this.status.text = '$(loading~spin) Vérification…';
			this.status.tooltip = 'Orbit vérifie le travail de Claude (types, lint, tests).';
			this.status.backgroundColor = undefined;
			this.status.show();
			return;
		}
		const all = [...this.last.values()].flatMap(l => l.results);
		if (!all.length) {
			this.status.hide();
			return;
		}
		const failed = all.filter(r => !r.ok);
		this.status.text = failed.length ? `$(error) ${failed.length} contrôle${failed.length > 1 ? 's' : ''} en échec` : '$(pass) Vérifié';
		this.status.backgroundColor = failed.length ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
		const md = new vscode.MarkdownString(undefined, true);
		md.appendMarkdown(`**Vérification automatique** — ${mode === 'auto' ? 'les échecs sont renvoyés à Claude' : 'tu décides de renvoyer les échecs'}\n\n`);
		for (const r of all) {
			md.appendMarkdown(`${r.ok ? '$(pass)' : '$(error)'} \`${r.check.command}\` · ${(r.ms / 1000).toFixed(1)} s\n\n`);
		}
		this.status.tooltip = md;
		this.status.show();
	}

	private async menu(): Promise<void> {
		const mode = this.mode();
		const failed = [...this.last.values()].flatMap(l => l.results.filter(r => !r.ok).map(r => ({ r, key: l.key })));
		type Item = vscode.QuickPickItem & { run: () => unknown };
		const setMode = (m: Mode) => vscode.workspace.getConfiguration('orbit').update('verify.mode', m, vscode.ConfigurationTarget.Global);
		const items: Item[] = [
			...(failed.length ? [{
				label: '$(reply) Renvoyer les échecs à Claude', detail: failed.map(f => f.r.check.name).join(', '), run: () => {
					const terminal = (failed[0].key && this.claude.byKey(failed[0].key)) || this.claude.current();
					if (terminal) {
						this.send(terminal, failed.map(f => f.r));
					} else {
						vscode.window.showInformationMessage('Aucun terminal Claude ouvert.');
					}
				},
			}] : []),
			{ label: '$(play) Vérifier maintenant', detail: 'Lance les contrôles du projet', run: () => this.runNow() },
			{ label: '$(output) Voir le détail', detail: 'Sortie complète des contrôles', run: () => this.output.show() },
			{ label: '$(gear) Choisir les contrôles du projet…', detail: 'Ouvre .orbit/checks.json', run: () => this.configure() },
			{ label: `${mode === 'notify' ? '$(check) ' : ''}Me demander avant de renvoyer à Claude`, run: () => setMode('notify') },
			{ label: `${mode === 'auto' ? '$(check) ' : ''}Renvoyer automatiquement à Claude`, detail: `Au plus ${MAX_AUTO_RETURNS} fois par message, puis Orbit te demande`, run: () => setMode('auto') },
			{ label: `${mode === 'off' ? '$(check) ' : ''}Désactiver la vérification automatique`, run: () => setMode('off') },
		];
		const pick = await vscode.window.showQuickPick(items, { title: 'Vérification automatique', placeHolder: 'Orbit vérifie le travail de Claude après chaque tour où il a modifié des fichiers' });
		await pick?.run();
	}

	/** Writes the detected checks to `.orbit/checks.json` so the user can edit them. */
	private async configure(): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!root) {
			vscode.window.showInformationMessage('Ouvre un projet pour configurer ses contrôles.');
			return;
		}
		const file = path.join(root, CHECKS_FILE);
		if (!fs.existsSync(file)) {
			const detected = detectChecks(root);
			await fs.promises.mkdir(path.dirname(file), { recursive: true });
			await fs.promises.writeFile(file, JSON.stringify(detected.length ? detected : [{ name: 'Tests', command: 'npm test' }], null, '\t') + '\n');
		}
		await vscode.window.showTextDocument(vscode.Uri.file(file));
	}
}

/** The checks of a project: its `.orbit/checks.json`, else what its files reveal. */
export function detectChecks(root: string): Check[] {
	const custom = path.join(root, CHECKS_FILE);
	if (fs.existsSync(custom)) {
		try {
			const list = JSON.parse(fs.readFileSync(custom, 'utf8')) as Check[];
			return Array.isArray(list) ? list.filter(c => c && typeof c.command === 'string' && c.command.trim()).map(c => ({ name: String(c.name || c.command), command: c.command, cwd: c.cwd })) : [];
		} catch {
			return [];
		}
	}
	const checks: Check[] = [];
	const exists = (f: string) => fs.existsSync(path.join(root, f));
	if (exists('package.json')) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
			const scripts = pkg.scripts ?? {};
			const runner = exists('pnpm-lock.yaml') ? 'pnpm' : exists('yarn.lock') ? 'yarn' : exists('bun.lockb') || exists('bun.lock') ? 'bun' : 'npm';
			const typecheck = ['typecheck', 'type-check', 'check-types', 'tsc', 'types'].find(s => scripts[s]);
			if (typecheck) {
				checks.push({ name: 'Types', command: `${runner} run ${typecheck}` });
			} else if (exists('tsconfig.json') && (pkg.devDependencies?.typescript || pkg.dependencies?.typescript)) {
				checks.push({ name: 'Types', command: 'npx tsc --noEmit' });
			}
			// A lint script that rewrites files (--fix) would fight with Claude: only read-only ones.
			if (scripts.lint && !/--fix|--write/.test(scripts.lint)) {
				checks.push({ name: 'Lint', command: `${runner} run lint` });
			}
		} catch {
			// unreadable package.json: no JavaScript checks
		}
	}
	if (exists('Cargo.toml')) {
		checks.push({ name: 'Cargo', command: 'cargo check --message-format short' });
	}
	if (exists('go.mod')) {
		checks.push({ name: 'Go', command: 'go vet ./...' });
	}
	if (exists('pyproject.toml') && /\[tool\.ruff/.test(safeRead(path.join(root, 'pyproject.toml')))) {
		checks.push({ name: 'Ruff', command: 'ruff check .' });
	}
	return checks;
}

function execute(check: Check, root: string, timeoutMs: number, run: { children: ChildProcess[]; cancelled: boolean }): Promise<Result> {
	return new Promise(resolve => {
		const started = Date.now();
		let output = '';
		let timedOut = false;
		const child = spawn(check.command, { cwd: check.cwd ? path.resolve(root, check.cwd) : root, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' } });
		run.children.push(child);
		const collect = (chunk: Buffer) => {
			output = (output + chunk.toString('utf8')).slice(-200000);
		};
		child.stdout?.on('data', collect);
		child.stderr?.on('data', collect);
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);
		const done = (code: number | null) => {
			clearTimeout(timer);
			resolve({ check, ok: code === 0 && !timedOut, code, output: stripAnsi(output).trim(), ms: Date.now() - started, timedOut });
		};
		child.on('error', err => {
			output += String(err);
			done(-1);
		});
		child.on('close', done);
	});
}

function stripAnsi(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r(?!\n)/g, '\n');
}

/** The end of a long output is where the errors are; keep the first lines too (the command's header). */
function tail(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	const head = text.slice(0, 600);
	return `${head}\n… (${text.length - max} caractères coupés) …\n${text.slice(-(max - 600))}`;
}

function safeRead(file: string): string {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch {
		return '';
	}
}

function normal(p: string): string {
	const n = path.normalize(p);
	return process.platform === 'win32' ? n.toLowerCase() : n;
}
