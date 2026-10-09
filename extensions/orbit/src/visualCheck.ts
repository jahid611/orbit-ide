/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { screenshot } from './community';
import { detectServers } from './livePreview';
import { Page } from './page';

const INTERFACE_FILE = /\.(css|scss|sass|less|html?|jsx|tsx|vue|svelte|astro|mdx)$/i;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const MARK = '[Relecture visuelle d\'Orbit]';

interface Pair {
	url: string;
	before?: string;
	after?: string;
	at: number;
	agent?: string;
	key?: string;
}

/**
 * The agent proofreads with its eyes. While the project's page runs locally, Orbit keeps a picture
 * of it; when an agent has changed interface files, it takes a second one at the end of the turn
 * and hands both to the agent, which looks at them and fixes what came out wrong. The pictures are
 * taken by the browser already on the machine, without a window.
 */
export class VisualCheck extends Page {

	/** Agents that wrote interface files during their current turn. */
	private readonly touched = new Set<string>();
	/** Agents whose current turn is the proofreading itself: it is not proofread again. */
	private readonly proofreading = new Set<string>();
	private pair: Pair | undefined;
	private shooting = false;
	private readonly status = vscode.window.createStatusBarItem('orbit.visual', vscode.StatusBarAlignment.Left, 94);

	constructor(context: vscode.ExtensionContext, tracker: AgentTracker, private readonly claude: ClaudeTerminals) {
		super(context, 'visual', 'Relecture visuelle');
		this.status.name = 'Relecture visuelle';
		this.status.command = 'orbit.visual.show';
		this.disposables.push(
			this.status,
			vscode.commands.registerCommand('orbit.visual.show', () => this.show()),
			vscode.commands.registerCommand('orbit.visual.now', () => this.now()),
			tracker.onDidUseTool(event => {
				const file = (event.input as { file_path?: unknown } | undefined)?.file_path;
				if (event.phase === 'end' && WRITE_TOOLS.has(event.tool) && typeof file === 'string' && INTERFACE_FILE.test(file)) {
					this.touched.add(event.key);
				}
			}),
			tracker.onDidChange(state => {
				if (this.mode() === 'off') {
					return;
				}
				if (state.status === 'running' && state.prompt !== undefined) {
					if (state.prompt.startsWith(MARK)) {
						this.proofreading.add(state.key);
					} else if (!this.touched.has(state.key)) {
						this.proofreading.delete(state.key);
						// A turn begins: the page as it is now is the « before » of whatever comes.
						this.remember();
					}
				}
				if (state.status === 'done' && this.touched.delete(state.key)) {
					if (this.proofreading.delete(state.key)) {
						// The fix that followed a proofreading: the picture is refreshed, the agent is left alone.
						this.finish(state.key, false);
					} else {
						this.finish(state.key, this.mode() === 'auto');
					}
				}
			}),
		);
	}

	private mode(): 'auto' | 'notify' | 'off' {
		return vscode.workspace.getConfiguration('orbit').get<'auto' | 'notify' | 'off'>('visualCheck.mode', 'auto');
	}

	private folder(url: string): string {
		const folder = path.join(os.homedir(), '.orbit', 'visual', createHash('sha1').update(url).digest('hex').slice(0, 12));
		fs.mkdirSync(folder, { recursive: true });
		return folder;
	}

	private async url(): Promise<string | undefined> {
		const fixed = vscode.workspace.getConfiguration('orbit').get<string>('visualCheck.url', '').trim();
		if (/^https?:\/\//.test(fixed)) {
			return fixed;
		}
		try {
			return (await detectServers())[0]?.origin;
		} catch {
			return undefined;
		}
	}

	/** Keeps a picture of the running page, unless the last one is still true (nothing changed since). */
	private async remember(): Promise<void> {
		if (this.shooting) {
			return;
		}
		const url = await this.url();
		if (!url) {
			return;
		}
		if (this.pair?.url === url && this.pair.after && fs.existsSync(this.pair.after)) {
			// What the page looked like after the last change is what it looks like before the next.
			const before = path.join(this.folder(url), 'avant.png');
			fs.copyFileSync(this.pair.after, before);
			this.pair = { url, before, at: Date.now() };
			return;
		}
		if (this.pair?.url === url && this.pair.before && !this.pair.after) {
			return;
		}
		this.shooting = true;
		const before = path.join(this.folder(url), 'avant.png');
		const taken = await screenshot(url, before);
		this.shooting = false;
		this.pair = taken ? { url, before, at: Date.now() } : undefined;
	}

