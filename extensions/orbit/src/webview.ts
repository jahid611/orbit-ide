/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';

export function renderWebview(webview: vscode.Webview, extensionUri: vscode.Uri, page: 'studio'): string {
	const nonce = randomBytes(16).toString('base64');
	const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));
	return `<!DOCTYPE html>
<html lang="fr">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${media('base.css')}" rel="stylesheet">
	<link href="${media(`${page}.css`)}" rel="stylesheet">
</head>
<body class="page-${page}">
	<div id="app"></div>
	<script nonce="${nonce}" src="${media('markdown.js')}"></script>
	<script nonce="${nonce}" src="${media(`${page}.js`)}"></script>
</body>
</html>`;
}

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
	return {
		enableScripts: true,
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
	};
}
