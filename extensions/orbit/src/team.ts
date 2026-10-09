/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AddressInfo } from 'net';
import { AgentActivity } from './agentActivity';
import { AgentState, AgentStatus, AgentTracker, ORBIT_DIR } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { readConfig, workspaceRoot } from './config';
import { compact, sessionUsage } from './tokens';
import { agentAnswers } from './transcript';
import { assistant } from './assistant';
import { mcpConfigPath } from './orbitControl';

const execFileAsync = promisify(execFile);
const REGISTRY = path.join(ORBIT_DIR, 'team');
const ROLES_KEY = 'orbit.team.roles';
const LEAD_NAME = 'Chef d\'équipe';
const MAX_WAIT_S = 600;

/** Job → icon. The lead picks a job; any codicon id is accepted too. */
export const ROLE_ICONS: Record<string, string> = {
	design: 'paintcan', ui: 'layout', frontend: 'browser', backend: 'server', api: 'plug', database: 'database', data: 'graph',
	tests: 'beaker', review: 'eye', debug: 'bug', docs: 'book', research: 'search', deploy: 'rocket', infra: 'cloud', security: 'shield',
	mobile: 'device-mobile', game: 'game', audio: 'unmute', assets: 'file-media', refactor: 'wrench', perf: 'dashboard', config: 'settings-gear',
	content: 'pencil', i18n: 'globe', git: 'git-branch', ai: 'sparkle', lead: 'orbit-claude',
};
const COLORS = ['terminal.ansiCyan', 'terminal.ansiGreen', 'terminal.ansiYellow', 'terminal.ansiBlue', 'terminal.ansiMagenta', 'terminal.ansiRed'];

interface Role {
	name: string;
	role: string;
	icon: string;
	color: string;
	lead?: boolean;
	/** Folder the agent works in (its worktree, or the project). */
	cwd: string;
}

const STATUS_LABELS: Record<AgentStatus, string> = { running: 'travaille', waiting: 'attend ton accord', done: 'a terminé', idle: 'prêt' };

/**
 * The team: one lead Claude you talk to, which creates, names, briefs and follows the other
 * agents through the `orbit-team` tools. Every agent carries a name, a one-line role and an
 * icon, shown on its tab, in the Team view and on the Orbit map.
 */
export class Team implements vscode.TreeDataProvider<vscode.Terminal>, vscode.Disposable {

