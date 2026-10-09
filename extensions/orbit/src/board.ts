/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AgentState, AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { workspaceRoot } from './config';
import { Page } from './page';
import { lastAgentAnswer } from './transcript';

type Column = 'todo' | 'doing' | 'review' | 'done';
const COLUMNS: Column[] = ['todo', 'doing', 'review', 'done'];

interface Card {
	id: string;
	title: string;
	detail: string;
	column: Column;
	/** Name of the agent's terminal, and its key while that terminal lives. */
	agent?: string;
	key?: string;
	/** What the agent said when it finished. */
	summary?: string;
	createdAt: number;
	startedAt?: number;
	endedAt?: number;
}

const FILE = path.join('.orbit', 'taches.json');

/**
 * The task board: a kanban of the project, kept in `.orbit/taches.json`. The user drops cards in
 * « À faire »; an agent takes each one (started from here, one fresh agent per card, or by itself
 * through the `board_*` tools every agent has), the card moves to « En cours », then to
 * « À vérifier » with the agent's own account of what it did. Only the user moves a card to « Fait ».
 */
export class Board extends Page {

	private cards: Card[] = [];
	private root = '';
	/** Cards whose agent has been seen working: the next time it is idle, the card is finished. */
	private readonly working = new Set<string>();
	private autoRun = false;

	constructor(context: vscode.ExtensionContext, private readonly claude: ClaudeTerminals, private readonly tracker: AgentTracker) {
		super(context, 'board', 'Tableau de tâches');
		this.disposables.push(
			vscode.commands.registerCommand('orbit.board.show', () => this.show()),
			vscode.commands.registerCommand('orbit.board.add', async () => {
				const title = await vscode.window.showInputBox({ prompt: 'Nouvelle tâche pour le tableau', placeHolder: 'Ce qu\'il faut faire' });
				if (title?.trim()) {
					this.add(title.trim(), '');
					this.show();
				}
			}),
			tracker.onDidChange(state => this.onAgent(state)),
		);
		this.load();
	}

	private file(): string {
		return path.join(this.root, FILE);
	}

	private load(): void {
		this.root = workspaceRoot();
		try {
			const data = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
			this.cards = (Array.isArray(data.cards) ? data.cards : []).filter((c: Card) => c && typeof c.id === 'string' && typeof c.title === 'string' && COLUMNS.includes(c.column));
		} catch {
			this.cards = [];
		}
	}

	private save(): void {
		try {
			fs.mkdirSync(path.dirname(this.file()), { recursive: true });
			fs.writeFileSync(this.file(), `${JSON.stringify({ cards: this.cards }, null, '\t')}\n`);
		} catch {
			// a read-only project: the board lives for the session
		}
		this.send();
	}

	protected override refresh(): void {
		// The file may have been edited by hand, or by an agent, while no card was running.
		if (!this.cards.some(c => c.column === 'doing' && c.key && this.live(c.key)) || this.root !== workspaceRoot()) {
			this.load();
		}
		this.send();
	}

	private live(key: string | undefined): boolean {
		// An agent that has not said anything yet is starting, not gone.
		return !!key && !!this.claude.byKey(key) && !this.tracker.get(key)?.ended;
	}

	protected send(): void {
		this.post({
			type: 'state',
			project: path.basename(this.root),
			parallel: this.parallel(),
			autoRun: this.autoRun,
			cards: this.cards.map(c => {
				const state = c.column === 'doing' ? this.tracker.get(c.key) : undefined;
				return { ...c, live: c.column === 'doing' && this.live(c.key), waiting: state?.status === 'waiting', tool: state?.tool?.name };
			}),
		});
	}

	private parallel(): number {
		return Math.min(6, Math.max(1, vscode.workspace.getConfiguration('orbit').get<number>('board.parallel', 2)));
	}

	add(title: string, detail: string): Card {
		const card: Card = { id: Math.random().toString(36).slice(2, 8), title: title.slice(0, 200), detail: detail.slice(0, 4000), column: 'todo', createdAt: Date.now() };
		this.cards.push(card);
		this.save();
		return card;
	}

	/** One fresh agent for one card: its whole context is the card. */
	private start(card: Card): void {
		const prompt = [
			`Tâche du tableau du projet : ${card.title}`,
			card.detail ? `\n${card.detail}` : '',
			'\nFais cette tâche, et elle seule. Quand tu as fini, termine par un compte rendu court : ce que tu as fait, les fichiers touchés, ce qui reste à vérifier par moi. Orbit déplace la carte tout seul quand tu as fini : inutile d\'appeler les outils du tableau pour elle.',
		].join('');
		const terminal = this.claude.create({ label: `Tâche · ${card.title.replace(/\s+/g, ' ').slice(0, 24)}`, icon: 'checklist', flags: [prompt], preserveFocus: true });
		card.column = 'doing';
		card.agent = terminal.name;
		card.key = this.claude.keyOf(terminal);
		card.startedAt = Date.now();
		card.endedAt = undefined;
		card.summary = undefined;
		this.save();
	}

	/** Starts cards of « À faire », as many at a time as the setting allows. */
	private fill(): void {
		if (!this.autoRun) {
			return;
		}
		let running = this.cards.filter(c => c.column === 'doing' && this.live(c.key)).length;
		for (const card of this.cards.filter(c => c.column === 'todo')) {
			if (running >= this.parallel()) {
				return;
			}
			this.start(card);
			running++;
		}
		if (!this.cards.some(c => c.column === 'todo') && !running) {
			this.autoRun = false;
			this.send();
		}
	}

