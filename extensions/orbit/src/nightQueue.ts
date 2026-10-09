/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { AgentState, AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { workspaceRoot } from './config';
import { Phone } from './phone';
import { assistant, assistantId } from './assistant';
import { codexTurnEnded } from './codexTracker';
import { lastAgentAnswer } from './transcript';
import { renderWebview, webviewOptions } from './webview';

type TaskStatus = 'waiting' | 'running' | 'blocked' | 'done' | 'failed' | 'skipped';

interface Task {
	id: number;
	prompt: string;
	status: TaskStatus;
	startedAt?: number;
	endedAt?: number;
	/** What Claude said last: the result, in its own words. */
	summary?: string;
	/** Files that changed while the task ran. */
	changed?: string[];
	note?: string;
	session?: string;
}

interface QueueFile {
	tasks: Task[];
	mode: string;
	stopOnFailure: boolean;
	startedAt?: number;
	endedAt?: number;
}

const BLOCKED_MINUTES = 15;
/** An agent that shows no sign of life after this long is waiting for an answer in its terminal. */
const START_MINUTES = 3;
const DEFAULT_TASK_MINUTES = 90;

/**
 * Night queue: tasks lined up in the evening, run one after the other while the user is away,
 * each by a fresh Claude so one task's context never weighs on the next, and a report waiting
 * in the morning: what Claude says it did, which files moved, how long it took.
 */
export class NightQueue implements vscode.Disposable {

	private panel: vscode.WebviewPanel | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	private data: QueueFile = { tasks: [], mode: '', stopOnFailure: false };
	private running = false;
	private current: { task: Task; key: string; terminal: vscode.Terminal; before: Map<string, string>; sawRunning: boolean; blockedAt?: number; wrote: Set<string>; transcript?: string } | undefined;
	private timer: NodeJS.Timeout | undefined;
	private readonly status = vscode.window.createStatusBarItem('orbit.queue', vscode.StatusBarAlignment.Left, 95);

	constructor(private readonly extensionUri: vscode.Uri, private readonly claude: ClaudeTerminals, private readonly tracker: AgentTracker, private readonly phone: Phone) {
		this.status.name = 'File de nuit';
		this.status.command = 'orbit.queue.show';
		this.load();
		this.disposables.push(
			this.status,
			vscode.commands.registerCommand('orbit.queue.show', () => this.show()),
			vscode.commands.registerCommand('orbit.queue.add', async (text?: string) => {
				const prompt = text ?? await vscode.window.showInputBox({ title: 'File de nuit', prompt: `Tâche à confier à ${assistant().name}`, placeHolder: 'Écris les tests de la page de paiement', ignoreFocusOut: true });
				if (prompt?.trim()) {
					this.add(prompt);
					this.show();
				}
			}),
			tracker.onDidChange(state => this.onAgent(state)),
			// Files the agent writes are noted as it goes: the report lists them even outside a git project.
			tracker.onDidUseTool(event => {
				const file = (event.input as { file_path?: unknown } | undefined)?.file_path;
				if (this.current?.key === event.key && event.phase === 'end' && typeof file === 'string' && /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(event.tool)) {
					const root = workspaceRoot();
					const full = path.isAbsolute(file) ? file : path.join(event.cwd ?? root, file);
					this.current.wrote.add(path.relative(root, full).split(path.sep).join('/'));
				}
			}),
			claude.onDidClose(key => {
				if (this.current?.key === key) {
					this.finish('failed', 'Le terminal a été fermé avant la fin.');
				}
			}),
			// The queue belongs to the project it was started on: folders shown or hidden while it runs do not reload it.
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				if (!this.running) {
					this.load();
					this.send();
				}
			}),
		);
		// A queue interrupted by a restart does not resume by itself: what was running is marked so.
		for (const task of this.data.tasks) {
			if (task.status === 'running' || task.status === 'blocked') {
				task.status = 'failed';
				task.note = 'Interrompue : Orbit a été fermé pendant la tâche.';
			}
		}
		this.render();
	}

	dispose(): void {
		clearInterval(this.timer);
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	// --- storage, in the project so the queue follows it

	/** Project the running queue was started on (the first folder can change while it runs). */
	private root: string | undefined;

	private file(): string {
		return path.join(this.running && this.root ? this.root : workspaceRoot(), '.orbit', 'file-de-nuit.json');
	}

	private load(): void {
		try {
			const parsed = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as QueueFile;
			this.data = { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [], mode: parsed.mode ?? '', stopOnFailure: !!parsed.stopOnFailure, startedAt: parsed.startedAt, endedAt: parsed.endedAt };
		} catch {
			this.data = { tasks: [], mode: '', stopOnFailure: false };
		}
	}

	private save(): void {
		try {
			fs.mkdirSync(path.dirname(this.file()), { recursive: true });
			fs.writeFileSync(this.file(), JSON.stringify(this.data, null, '\t'));
		} catch (err) {
			console.error('[orbit] could not save the night queue', err);
		}
		this.send();
		this.render();
	}

	private render(): void {
		const waiting = this.data.tasks.filter(t => t.status === 'waiting').length;
		const done = this.data.tasks.filter(t => t.status === 'done' || t.status === 'failed' || t.status === 'skipped').length;
		if (this.running) {
			this.status.text = `$(loading~spin) File de nuit ${done + 1}/${this.data.tasks.length}`;
			this.status.tooltip = this.current ? `En cours : ${this.current.task.prompt.slice(0, 120)}` : 'File de nuit en cours';
			this.status.show();
		} else if (waiting) {
			this.status.text = `$(list-ordered) ${waiting} en file`;
			this.status.tooltip = 'File de nuit : des tâches attendent d\'être lancées';
			this.status.show();
		} else {
			this.status.hide();
		}
	}

	// --- page

	show(): void {
		if (this.panel) {
			this.panel.reveal();
			return;
		}
		this.panel = vscode.window.createWebviewPanel('orbit.queue', 'File de nuit', vscode.ViewColumn.Active, { ...webviewOptions(this.extensionUri), retainContextWhenHidden: true });
		this.panel.iconPath = new vscode.ThemeIcon('list-ordered');
		this.panel.webview.html = renderWebview(this.panel.webview, this.extensionUri, 'queue');
		const listener = this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
		this.panel.onDidDispose(() => {
			listener.dispose();
			this.panel = undefined;
		});
	}

	private send(): void {
		this.panel?.webview.postMessage({
			type: 'state',
			project: path.basename(workspaceRoot()),
			running: this.running,
			phone: this.phone.paired(),
			assistant: assistant().name,
			defaultMode: vscode.workspace.getConfiguration('orbit').get<string>('claude.permissionMode') ?? '',
			...this.data,
			live: this.current && { id: this.current.task.id, agent: this.tracker.get(this.current.key)?.message ?? '', tool: this.tracker.get(this.current.key)?.tool?.name ?? '', blocked: !!this.current.blockedAt },
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private onMessage(msg: any): void {
		const task = this.data.tasks.find(t => t.id === msg.id);
		switch (msg.type) {
			case 'ready':
				this.send();
				break;
			case 'add':
				this.add(String(msg.prompt ?? ''));
				break;
			case 'remove':
				if (task && task.status !== 'running' && task.status !== 'blocked') {
					this.data.tasks = this.data.tasks.filter(t => t !== task);
					this.save();
				}
				break;
			case 'move': {
				const index = task ? this.data.tasks.indexOf(task) : -1;
				const target = index + (msg.up ? -1 : 1);
				if (task && task.status === 'waiting' && this.data.tasks[target]?.status === 'waiting') {
					[this.data.tasks[index], this.data.tasks[target]] = [this.data.tasks[target], this.data.tasks[index]];
					this.save();
				}
				break;
			}
			case 'retry':
				if (task && !this.running) {
					Object.assign(task, { status: 'waiting', startedAt: undefined, endedAt: undefined, summary: undefined, changed: undefined, note: undefined });
					this.save();
				}
				break;
			case 'clear':
				if (!this.running) {
					this.data.tasks = this.data.tasks.filter(t => t.status === 'waiting');
					this.save();
				}
				break;
			case 'options':
				this.data.mode = String(msg.mode ?? '');
				this.data.stopOnFailure = !!msg.stopOnFailure;
				this.save();
				break;
			case 'start':
				this.confirmStart();
				break;
			case 'stop':
				this.stop();
				break;
			case 'resume':
				if (task?.session) {
					this.claude.resume(task.session, task.prompt.slice(0, 30));
				}
				break;
			case 'changes':
				vscode.commands.executeCommand('orbit.timeline.focus');
				break;
			case 'report':
				this.openReport();
				break;
			case 'phone':
				vscode.commands.executeCommand('orbit.phone.setup');
				break;
		}
	}

	private add(prompt: string): void {
		const text = prompt.trim();
		if (!text) {
			return;
		}
		// One task per paragraph when several are pasted at once.
		for (const part of text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)) {
			this.data.tasks.push({ id: Date.now() + Math.floor(Math.random() * 1000) + this.data.tasks.length, prompt: part, status: 'waiting' });
		}
		this.save();
	}

	// --- running

	private start(): void {
		if (this.running || !this.data.tasks.some(t => t.status === 'waiting')) {
			return;
		}
		this.running = true;
		this.data.startedAt = Date.now();
		this.data.endedAt = undefined;
		this.root = workspaceRoot();
		this.timer = setInterval(() => this.watch(), 5000);
		this.next();
	}

	/** Nothing starts without the user seeing what is about to run, and in which mode. */
	private async confirmStart(): Promise<void> {
		const waiting = this.data.tasks.filter(t => t.status === 'waiting').length;
		if (this.running || !waiting) {
			return;
		}
		const mode = this.data.mode || vscode.workspace.getConfiguration('orbit').get<string>('claude.permissionMode') || '';
		const who = assistant().name;
		const detail = [
			`${waiting} tâche${waiting > 1 ? 's' : ''} sur « ${path.basename(workspaceRoot())} », l'une après l'autre, chacune dans un ${who} neuf.`,
			mode === 'auto'
				? `Mode automatique : ${who} modifie les fichiers et lance des commandes sans te demander.`
				: `Mode « ${assistant().modes.find(m => m.id === mode)?.label ?? 'Par défaut'} » : ${who} peut s'arrêter pour demander un accord ; la tâche attend alors ${BLOCKED_MINUTES} minutes puis la file continue.`,
			`Chaque tâche s'arrête d'elle-même après ${vscode.workspace.getConfiguration('orbit').get<number>('queue.taskMinutes') ?? DEFAULT_TASK_MINUTES} minutes. Le retour arrière reste possible par la frise du projet.`,
		].join('\n\n');
		const go = 'Lancer la file';
		if (await vscode.window.showWarningMessage('Lancer la file de nuit ?', { modal: true, detail }, go) === go) {
			this.start();
		}
	}

	private stop(): void {
		if (!this.running) {
			return;
		}
		this.running = false;
		clearInterval(this.timer);
		if (this.current) {
			// The agent is interrupted the way the user would do it: Escape.
			this.current.terminal.sendText('\x1b', false);
			this.finish('failed', 'File arrêtée à la main.', false);
		}
		this.data.endedAt = Date.now();
		this.save();
	}

	private async next(): Promise<void> {
		const task = this.data.tasks.find(t => t.status === 'waiting');
		if (!this.running || !task) {
			this.end();
			return;
		}
		const before = await snapshot(workspaceRoot());
		task.status = 'running';
		task.startedAt = Date.now();
		const terminal = this.claude.create({
			label: `Nuit · ${task.prompt.replace(/\s+/g, ' ').slice(0, 24)}`,
			icon: 'list-ordered',
			flags: [task.prompt],
			permissionMode: this.data.mode || undefined,
			preserveFocus: true,
		});
		task.session = this.claude.sessionIdFor(terminal);
		this.current = { task, key: this.claude.keyOf(terminal) ?? '', terminal, before, sawRunning: false, wrote: new Set() };
		this.save();
	}

	private onAgent(state: AgentState): void {
		const current = this.current;
		if (!current || state.key !== current.key) {
			return;
		}
		if (state.status === 'running') {
			current.sawRunning = true;
			current.blockedAt = undefined;
			if (current.task.status === 'blocked') {
				current.task.status = 'running';
				this.save();
			} else {
				this.send();
			}
		} else if (state.status === 'waiting') {
			if (!current.blockedAt) {
				current.blockedAt = Date.now();
				current.task.status = 'blocked';
				this.save();
			}
		} else if ((state.status === 'done' || state.status === 'idle') && current.sawRunning) {
			this.finish('done');
		}
	}

	/** A task stuck on a permission, or running far too long, must not hold the whole night. */
	private watch(): void {
		const current = this.current;
		if (!current) {
			return;
		}
		const limit = (vscode.workspace.getConfiguration('orbit').get<number>('queue.taskMinutes') ?? DEFAULT_TASK_MINUTES) * 60000;
		// Events can be missed (a reload, a busy moment): the state and the conversation log are asked directly.
		const state = this.tracker.get(current.key);
		if (state?.status === 'running' || state?.status === 'waiting') {
			current.sawRunning = true;
		}
		if (state?.status === 'done' && current.sawRunning) {
			this.finish('done');
			return;
		}
		if (assistantId() === 'chatgpt' && current.task.startedAt) {
			const session = codexTurnEnded(current.key, current.task.startedAt);
			if (session) {
				current.sawRunning = true;
				if (session.ended && state?.status !== 'waiting') {
					current.transcript = session.file;
					this.finish('done');
					return;
				}
			}
		}
		if (!current.sawRunning && current.task.startedAt && Date.now() - current.task.startedAt > START_MINUTES * 60000) {
			this.finish('failed', `${assistant().name} n'a pas démarré : il attend sans doute une réponse dans son terminal (confiance accordée au dossier, connexion au compte). Le terminal reste ouvert ; réponds-lui puis remets la tâche dans la file.`, false);
		} else if (current.blockedAt && Date.now() - current.blockedAt > BLOCKED_MINUTES * 60000) {
			this.finish('failed', `${assistant().name} attendait une autorisation depuis ${BLOCKED_MINUTES} minutes : la tâche est laissée ouverte dans son terminal, la file continue.`, false);
		} else if (current.task.startedAt && Date.now() - current.task.startedAt > limit) {
			current.terminal.sendText('\x1b', false);
			this.finish('failed', `Arrêtée après ${Math.round(limit / 60000)} minutes.`, false);
		} else {
			this.send();
		}
	}

	private async finish(status: TaskStatus, note?: string, close = true): Promise<void> {
		const current = this.current;
		if (!current) {
			return;
		}
		this.current = undefined;
		// The task as the queue holds it now: the list may have been read again since it started.
		const task = this.data.tasks.find(t => t.id === current.task.id) ?? current.task;
		task.status = status;
		task.endedAt = Date.now();
		task.note = note;
		task.summary = lastAgentAnswer(current.transcript ?? this.tracker.get(current.key)?.transcriptPath ?? this.claude.sessionFileFor(current.terminal));
		task.session = this.tracker.get(current.key)?.sessionId ?? task.session;
		const after = await snapshot(workspaceRoot());
		task.changed = [...after].filter(([file, stamp]) => current.before.get(file) !== stamp).map(([file]) => file).concat([...current.before.keys()].filter(file => !after.has(file)));
		task.changed = [...new Set([...task.changed, ...current.wrote])].filter(file => !file.startsWith('..') && !file.startsWith('.orbit/')).sort();
		if (close && status === 'done') {
			// The conversation stays in the project's discussions; the terminal has done its job.
			current.terminal.dispose();
		}
		this.save();
		if (status === 'failed' && this.data.stopOnFailure) {
			this.end();
		} else if (this.running) {
			this.next();
		}
	}

	private end(): void {
		if (!this.running) {
			return;
		}
		this.running = false;
		clearInterval(this.timer);
		this.data.endedAt = Date.now();
		this.save();
		const done = this.data.tasks.filter(t => t.status === 'done').length;
		const failed = this.data.tasks.filter(t => t.status === 'failed').length;
		const text = `${done} tâche${done > 1 ? 's' : ''} terminée${done > 1 ? 's' : ''}${failed ? `, ${failed} en échec` : ''}`;
		this.writeReport();
		this.phone.send('File de nuit terminée', `${path.basename(workspaceRoot())} · ${text}`, failed ? 'warning' : 'white_check_mark', 'queue');
		vscode.window.showInformationMessage(`File de nuit terminée : ${text}.`, 'Voir le rapport').then(choice => choice && this.show());
	}

	// --- report

	private reportFile(): string {
		return path.join(workspaceRoot(), '.orbit', 'rapport-de-nuit.md');
	}

	private writeReport(): void {
		const lines = [`# Rapport de la file de nuit`, '', `Projet : ${path.basename(workspaceRoot())} · ${new Date(this.data.startedAt ?? Date.now()).toLocaleString('fr-FR')}`, ''];
		for (const task of this.data.tasks.filter(t => t.status !== 'waiting')) {
			const minutes = task.startedAt && task.endedAt ? Math.max(1, Math.round((task.endedAt - task.startedAt) / 60000)) : 0;
			lines.push(`## ${task.status === 'done' ? 'Terminée' : task.status === 'skipped' ? 'Passée' : 'En échec'} · ${task.prompt.split('\n')[0].slice(0, 100)}`, '');
			lines.push(`- Durée : ${minutes} min`);
			lines.push(`- Fichiers changés : ${task.changed?.length ? task.changed.slice(0, 30).map(f => `\`${f}\``).join(', ') : 'aucun'}`);
			if (task.note) {
				lines.push(`- Remarque : ${task.note}`);
			}
			lines.push('', task.summary ? task.summary.slice(0, 3000) : '_Pas de réponse enregistrée._', '');
		}
		try {
			fs.writeFileSync(this.reportFile(), lines.join('\n'));
		} catch {
			// the page still shows the report
		}
	}

	private openReport(): void {
		this.writeReport();
		vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(this.reportFile()));
	}
}

/** State of the working tree: each changed or untracked file with a stamp, to tell what a task touched. */
function snapshot(root: string): Promise<Map<string, string>> {
	return new Promise(resolve => {
		execFile('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '--untracked-files=all'], { cwd: root, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
			const files = new Map<string, string>();
			if (err) {
				resolve(files); // not a git project: the report simply lists no file
				return;
			}
			for (const line of String(stdout).split('\n')) {
				const file = line.slice(3).trim().replace(/^"|"$/g, '');
				if (!file || file.startsWith('.orbit/')) {
					continue;
				}
				let stamp = line.slice(0, 2);
				try {
					const stat = fs.statSync(path.join(root, file));
					stamp += `${stat.size}:${Math.round(stat.mtimeMs)}`;
				} catch {
					// deleted
				}
				files.set(file, stamp);
			}
			resolve(files);
		});
	});
}