	private async finish(key: string, tell: boolean): Promise<void> {
		const url = this.pair?.url ?? await this.url();
		if (!url) {
			return;
		}
		const terminal = this.claude.byKey(key);
		this.status.text = '$(eye) Capture…';
		this.status.show();
		// Give the dev server the time to rebuild and the page the time to reload.
		await new Promise(resolve => setTimeout(resolve, 1800));
		const after = path.join(this.folder(url), 'apres.png');
		this.shooting = true;
		const taken = await screenshot(url, after);
		this.shooting = false;
		if (!taken) {
			this.status.hide();
			return;
		}
		this.pair = { url, before: this.pair?.url === url ? this.pair.before : undefined, after, at: Date.now(), agent: terminal?.name, key };
		this.status.text = '$(eye) Avant / après';
		this.status.tooltip = `L'interface a changé : voir la page avant et après (${url})`;
		this.send();
		if (tell && terminal) {
			this.tell(terminal);
		} else if (!tell && this.mode() === 'notify') {
			vscode.window.showInformationMessage(`${terminal?.name ?? 'L\'agent'} a modifié l'interface.`, 'Voir avant / après', 'Faire relire').then(choice => {
				if (choice === 'Faire relire' && terminal) {
					this.tell(terminal);
				} else if (choice) {
					this.show();
				}
			});
		}
	}

	private tell(terminal: vscode.Terminal): void {
		const pair = this.pair;
		if (!pair?.after) {
			return;
		}
		this.claude.sendMessage(terminal, [
			`${MARK} Tu viens de modifier l'interface. Voici la page ${pair.url} telle qu'elle s'affiche vraiment :`,
			pair.before ? `- avant tes changements : ${pair.before}` : '',
			`- après tes changements : ${pair.after}`,
			'Ouvre ces images et regarde-les. Compare avec ce qui était demandé : mise en page, alignements, débordements, textes coupés, contrastes, éléments manquants ou cassés. Corrige ce qui ne va pas. Si tout est bon, dis-le en une phrase, sans rien modifier.',
		].filter(Boolean).join('\n'));
	}

	/** On demand: a fresh pair for the page as it is, sent to the agent the user is looking at. */
	private async now(): Promise<void> {
		const url = await this.url();
		if (!url) {
			vscode.window.showInformationMessage('Aucune page locale en cours : lance le serveur de développement du projet (ou indique son adresse dans le réglage « orbit.visualCheck.url »).');
			return;
		}
		const terminal = this.claude.current();
		await this.finish(terminal ? this.claude.keyOf(terminal) ?? '' : '', false);
		this.show();
	}

	private data(file: string | undefined): string | undefined {
		try {
			return file && fs.existsSync(file) ? `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` : undefined;
		} catch {
			return undefined;
		}
	}

	protected send(): void {
		this.post({
			type: 'state',
			mode: this.mode(),
			pair: this.pair && { url: this.pair.url, at: this.pair.at, agent: this.pair.agent, before: this.data(this.pair.before), after: this.data(this.pair.after) },
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'mode':
				if (['auto', 'notify', 'off'].includes(msg.mode)) {
					await vscode.workspace.getConfiguration('orbit').update('visualCheck.mode', msg.mode, vscode.ConfigurationTarget.Global);
					this.send();
				}
				break;
			case 'now':
				await this.now();
				break;
			case 'tell': {
				const terminal = (this.pair?.key ? this.claude.byKey(this.pair.key) : undefined) ?? this.claude.current();
				if (terminal) {
					this.tell(terminal);
					terminal.show(true);
				} else {
					vscode.window.showInformationMessage('Aucun agent ouvert à qui montrer les captures.');
				}
				break;
			}
			case 'open':
				if (this.pair) {
					await vscode.commands.executeCommand('orbit.preview.show');
				}
				break;
		}
	}
}
