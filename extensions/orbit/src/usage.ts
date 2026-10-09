/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { assistant, assistantId } from './assistant';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readConfig } from './config';

const execFileAsync = promisify(execFile);

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const SETTINGS_URL = 'https://claude.ai/settings/usage';
const REFRESH_MS = 5 * 60 * 1000;
/** Never ask more often than this, however many agents finish at once. */
const MIN_INTERVAL_MS = 45 * 1000;
const BAR_WIDTH = 28;

interface UsageLimit {
	kind: string;
	percent: number;
	severity?: string;
	resets_at?: string;
	scope?: { model?: { display_name?: string } } | null;
}

interface UsageReport {
	limits?: UsageLimit[];
	seven_day_breakdown?: { rows?: { display_name: string; percent: number }[] };
}

interface Credentials {
	accessToken: string;
	subscriptionType?: string;
}

type UsageState = { report: UsageReport; plan: string; at: number } | { error: string; at: number };

/**
 * The plan usage Claude Code shows with `/usage` (current session, week, per model), read
 * with the login Claude Code already holds. Orbit only reads that login; refreshing it stays
 * Claude Code's job, so an expired one just asks the user to open a Claude terminal.
 */
export class UsageMonitor implements vscode.Disposable {

	private readonly item = vscode.window.createStatusBarItem('orbit.usage', vscode.StatusBarAlignment.Right, 999);
	private readonly timer: NodeJS.Timeout;
	private state: UsageState | undefined;
	private inFlight: Promise<void> | undefined;

	constructor() {
		this.item.name = 'Claude Usage';
		this.item.command = 'orbit.usage.show';
		this.timer = setInterval(() => this.refresh(), REFRESH_MS);
		this.refresh();
	}

	dispose(): void {
		clearInterval(this.timer);
		this.item.dispose();
	}

	/** Refresh after an agent worked, without hammering the service. */
	refreshSoon(): void {
		if (!this.state || Date.now() - this.state.at > MIN_INTERVAL_MS) {
			this.refresh();
		}
	}

	async refresh(): Promise<void> {
		this.inFlight ??= this.load().finally(() => { this.inFlight = undefined; });
		await this.inFlight;
	}

