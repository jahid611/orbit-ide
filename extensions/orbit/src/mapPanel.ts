/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { AgentActivity } from './agentActivity';
import { ClaudeTerminals } from './claudeTerminals';
import { workspaceRoot } from './config';
import { renderWebview, webviewOptions } from './webview';

const COMMANDS = ['orbit.claude.new', 'orbit.claude.grid', 'orbit.claude.broadcast', 'orbit.conductor.start', 'orbit.conductor.merge'];

/**
 * The Orbit view: the project at the centre, every agent a planet circling it, the files
 * each one reads and writes as its moons, and collisions drawn between the agents involved.
 */
export class MapPanel implements vscode.Disposable {

	private panel: vscode.WebviewPanel | undefined;
	private timer: NodeJS.Timeout | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly extensionUri: vscode.Uri, private readonly activity: AgentActivity, private readonly claude: ClaudeTerminals) {
		this.disposables.push(activity.onDidChange(() => this.sendSoon()));
	}

	show(): void {
		if (this.panel) {
			this.panel.reveal();
			return;
		}
		this.panel = vscode.window.createWebviewPanel('orbit.map', 'Orbite', vscode.ViewColumn.Active, { ...webviewOptions(this.extensionUri), retainContextWhenHidden: true });
		this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'orbit.svg');
		this.panel.webview.html = renderWebview(this.panel.webview, this.extensionUri, 'map');
		// Listeners of this panel only, freed with it so reopening does not pile them up.
		const listener = this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
		this.panel.onDidDispose(() => {
			listener.dispose();
			this.panel = undefined;
		});
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	private onMessage(msg: { type?: string; key?: string; file?: string; id?: string }): void {
		switch (msg.type) {
			case 'ready':
				this.send();
				break;
			case 'focus':
				if (msg.key) {
					this.claude.byKey(msg.key)?.show();
				}
				break;
			case 'open':
				if (msg.file) {
					vscode.window.showTextDocument(vscode.Uri.file(msg.file), { preview: true, viewColumn: vscode.ViewColumn.Beside }).then(undefined, () => undefined);
				}
				break;
			case 'command':
				if (msg.id && COMMANDS.includes(msg.id)) {
					vscode.commands.executeCommand(msg.id);
				}
				break;
		}
	}

	/** Hooks fire in bursts; the map only needs the settled state. */
	private sendSoon(): void {
		if (!this.panel || this.timer) {
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.send();
		}, 150);
	}

	private send(): void {
		const webview = this.panel?.webview;
		// Planet artwork (generated with Higgsfield) lives in media/planets, one image per agent colour.
		const art = webview?.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'planets')).toString();
		webview?.postMessage({ type: 'state', project: path.basename(workspaceRoot()), now: Date.now(), art, ...this.activity.snapshot() });
	}
}
