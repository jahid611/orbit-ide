/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { assistant } from './assistant';

/** Extra origins a page may reach, e.g. a local relay. Each is merged into its directive, never repeated. */
export interface WebviewSources {
	img?: string;
	frame?: string;
	connect?: string;
}

/** The pages of Orbit: each is `media/<id>.js` and `media/<id>.css`. */
export type PageId = 'studio' | 'chat' | 'map' | 'preview' | 'database' | 'unity' | 'community' | 'higgsfield' | 'queue' | 'phone' | 'vercel' | 'env' | 'board' | 'visual' | 'store' | 'figma' | 'supabase' | 'stripe';

export function renderWebview(webview: vscode.Webview, extensionUri: vscode.Uri, page: PageId, sources: WebviewSources = {}): string {
	const nonce = randomBytes(16).toString('base64');
	const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));
	// A repeated directive is ignored by the browser, so extra sources must join the existing one.
	const csp = [
		`default-src 'none'`,
		`img-src ${webview.cspSource} data: https:${sources.img ? ` ${sources.img}` : ''}`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`font-src ${webview.cspSource}`,
		`script-src 'nonce-${nonce}'`,
		sources.frame ? `frame-src ${sources.frame}` : '',
		sources.connect ? `connect-src ${sources.connect}` : '',
	].filter(Boolean).join('; ');
	return `<!DOCTYPE html>
<html lang="fr">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${media('base.css')}" rel="stylesheet">
	<link href="${media(`${page}.css`)}" rel="stylesheet">
</head>
<body class="page-${page}">
	<div id="app"></div>
	<script nonce="${nonce}">window.OrbitAssistant = ${JSON.stringify({ id: assistant().id, name: assistant().name, product: assistant().product, image: media(assistant().image).toString() })};</script>
	<script nonce="${nonce}" src="${media('assistant.js')}"></script>
	<script nonce="${nonce}" src="${media('icons.js')}"></script>
	<script nonce="${nonce}" src="${media('select.js')}"></script>
	<script nonce="${nonce}" src="${media('markdown.js')}"></script>
${page === 'phone' ? `	<script nonce="${nonce}" src="${media('qrcode.js')}"></script>\n` : ''}	<script nonce="${nonce}" src="${media(`${page}.js`)}"></script>
</body>
</html>`;
}

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
	return {
		enableScripts: true,
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
	};
}