	/** The usage card, in Claude's colours, dropping from the toolbar button. */
	async show(): Promise<void> {
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Utilisation de ${assistant().name}…` }, () => this.refresh());
		const state = this.state;
		const failed = !state || 'error' in state;
		const card = {
			title: `Utilisation de ${assistant().name}`,
			plan: failed ? undefined : capitalize(state.plan) || undefined,
			error: failed ? state?.error ?? 'Aucune donnée' : undefined,
			rows: failed ? [] : (state.report.limits ?? []).map(l => ({ label: limitLabel(l), percent: l.percent, detail: resetLabel(l) })),
			breakdownTitle: 'Répartition de la semaine',
			breakdown: failed ? [] : (state.report.seven_day_breakdown?.rows ?? []).filter(r => r.percent > 0).map(r => ({ label: r.display_name, percent: r.percent })),
			actions: [{ label: 'Actualiser', command: 'orbit.usage.show' }, { label: 'Détail sur claude.ai', command: 'orbit.usage.openSettings' }],
			anchorLabel: `Utilisation de ${assistant().name}`,
		};
		try {
			if (await vscode.commands.executeCommand('_orbit.showUsage', card)) {
				return;
			}
		} catch {
			// not running inside Orbit's workbench: fall back to a plain list
		}
		await this.showList();
	}

	openSettings(): void {
		vscode.env.openExternal(vscode.Uri.parse(SETTINGS_URL));
	}

	private async showList(): Promise<void> {
		const state = this.state;
		type Item = vscode.QuickPickItem & { action?: () => unknown };
		const items: Item[] = [];
		let title = `Utilisation de ${assistant().name}`;
		if (!state || 'error' in state) {
			items.push({ label: '$(warning) Utilisation indisponible', detail: state?.error ?? 'Aucune donnée' });
		} else {
			title = state.plan ? `Utilisation · ${assistant().name} ${capitalize(state.plan)}` : title;
			for (const limit of state.report.limits ?? []) {
				items.push({
					label: limitLabel(limit),
					description: `${Math.round(limit.percent)} % utilisé`,
					detail: `${bar(limit.percent)}   ${resetLabel(limit)}`,
				});
			}
			const rows = (state.report.seven_day_breakdown?.rows ?? []).filter(r => r.percent > 0);
			if (rows.length) {
				items.push({ label: 'Répartition de la semaine', kind: vscode.QuickPickItemKind.Separator });
				for (const row of rows) {
					items.push({ label: row.display_name, description: `${Math.round(row.percent)} %`, detail: bar(row.percent) });
				}
			}
		}
		items.push(
			{ label: '', kind: vscode.QuickPickItemKind.Separator },
			{ label: '$(refresh) Actualiser', action: () => this.show() },
			{ label: '$(link-external) Ouvrir le détail sur claude.ai', action: () => this.openSettings() },
		);
		const pick = await vscode.window.showQuickPick(items, { title, placeHolder: `Limites de ton ${assistant().plan}`, matchOnDescription: true });
		await pick?.action?.();
	}

	private async load(): Promise<void> {
		this.state = await fetchUsage();
		this.render();
	}

	private render(): void {
		const state = this.state;
		if (!state || 'error' in state) {
			// Stay out of the way when there is nothing to show (API-key billing, signed out).
			this.item.hide();
			return;
		}
		const limits = state.report.limits ?? [];
		const session = limits.find(l => l.kind === 'session');
		const week = limits.find(l => l.kind === 'weekly_all');
		const parts = [session && `${Math.round(session.percent)} %`, week && `${Math.round(week.percent)} %`].filter(Boolean);
		if (!parts.length) {
			this.item.hide();
			return;
		}
		const worst = Math.max(...limits.map(l => l.percent));
		this.item.text = `$(${assistant().icon}) ${parts.join(' · ')}`;
		this.item.backgroundColor = worst >= 90 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
		this.item.tooltip = usageTooltip(state.plan, limits);
		this.item.show();
	}
}

async function fetchUsage(): Promise<UsageState> {
	const at = Date.now();
	if (assistantId() === 'chatgpt') {
		return codexUsage(at);
	}
	if (readConfig().billing === 'apiKey') {
		return { error: 'Facturation par clé API : les limites d\'abonnement ne s\'appliquent pas.', at };
	}
	const credentials = await readCredentials();
	if (!credentials) {
		return { error: 'Connecte-toi d\'abord dans un terminal Claude (/login).', at };
	}
	try {
		const response = await fetch(USAGE_URL, {
			headers: { 'Authorization': `Bearer ${credentials.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
			signal: AbortSignal.timeout(10000),
		});
		if (response.status === 401) {
			return { error: 'Connexion expirée : ouvre un terminal Claude pour la renouveler, puis actualise.', at };
		}
		if (!response.ok) {
			return { error: `Le service a répondu ${response.status}.`, at };
		}
		return { report: await response.json() as UsageReport, plan: credentials.subscriptionType ?? '', at };
	} catch (err) {
		return { error: `Impossible de joindre le service (${err instanceof Error ? err.message : String(err)}).`, at };
	}
}

/**
 * The ChatGPT plan usage. Codex records the limits of the subscription in its session logs each
 * time the model answers: Orbit reads the most recent record, it never calls a service for it.
 */