	private readonly roles = new Map<string, Role>();
	private readonly server = http.createServer((req, res) => this.handle(req, res));
	private readonly token = randomBytes(24).toString('hex');
	private readonly entry = path.join(REGISTRY, `${process.pid}.json`);
	private port = 0;
	private focusedAt = Date.now();
	/** Started with the extension: the lead's tools find this window again after a restart. */
	private readonly ready: Promise<string>;
	private readonly disposables: vscode.Disposable[] = [];
	private refreshTimer: NodeJS.Timeout | undefined;

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly context: vscode.ExtensionContext, private readonly claude: ClaudeTerminals, private readonly tracker: AgentTracker, private readonly activity: AgentActivity) {
		for (const [key, role] of Object.entries(context.workspaceState.get<Record<string, Role>>(ROLES_KEY, {}))) {
			this.roles.set(key, role);
		}
		this.disposables.push(
			claude.onDidChange(() => { this.refresh(); this.labelAll(); this.register(); }),
			claude.onDidClose(key => { this.roles.delete(key); this.save(); this.refresh(); }),
			tracker.onDidChange(() => this.refresh()),
			vscode.window.onDidChangeWindowState(state => {
				if (state.focused) {
					this.focusedAt = Date.now();
					this.register();
				}
			}),
		);
		this.labelAll();
		this.ready = this.startServer();
	}

	dispose(): void {
		this.server.close();
		try {
			fs.unlinkSync(this.entry);
		} catch {
			// already gone
		}
		clearTimeout(this.refreshTimer);
		this.disposables.forEach(d => d.dispose());
		this._onDidChangeTreeData.dispose();
	}

	roleOf(key: string | undefined): Role | undefined {
		return key ? this.roles.get(key) : undefined;
	}

	// --- the lead

	/** Show the lead, or start it. */
	async startLead(): Promise<void> {
		const existing = this.claude.list().find(t => this.roleOf(this.claude.keyOf(t))?.lead);
		if (existing) {
			existing.show();
			return;
		}
		// A plain Claude is already open: ask whether the lead takes its place or opens beside it,
		// so starting a project does not end with two terminals by accident.
		const plain = this.claude.list().filter(t => !this.roleOf(this.claude.keyOf(t)));
		const current = this.claude.current();
		const target = current && plain.includes(current) ? current : plain[0];
		const flags: string[] = [];
		if (target) {
			const busy = this.tracker.get(this.claude.keyOf(target))?.status === 'running';
			const replace = 'Remplacer ce Claude';
			const beside = 'En ouvrir un nouveau';
			const choice = await vscode.window.showInformationMessage(
				'Lancer le chef d\'équipe',
				{
					modal: true,
					detail: `« ${target.name} » est déjà ouvert. Le chef d'équipe peut prendre sa place (la discussion en cours continue avec lui) ou s'ouvrir dans un nouveau terminal.${busy ? '\n\nAttention : ce Claude est en train de travailler ; le remplacer l\'interrompt.' : ''}`,
				},
				replace, beside,
			);
			if (!choice) {
				return;
			}
			if (choice === replace) {
				// A conversation that has started is resumed by the lead; an empty one has nothing to resume.
				const session = this.claude.sessionIdFor(target);
				const transcript = this.claude.sessionFileFor(target);
				if (session && transcript && fs.existsSync(transcript)) {
					flags.push('--resume', session);
				}
				target.dispose();
			}
		}
		const config = await this.ensureServer();
		const terminal = this.claude.create({
			label: LEAD_NAME,
			color: 'terminal.ansiMagenta',
			mcpConfigs: [config],
			instructions: { name: 'lead', text: LEAD_PROMPT },
			flags,
		});
		this.assign(terminal, { name: LEAD_NAME, role: 'Ton interlocuteur : découpe le travail, crée et pilote les autres agents, te rapporte les résultats.', icon: 'orbit-claude', color: 'terminal.ansiMagenta', lead: true, cwd: workspaceRoot() });
		vscode.commands.executeCommand('orbit.team.focus');
	}

	// --- tree

	getChildren(element?: vscode.Terminal): vscode.Terminal[] {
		if (element) {
			return [];
		}
		const terminals = this.claude.list();
		// The lead first, then its agents, then the other Claude terminals.
		return terminals.sort((a, b) => this.rank(a) - this.rank(b));
	}

	getTreeItem(terminal: vscode.Terminal): vscode.TreeItem {
		const key = this.claude.keyOf(terminal);
		const role = this.roleOf(key);
		const state = this.tracker.get(key);
		const status = state?.status ?? 'idle';
		const item = new vscode.TreeItem(terminal.name);
		const usage = sessionUsage(state?.transcriptPath ?? this.claude.sessionFileFor(terminal));
		item.description = `${STATUS_LABELS[status]}${usage?.output ? ` · ${compact(usage.output)} jetons` : ''}${role?.role && !role.lead ? ` · ${role.role}` : ''}`;
		// The assistant's mark for agents without a job icon (roles saved under Claude keep following the choice).
		const own = !role?.icon || role.icon === 'orbit-claude' || role.icon === 'orbit-openai';
		const icon = own ? assistant().icon : role!.icon!;
		item.iconPath = status === 'running' && !role?.lead ? new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor(role?.color ?? assistant().color))
			: status === 'waiting' ? new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('editorWarning.foreground'))
				: new vscode.ThemeIcon(icon, new vscode.ThemeColor(own ? assistant().color : role?.color ?? assistant().color));
		item.tooltip = this.tooltip(terminal, role, state);
		item.contextValue = role?.lead ? 'lead' : status === 'running' ? 'agent.running' : 'agent';
		item.command = { command: 'orbit.team.show', title: 'Aller à l\'agent', arguments: [terminal] };
		return item;
	}

	private tooltip(terminal: vscode.Terminal, role: Role | undefined, state: AgentState | undefined): vscode.MarkdownString {
		const key = this.claude.keyOf(terminal);
		const files = this.activity.snapshot().agents.find(a => a.key === key)?.files ?? [];
		const writes = files.filter(f => f.mode === 'write').map(f => f.relative);
		const md = new vscode.MarkdownString(undefined, true);
		md.appendMarkdown(`$(${!role?.icon || role.icon === 'orbit-claude' ? assistant().icon : role.icon}) **${escapeMd(terminal.name)}**\n\n`);
		if (role?.role) {
			md.appendMarkdown(`${escapeMd(role.role)}\n\n`);
		}
		md.appendMarkdown(`État : ${STATUS_LABELS[state?.status ?? 'idle']}${state?.status === 'running' && state.tool ? ` · ${state.tool.name}` : ''}`);
		const usage = sessionUsage(state?.transcriptPath ?? this.claude.sessionFileFor(terminal));
		if (usage?.messages) {
			// The context window fills up: past ~150 k the agent is close to compacting.
			md.appendMarkdown(`\n\nJetons : ${compact(usage.output)} écrits · contexte ${compact(usage.context)} · ${usage.messages} réponses`);
		}
		if (writes.length) {
			md.appendMarkdown(`\n\nModifie : ${writes.slice(0, 6).map(f => `\`${f}\``).join(', ')}`);
		}
		if (state?.prompt) {
			md.appendMarkdown(`\n\n_Dernière consigne :_ ${escapeMd(state.prompt.slice(0, 240))}`);
		}
		return md;
	}

	private rank(terminal: vscode.Terminal): number {
		const role = this.roleOf(this.claude.keyOf(terminal));
		return role?.lead ? 0 : role ? 1 : 2;
	}

	private refresh(): void {
		clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => this._onDidChangeTreeData.fire(), 200);
	}

	// --- roles on tabs

	private assign(terminal: vscode.Terminal, role: Role): void {
		const key = this.claude.keyOf(terminal);
		if (!key) {
			return;
		}
		this.roles.set(key, role);
		this.save();
		this.refresh();
		this.label(terminal);
	}

	/** The role is what you see when hovering a tab, before anything else. */
	private async label(terminal: vscode.Terminal): Promise<void> {
		const key = this.claude.keyOf(terminal);
		const role = this.roleOf(key);
		const pid = await terminal.processId;
		if (!role || pid === undefined) {
			return;
		}
		const state = this.tracker.get(key);
		vscode.commands.executeCommand('_orbit.setTerminalStatus', pid, state?.status ?? 'idle', `${role.role}\n${STATUS_LABELS[state?.status ?? 'idle']}`).then(undefined, () => undefined);
	}

	private labelAll(): void {
		for (const terminal of this.claude.list()) {
			this.label(terminal);
		}
	}

	private save(): void {
		this.context.workspaceState.update(ROLES_KEY, Object.fromEntries(this.roles));
	}

	// --- local server for the lead's tools

	private ensureServer(): Promise<string> {
		return this.ready;
	}

	/**
	 * Like the `orbit` tools: the config holds no address, the MCP server reads the registry
	 * (~/.orbit/team/<pid>.json) on every call and picks the window that owns its terminal.
	 */
	private async startServer(): Promise<string> {
		this.port = await new Promise<number>(resolve => this.server.listen(0, '127.0.0.1', () => resolve((this.server.address() as AddressInfo).port)));
		this.register();
		const config = mcpConfigPath('orbit-team', this.context.extensionPath);
		const text = JSON.stringify({
			mcpServers: {
				'orbit-team': {
					type: 'stdio',
					command: process.execPath,
					args: [path.join(this.context.extensionPath, 'team', 'team-mcp.js')],
					env: { ELECTRON_RUN_AS_NODE: '1' },
				},
			},
		}, null, 2);
		try {
			fs.mkdirSync(path.dirname(config), { recursive: true });
			if (!fs.existsSync(config) || fs.readFileSync(config, 'utf8') !== text) {
				fs.writeFileSync(config, text);
			}
		} catch (err) {
			console.error('[orbit] could not write the team MCP config', err);
		}
		return config;
	}

	private register(): void {
		if (!this.port) {
			return;
		}
		const entry = {
			pid: process.pid,
			url: `http://127.0.0.1:${this.port}`,
			token: this.token,
			focusedAt: this.focusedAt,
			terminals: this.claude.list().map(t => this.claude.keyOf(t)).filter(Boolean),
		};
		try {
			fs.mkdirSync(REGISTRY, { recursive: true });
			fs.writeFileSync(this.entry, JSON.stringify(entry));
		} catch (err) {
			console.error('[orbit] could not register the team server', err);
		}
	}

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url ?? '/', 'http://x');
		const q = Object.fromEntries(url.searchParams);
		const reply = (status: number, body: unknown) => {
			res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify(body));
		};
		if (q.token !== this.token) {
			return reply(403, { error: 'bad token' });
		}
		try {
			switch (url.pathname) {
				case '/agents': return reply(200, this.describeAll());
				case '/create': return reply(200, await this.createAgent(q));
				case '/send': {
					const terminal = this.find(q.agent);
					this.claude.sendMessage(terminal, String(q.message ?? ''));
					return reply(200, { ok: true });
				}
				case '/rename': {
					const terminal = this.find(q.agent);
					const key = this.claude.keyOf(terminal)!;
					const role = this.roles.get(key) ?? { name: terminal.name, role: '', icon: 'sparkle', color: this.claude.colorOf(terminal), cwd: workspaceRoot() };
					if (q.name) {
						await this.claude.rename(terminal, q.name);
						role.name = q.name;
					}
					role.role = q.role ?? role.role;
					role.icon = q.icon ? iconOf(q.icon) : role.icon;
					this.assign(terminal, role);
					return reply(200, { ok: true });
				}
				case '/read': return reply(200, this.read(this.find(q.agent), Number(q.count) || 3));
				case '/wait': return reply(200, await this.wait(String(q.agents ?? ''), Math.min(MAX_WAIT_S, Number(q.timeout) || 300)));
				case '/focus':
					this.find(q.agent).show();
					return reply(200, { ok: true });
				case '/stop':
					this.find(q.agent).sendText('\x1b', false);
					return reply(200, { ok: true });
				case '/close':
					this.find(q.agent).dispose();
					return reply(200, { ok: true });
				case '/map':
					await vscode.commands.executeCommand('orbit.map.show');
					return reply(200, { ok: true });
				case '/open': {
					const file = path.isAbsolute(String(q.file)) ? String(q.file) : path.join(workspaceRoot(), String(q.file));
					await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false, preserveFocus: true, selection: q.line ? new vscode.Range(Number(q.line) - 1, 0, Number(q.line) - 1, 0) : undefined });
					return reply(200, { ok: true });
				}
				default: return reply(404, { error: `unknown route ${url.pathname}` });
			}
		} catch (err) {
			return reply(400, { error: err instanceof Error ? err.message : String(err) });
		}
	}

	private find(nameOrKey: string | undefined): vscode.Terminal {
		const wanted = String(nameOrKey ?? '').trim().toLowerCase();
		const terminal = this.claude.list().find(t => t.name.toLowerCase() === wanted || this.claude.keyOf(t) === nameOrKey)
			?? this.claude.list().find(t => t.name.toLowerCase().includes(wanted) && wanted.length > 1);
		if (!terminal) {
			throw new Error(`Aucun agent « ${nameOrKey} ». Agents : ${this.claude.list().map(t => t.name).join(', ')}`);
		}
		return terminal;
	}

	private describeAll(): unknown[] {
		const snapshot = this.activity.snapshot().agents;
		return this.claude.list().map(terminal => {
			const key = this.claude.keyOf(terminal);
			const role = this.roleOf(key);
			const state = this.tracker.get(key);
			const files = snapshot.find(a => a.key === key)?.files ?? [];
			return {
				name: terminal.name,
				role: role?.role ?? '',
				icon: role?.icon,
				lead: !!role?.lead,
				status: state?.status ?? 'idle',
				currentTool: state?.status === 'running' ? state.tool?.name : undefined,
				lastInstruction: state?.prompt?.slice(0, 300),
				modifiedFiles: files.filter(f => f.mode === 'write').map(f => f.relative),
				folder: role?.cwd,
			};
		});
	}

	private async createAgent(q: Record<string, string>): Promise<unknown> {
		const name = String(q.name ?? '').trim().slice(0, 40);
		const prompt = String(q.prompt ?? '').trim();
		if (!name || !prompt) {
			throw new Error('name et prompt sont obligatoires');
		}
		if (this.claude.list().some(t => t.name.toLowerCase() === name.toLowerCase())) {
			throw new Error(`Un agent s'appelle déjà « ${name} » : choisis un autre nom.`);
		}
		const root = workspaceRoot();
		const slug = name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
		let cwd = root;
		if (q.worktree === 'true') {
			const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '');
			cwd = path.join(root, '.orbit', 'worktrees', `${slug}-${stamp}`);
			await execFileAsync('git', ['worktree', 'add', '-q', '-b', `orbit/${slug}-${stamp}`, cwd], { cwd: root });
		}
		await ignoreOrbitFolder(root);
		// The brief travels as a file: any length, no shell quoting.
		const brief = path.join('.orbit', 'tasks', `${slug}.md`);
		await fs.promises.mkdir(path.join(cwd, '.orbit', 'tasks'), { recursive: true });
		await fs.promises.writeFile(path.join(cwd, brief), `# ${name}\n\nRôle : ${q.role ?? ''}\n\n${prompt}\n`);
		const color = COLORS[this.claude.list().filter(t => this.roleOf(this.claude.keyOf(t)) && !this.roleOf(this.claude.keyOf(t))?.lead).length % COLORS.length];
		const icon = iconOf(q.icon);
		const terminal = this.claude.create({
			cwd,
			label: name,
			icon,
			color,
			model: q.model || undefined,
			// Agents work unattended: auto mode unless the user chose another one (orbit.team.agentMode).
			permissionMode: readConfig().agentMode,
			flags: [`Lis le fichier ${brief.replace(/\\/g, '/')} puis fais la tâche décrite.`],
			preserveFocus: true,
		});
		this.assign(terminal, { name, role: String(q.role ?? '').slice(0, 160), icon, color, cwd });
		return { ok: true, name, folder: cwd };
	}

	/** Last answers of an agent, read from its transcript. */
	private read(terminal: vscode.Terminal, count: number): unknown {
		const key = this.claude.keyOf(terminal);
		const transcript = this.tracker.get(key)?.transcriptPath ?? this.claude.sessionFileFor(terminal);
		const answers = agentAnswers(transcript);
		return { agent: terminal.name, status: this.tracker.get(key)?.status ?? 'idle', lastAnswers: answers.slice(-count).map(a => a.slice(-4000)) };
	}

	/** Block until every named agent has stopped working (done, idle or waiting for permission). */
	private async wait(names: string, timeoutS: number): Promise<unknown> {
		const terminals = names ? names.split(',').map(n => this.find(n.trim())) : this.claude.list().filter(t => !this.roleOf(this.claude.keyOf(t))?.lead);
		const deadline = Date.now() + timeoutS * 1000;
		const statusOf = (t: vscode.Terminal) => this.tracker.get(this.claude.keyOf(t))?.status ?? 'idle';
		// Give freshly briefed agents a moment to start before trusting an "idle".
		await new Promise(r => setTimeout(r, 3000));
		while (Date.now() < deadline && terminals.some(t => statusOf(t) === 'running')) {
			await new Promise(r => setTimeout(r, 1500));
		}
		return { timedOut: terminals.some(t => statusOf(t) === 'running'), agents: terminals.map(t => ({ name: t.name, status: statusOf(t) })) };
	}
}

