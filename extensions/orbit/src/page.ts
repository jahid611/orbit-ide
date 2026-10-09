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

	constructor(protected readonly context: vscode.ExtensionContext, private readonly page: PageId, private readonly title: string, private readonly image?: string) { }

	show(): void {
		if (this.panel) {
			this.panel.reveal();
			this.refresh();
			return;
		}
		this.panel = vscode.window.createWebviewPanel(`orbit.${this.page}`, this.title, vscode.ViewColumn.Active, { ...webviewOptions(this.context.extensionUri), retainContextWhenHidden: true });
		if (this.image) {
			this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', this.image);
		}
		this.panel.webview.html = renderWebview(this.panel.webview, this.context.extensionUri, this.page);
		const listener = this.panel.webview.onDidReceiveMessage(msg => Promise.resolve(msg?.type === 'ready' ? this.refresh() : this.onMessage(msg)).catch(err => {
			vscode.window.showErrorMessage(`${this.title} : ${err instanceof Error ? err.message : String(err)}`);
			this.send();
		}));
		this.panel.onDidChangeViewState(e => e.webviewPanel.visible && this.refresh());
		this.panel.onDidDispose(() => {
			listener.dispose();
			this.panel = undefined;
		});
	}

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
		this.panel?.dispose();
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