function codexUsage(at: number): UsageState {
	const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
	const newest = (dir: string): string[] => {
		try {
			return fs.readdirSync(dir).sort().reverse().map(name => path.join(dir, name));
		} catch {
			return [];
		}
	};
	let looked = 0;
	for (const year of newest(root)) {
		for (const month of newest(year)) {
			for (const day of newest(month)) {
				for (const file of newest(day)) {
					if (!file.endsWith('.jsonl') || looked++ > 12) {
						continue;
					}
					try {
						const size = fs.statSync(file).size;
						const fd = fs.openSync(file, 'r');
						const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
						fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
						fs.closeSync(fd);
						const records = buffer.toString('utf8').split(/\r?\n/).filter(l => l.includes('"rate_limits"'));
						const last = records.length ? JSON.parse(records[records.length - 1]).payload?.rate_limits : undefined;
						if (!last) {
							continue;
						}
						const limits: UsageLimit[] = [];
						for (const window of [last.primary, last.secondary]) {
							if (window && typeof window.used_percent === 'number') {
								// A window of a few hours is the session; a longer one is the week.
								limits.push({ kind: (window.window_minutes ?? 0) <= 12 * 60 ? 'session' : 'weekly_all', percent: window.used_percent, resets_at: window.resets_at ? new Date(window.resets_at * 1000).toISOString() : undefined });
							}
						}
						return { report: { limits }, plan: String(last.plan_type ?? ''), at };
					} catch {
						// unreadable or being written: try an older one
					}
				}
			}
		}
	}
	return { error: 'Aucune utilisation connue : lance une première fois ChatGPT dans un terminal.', at };
}

/** The login Claude Code stored: a file on Windows and Linux, the keychain on macOS. */
async function readCredentials(): Promise<Credentials | undefined> {
	const parse = (text: string): Credentials | undefined => {
		const oauth = JSON.parse(text)?.claudeAiOauth;
		return typeof oauth?.accessToken === 'string' ? { accessToken: oauth.accessToken, subscriptionType: oauth.subscriptionType } : undefined;
	};
	const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json');
	try {
		return parse(await fs.promises.readFile(file, 'utf8'));
	} catch {
		// not stored as a file
	}
	if (process.platform === 'darwin') {
		try {
			const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w']);
			return parse(stdout);
		} catch {
			// not signed in
		}
	}
	return undefined;
}

/** Hover of the status bar counter: the usage card's orange bars, in hover-safe Markdown. */
function usageTooltip(plan: string, limits: UsageLimit[]): vscode.MarkdownString {
	const md = new vscode.MarkdownString(undefined, true);
	md.supportHtml = true;
	md.isTrusted = { enabledCommands: ['orbit.usage.show'] };
	md.appendMarkdown(`$(${assistant().icon}) **Utilisation de ${assistant().name}**${plan ? ` · ${capitalize(plan)}` : ''}\n\n---\n\n`);
	for (const limit of limits) {
		const percent = Math.max(0, Math.min(100, limit.percent));
		const filled = Math.round(percent / 100 * 22);
		const color = percent >= 90 ? '#ff6b6b' : '#d97757';
		md.appendMarkdown(`**${limitLabel(limit)}** &nbsp; <span style="color:${color};">**${Math.round(percent)} %**</span>\n\n`);
		md.appendMarkdown(`<span style="color:${color};">${'━'.repeat(filled)}</span><span style="color:#4a3a46;">${'━'.repeat(22 - filled)}</span>\n\n`);
		md.appendMarkdown(`<span style="color:#8e90a8;">${resetLabel(limit)}</span>\n\n`);
	}
	md.appendMarkdown(`---\n\n[Voir le détail](command:orbit.usage.show)`);
	return md;
}

function limitLabel(limit: UsageLimit): string {
	switch (limit.kind) {
		case 'session': return 'Session en cours';
		case 'weekly_all': return 'Semaine en cours (tous les modèles)';
		case 'weekly_scoped': return `Semaine en cours (${limit.scope?.model?.display_name ?? 'modèle'})`;
		// A limit this version does not know yet: a plain name rather than the API's raw id.
		default: return /weekly/i.test(limit.kind) ? 'Limite de la semaine' : /session|hour/i.test(limit.kind) ? 'Limite de la session' : 'Autre limite';
	}
}

function resetLabel(limit: UsageLimit): string {
	if (!limit.resets_at) {
		return '';
	}
	const date = new Date(limit.resets_at);
	const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	const sameDay = date.toDateString() === new Date().toDateString();
	return sameDay ? `Réinitialisation à ${time}` : `Réinitialisation ${date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} à ${time}`;
}

function bar(percent: number, width = BAR_WIDTH): string {
	const filled = Math.max(0, Math.min(width, Math.round(percent / 100 * width)));
	return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function capitalize(text: string): string {
	return text ? text[0].toUpperCase() + text.slice(1) : '';
}
