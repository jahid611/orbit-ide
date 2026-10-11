/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { claudeShell, claudeTerminalEnv, readConfig, resolveClaudeExecutable, shellQuote } from './config';

/**
 * Signs in to a connector in a terminal of Orbit. The assistant's `mcp login` refuses to work
 * without one ("stdin isn't a terminal"): it opens the service's page in the browser, and
 * when the browser cannot hand the answer back by itself, asks for the address of the page
 * reached to be pasted. Run in the background, it failed within two seconds for every service.
 */
export function signInTerminal(name: string, label: string): vscode.Terminal {
	const windows = process.platform === 'win32';
	const program = shellQuote(windows ? resolveClaudeExecutable() : readConfig().claudePath);
	const terminal = vscode.window.createTerminal({ name: `Connexion · ${label}`, ...claudeShell(), env: claudeTerminalEnv(), iconPath: new vscode.ThemeIcon('plug') });
	terminal.show();
	// PowerShell only runs a quoted program through the call operator.
	terminal.sendText(`${windows ? '& ' : ''}${program} mcp login ${shellQuote(name)}`);
	return terminal;
}

/**
 * Waits for the user to finish in the browser: checks every few seconds, five minutes at most,
 * and stops as soon as the terminal is closed. The terminal is put away once signed in.
 */
export async function waitSignedIn(terminal: vscode.Terminal, signedIn: () => Promise<boolean>): Promise<boolean> {
	const until = Date.now() + 5 * 60 * 1000;
	while (Date.now() < until && terminal.exitStatus === undefined) {
		await new Promise(resolve => setTimeout(resolve, 4000));
		if (await signedIn()) {
			terminal.dispose();
			return true;
		}
	}
	return false;
}
