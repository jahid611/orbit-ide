/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as https from 'https';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { workspaceRoot } from './config';
import { renderWebview, webviewOptions } from './webview';

const SERVER = 'ntfy.sh';
/** A turn shorter than this ends without a notification: the user is still at the keyboard. */
const LONG_TURN_MS = 90 * 1000;
const PAIRED_KEY = 'orbit.phone.paired';

type Kind = 'waiting' | 'done' | 'queue' | 'test';

/**
 * Notifications on the user's phone, through ntfy (a free relay, no account): Orbit publishes
 * to a private topic, the ntfy app on the phone is subscribed to it. The phone is linked by
 * scanning a code shown on a page of the IDE. Off until then. Only short status lines leave the
 * machine: project, agent, and what it is waiting for.
 */
export class Phone implements vscode.Disposable {

	private readonly disposables: vscode.Disposable[] = [];
	private readonly told = new Map<string, string>();
	private panel: vscode.WebviewPanel | undefined;

	constructor(private readonly context: vscode.ExtensionContext, private readonly claude: ClaudeTerminals, tracker: AgentTracker) {
		this.disposables.push(
			vscode.commands.registerCommand('orbit.phone.setup', () => this.show()),
			vscode.commands.registerCommand('orbit.phone.test', () => this.send('Orbit', 'Les notifications arrivent bien sur ce téléphone.', 'tada', 'test')),
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('orbit.phone') && this.post()),
			tracker.onDidChange(state => {
				if (!this.topic()) {
					return;
				}
				const terminal = this.claude.byKey(state.key);
				const name = terminal?.name ?? 'Agent';
				const project = path.basename(state.cwd ?? workspaceRoot());
				// One notification per state and per turn, never a stream.
				const mark = `${state.status}:${state.turnStartedAt ?? 0}`;
				if (this.told.get(state.key) === mark) {
					return;
				}
				if (state.status === 'waiting') {
					this.told.set(state.key, mark);
					const tool = state.tool?.name ? ` (${state.tool.name})` : '';
					this.send(`${name} attend ton accord`, `${project}${tool}${state.message ? ` · ${state.message.slice(0, 140)}` : ''}`, 'bell', 'waiting');
				} else if (state.status === 'done' && state.turnStartedAt && Date.now() - state.turnStartedAt > LONG_TURN_MS && !vscode.window.state.focused) {
					this.told.set(state.key, mark);
					this.send(`${name} a terminé`, `${project}${state.prompt ? ` · ${state.prompt.slice(0, 140)}` : ''}`, 'white_check_mark', 'done');
				}
			}),
		);
	}

	dispose(): void {
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	topic(): string {
		return vscode.workspace.getConfiguration('orbit').get<string>('phone.topic')?.trim() ?? '';
	}

	/** True once the user has confirmed that a notification reached the phone. */
	paired(): boolean {
		return !!this.topic() && this.context.globalState.get<string>(PAIRED_KEY) === this.topic();
	}

	private wants(kind: Kind): boolean {
		return kind === 'test' || (vscode.workspace.getConfiguration('orbit').get<boolean>(`phone.${kind}`) ?? true);
	}

	/** Publishes one notification. Resolves to false when it was not sent. */
	send(title: string, body: string, tag?: string, kind: Kind = 'queue'): Promise<boolean> {
		const topic = this.topic();
		if (!topic || !this.wants(kind)) {
			return Promise.resolve(false);
		}
		return new Promise(resolve => {
			const payload = Buffer.from(JSON.stringify({ topic, title, message: body || title, tags: tag ? [tag] : undefined }));
			const request = https.request({ host: SERVER, path: '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }, timeout: 10000 }, response => {
				response.resume();
				resolve((response.statusCode ?? 500) < 300);
			});
			request.on('error', () => resolve(false));
			request.on('timeout', () => { request.destroy(); resolve(false); });
			request.end(payload);
		});
	}

	// --- the linking page

	private show(): void {
		if (this.panel) {
			this.panel.reveal();
			return;
		}
		this.panel = vscode.window.createWebviewPanel('orbit.phone', 'Téléphone', vscode.ViewColumn.Active, { ...webviewOptions(this.context.extensionUri), retainContextWhenHidden: true });
		this.panel.iconPath = new vscode.ThemeIcon('device-mobile');
		this.panel.webview.html = renderWebview(this.panel.webview, this.context.extensionUri, 'phone');
		const listener = this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
		this.panel.onDidDispose(() => {
			listener.dispose();
			this.panel = undefined;
		});
	}

	private post(extra: Record<string, unknown> = {}): void {
		const config = vscode.workspace.getConfiguration('orbit');
		const topic = this.topic();
		this.panel?.webview.postMessage({
			type: 'state',
			topic,
			link: topic ? `https://${SERVER}/${topic}` : '',
			paired: this.paired(),
			waiting: config.get<boolean>('phone.waiting') ?? true,
			done: config.get<boolean>('phone.done') ?? true,
			queue: config.get<boolean>('phone.queue') ?? true,
			...extra,
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async onMessage(msg: any): Promise<void> {
		const config = vscode.workspace.getConfiguration('orbit');
		switch (msg.type) {
			case 'ready':
				if (!this.topic()) {
					// A private topic, created the moment the page opens: the code to scan is there at once.
					await config.update('phone.topic', `orbit-${randomBytes(9).toString('hex')}`, vscode.ConfigurationTarget.Global);
				}
				this.post();
				break;
			case 'test': {
				const sent = await this.send('Orbit est relié', 'Tu recevras ici ce qui demande ton attention.', 'tada', 'test');
				this.post({ tested: sent ? 'sent' : 'failed' });
				break;
			}
			case 'confirm':
				await this.context.globalState.update(PAIRED_KEY, this.topic());
				this.post();
				break;
			case 'toggle':
				if (['waiting', 'done', 'queue'].includes(msg.key)) {
					await config.update(`phone.${msg.key}`, !!msg.value, vscode.ConfigurationTarget.Global);
				}
				break;
			case 'renew':
				// Another phone, or a link that leaked: a new topic, the old one stops receiving.
				await this.context.globalState.update(PAIRED_KEY, undefined);
				await config.update('phone.topic', `orbit-${randomBytes(9).toString('hex')}`, vscode.ConfigurationTarget.Global);
				this.post();
				break;
			case 'disable':
				await this.context.globalState.update(PAIRED_KEY, undefined);
				await config.update('phone.topic', '', vscode.ConfigurationTarget.Global);
				this.panel?.dispose();
				break;
			case 'copy':
				await vscode.env.clipboard.writeText(String(msg.text ?? ''));
				break;
			case 'open':
				if (/^https:\/\//.test(String(msg.url))) {
					vscode.env.openExternal(vscode.Uri.parse(String(msg.url)));
				}
				break;
		}
	}
}