	private onAgent(state: AgentState): void {
		const card = this.cards.find(c => c.column === 'doing' && c.key === state.key);
		if (!card) {
			return;
		}
		if (state.status === 'running') {
			this.working.add(card.id);
		} else if ((state.status === 'done' || state.status === 'idle') && this.working.has(card.id)) {
			this.working.delete(card.id);
			const terminal = this.claude.byKey(state.key);
			card.summary = lastAgentAnswer(state.transcriptPath ?? (terminal && this.claude.sessionFileFor(terminal)))?.slice(0, 6000);
			card.column = 'review';
			card.endedAt = Date.now();
			this.save();
			vscode.window.showInformationMessage(`Tâche à vérifier : ${card.title}`, 'Ouvrir le tableau').then(choice => choice && this.show());
			this.fill();
			return;
		}
		this.send();
	}

	// ---- what agents do through their own tools (`board_*`, see control-mcp.js)

	list(): unknown {
		this.refresh();
		return this.cards.map(c => ({ id: c.id, title: c.title, detail: c.detail, column: c.column, agent: c.agent, summary: c.summary }));
	}

	take(id: string | undefined, terminalKey: string | undefined): unknown {
		this.refresh();
		const card = id ? this.cards.find(c => c.id === id) : this.cards.find(c => c.column === 'todo');
		if (!card) {
			throw new Error(id ? `Aucune carte « ${id} ».` : 'Aucune carte dans « À faire ».');
		}
		if (card.column !== 'todo') {
			throw new Error(`La carte « ${card.title} » est déjà prise (${card.column}).`);
		}
		const terminal = terminalKey ? this.claude.byKey(terminalKey) : undefined;
		card.column = 'doing';
		card.agent = terminal?.name ?? 'un agent';
		// No key: the agent says itself when it is done, with board_move.
		card.key = undefined;
		card.startedAt = Date.now();
		this.save();
		return { id: card.id, title: card.title, detail: card.detail };
	}

	move(id: string, column: string, summary: string | undefined): unknown {
		this.refresh();
		const card = this.cards.find(c => c.id === id);
		if (!card) {
			throw new Error(`Aucune carte « ${id} ».`);
		}
		// « Fait » is the user's word: an agent hands its work over for checking.
		const to: Column = column === 'todo' ? 'todo' : column === 'doing' ? 'doing' : 'review';
		card.column = to;
		if (summary) {
			card.summary = summary.slice(0, 6000);
		}
		if (to === 'review') {
			card.endedAt = Date.now();
		}
		this.save();
		return { ok: true, column: to, note: column === 'done' ? 'La carte est dans « À vérifier » : c\'est l\'utilisateur qui la passe à « Fait ».' : undefined };
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected async onMessage(msg: any): Promise<void> {
		const card = this.cards.find(c => c.id === msg.id);
		switch (msg.type) {
			case 'add':
				if (String(msg.title ?? '').trim()) {
					this.add(String(msg.title).trim(), String(msg.detail ?? '').trim());
				}
				break;
			case 'edit':
				if (card && String(msg.title ?? '').trim()) {
					card.title = String(msg.title).trim().slice(0, 200);
					card.detail = String(msg.detail ?? '').trim().slice(0, 4000);
					this.save();
				}
				break;
			case 'move':
				if (card && COLUMNS.includes(msg.column)) {
					const before = String(msg.before ?? '');
					this.cards = this.cards.filter(c => c !== card);
					if (card.column !== msg.column) {
						if (msg.column === 'doing' && card.column === 'todo') {
							// Dropping a card on « En cours » is asking for it to be done.
							this.cards.push(card);
							this.start(card);
							break;
						}
						card.column = msg.column;
						if (msg.column === 'todo') {
							card.key = undefined;
							card.agent = undefined;
						}
					}
					const at = this.cards.findIndex(c => c.id === before);
					at >= 0 ? this.cards.splice(at, 0, card) : this.cards.push(card);
					this.save();
				}
				break;
			case 'start':
				if (card && (card.column === 'todo' || card.column === 'review' || (card.column === 'doing' && !this.live(card.key)))) {
					this.start(card);
				}
				break;
			case 'runAll':
				this.autoRun = !this.autoRun;
				this.send();
				this.fill();
				break;
			case 'goto': {
				const terminal = card?.key ? this.claude.byKey(card.key) : undefined;
				terminal ? terminal.show() : vscode.window.showInformationMessage('Le terminal de cet agent est fermé.');
				break;
			}
			case 'remove':
				if (card) {
					this.cards = this.cards.filter(c => c !== card);
					this.save();
				}
				break;
			case 'clearDone': {
				const done = this.cards.filter(c => c.column === 'done').length;
				if (done && await vscode.window.showWarningMessage(`Retirer les ${done} carte${done > 1 ? 's' : ''} terminée${done > 1 ? 's' : ''} du tableau ?`, { modal: true }, 'Retirer')) {
					this.cards = this.cards.filter(c => c.column !== 'done');
					this.save();
				}
				break;
			}
			case 'parallel':
				await vscode.workspace.getConfiguration('orbit').update('board.parallel', Math.min(6, Math.max(1, Number(msg.value) || 2)), vscode.ConfigurationTarget.Global);
				this.send();
				break;
		}
	}
}