function iconOf(value: string | undefined): string {
	const v = String(value ?? '').trim().toLowerCase();
	return ROLE_ICONS[v] ?? (/^[a-z0-9-]+$/.test(v) && v ? v : 'sparkle');
}

function escapeMd(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

async function ignoreOrbitFolder(root: string): Promise<void> {
	try {
		const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], { cwd: root });
		const exclude = path.resolve(root, stdout.trim(), 'info', 'exclude');
		const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
		if (!/^\.orbit\/$/m.test(current)) {
			fs.mkdirSync(path.dirname(exclude), { recursive: true });
			fs.appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}.orbit/\n`);
		}
	} catch {
		// not a git repository: nothing to keep out of history
	}
}

const LEAD_PROMPT = `You are the TEAM LEAD inside Orbit. The user talks only to you. You run a team of other Claude Code agents, each in its own terminal, through the orbit-team tools (team_create_agent, team_list, team_message, team_read, team_wait, team_focus, team_rename, team_stop, team_close, team_show_map, team_open_file).

How you work:
- Understand the request, then split it into independent pieces of work. Small or tightly coupled tasks: do them yourself, or give them to ONE agent. Never create more than 6 agents at once.
- For each piece, create an agent with: a short, clear name in the user's language (2 to 3 words, e.g. "Design accueil", "API paiement", "Tests"), a one-line role describing its job (shown when the user hovers its tab), an icon matching the job (design, ui, frontend, backend, api, database, data, tests, review, debug, docs, research, deploy, infra, security, mobile, game, audio, assets, refactor, perf, config, content, i18n, git, ai), and a complete, self-contained brief (the agent sees only its brief: name the files to create or edit, the expected result, and how to check it).
- Avoid two agents editing the same files. When they must work in the same area, give each one worktree=true so they work on separate git branches.
- After creating agents, call team_show_map so the user sees the team, then team_wait to follow progress. Use team_read to collect results, and team_message to correct or continue an agent.
- When an agent is waiting for a permission, tell the user which agent and why, and use team_focus to bring that terminal to them.
- Report back concisely, in the user's language: who did what, which files changed, what is left. Use team_focus or team_open_file to lead the user to the most important result.
- Rename agents (team_rename) when their job changes. Close agents (team_close) that are finished and no longer useful, after reporting.`;
