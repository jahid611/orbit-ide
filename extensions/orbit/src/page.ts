/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PageId, renderWebview, webviewOptions } from './webview';

/**
 * A page of Orbit shown in the editor area: one panel, opened once and brought back afterwards.
 * The page script says `ready` when it has loaded and is then sent the state to draw.
 */
export abstract class Page implements vscode.Disposable {

	protected panel: vscode.WebviewPanel | undefined;
	protected readonly disposables: vscode.Disposable[] = [];

	/**
	 * `page` names the kind of panel (what the window remembers it by). It is usually also the
	 * name of the page's script and style; several panels drawn by the same script give it as `drawnBy`.
	 */
	constructor(protected readonly context: vscode.ExtensionContext, private readonly page: string, private readonly title: string, private readonly image?: string, private readonly drawnBy?: PageId) {
		// A page open when the window is reloaded, or when Orbit is closed, is there again afterwards.
		this.disposables.push(vscode.window.registerWebviewPanelSerializer(`orbit.${page}`, {
			deserializeWebviewPanel: async panel => this.panel ? panel.dispose() : this.attach(panel),
		}));
	}

	show(): void {
		if (this.panel) {
			this.panel.reveal();
			this.refresh();
			return;
		}
		// A tab the window brought back after a reload has no panel behind it until it is shown:
		// it is replaced by the page opened now, not doubled.
		const stale = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(`orbit.${this.page}`));
		if (stale.length) {
			vscode.window.tabGroups.close(stale, true).then(undefined, () => undefined);
		}
		this.attach(vscode.window.createWebviewPanel(`orbit.${this.page}`, this.title, vscode.ViewColumn.Active, { ...webviewOptions(this.context.extensionUri), retainContextWhenHidden: true }));
	}

	/** Takes a panel as the page: one just created, or one the window brought back after a reload. */
	private attach(panel: vscode.WebviewPanel): void {
		this.panel = panel;
		panel.webview.options = webviewOptions(this.context.extensionUri);
		if (this.image) {
			this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', this.image);
		}
		this.panel.webview.html = renderWebview(this.panel.webview, this.context.extensionUri, this.drawnBy ?? this.page as PageId);
		const listener = this.panel.webview.onDidReceiveMessage(msg => Promise.resolve(msg?.type === 'ready' ? this.refresh() : this.onMessage(msg)).catch(err => {
			vscode.window.showErrorMessage(`${this.title} : ${err instanceof Error ? err.message : String(err)}`);
			this.send();
		}));
		this.panel.onDidChangeViewState(e => {
			this.viewChanged(e.webviewPanel.visible);
			if (e.webviewPanel.visible) {
				this.refresh();
			}
		});
		this.panel.onDidDispose(() => {
			listener.dispose();
			this.panel = undefined;
			this.closed();
		});
	}

	/** The page went behind another tab, or came back in front. */
	protected viewChanged(_visible: boolean): void { }

	/** The user closed the page. */
	protected closed(): void { }

	get visible(): boolean {
		return !!this.panel?.visible;
	}

	protected post(message: unknown): void {
		this.panel?.webview.postMessage(message);
	}

	/** Sends the page what it draws. */
	protected abstract send(): void;

	/** Looks at the world again, then sends. By default there is nothing to look at. */
	protected refresh(): void | Promise<void> {
		this.send();
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected abstract onMessage(msg: any): Promise<void>;

	dispose(): void {
		// The panel is left alone: closed here, when Orbit quits, it would not be saved with the window.
		this.disposables.forEach(d => d.dispose());
	}
}

/** A request to a web API that answers in JSON. Never rejects: a failure comes back as a message. */
export async function requestJson(method: string, url: string, headers: Record<string, string>, body?: string): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
	try {
		const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30000) });
		const text = await response.text();
		let json: unknown;
		try {
			json = text ? JSON.parse(text) : undefined;
		} catch {
			json = undefined;
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const said = json as any;
		const error = response.ok ? undefined : String(said?.error?.message ?? said?.message ?? said?.error ?? text.slice(0, 200) ?? response.statusText);
		return { ok: response.ok, status: response.status, json, error };
	} catch (err) {
		return { ok: false, status: 0, json: undefined, error: err instanceof Error ? err.message : String(err) };
	}
}
