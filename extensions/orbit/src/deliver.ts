/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';

/**
 * Hands a message to the agent, from a page of the IDE. The text is only ever typed into a
 * terminal where the agent is known to be running: a terminal whose agent has quit is a bare
 * shell, which would try to run every line. When no agent is live, a new one starts with the
 * message as its first prompt.
 * Returns the terminal that received it, or undefined when the agent is waiting for an answer.
 */
export function deliverToAgent(claude: ClaudeTerminals, tracker: AgentTracker, message: string): vscode.Terminal | undefined {
	const terminal = claude.current();
	const state = terminal && tracker.get(claude.keyOf(terminal));
	if (!terminal || !state || state.ended) {
		return claude.create({ flags: [message] });
	}
	if (state.status === 'waiting') {
		vscode.window.showWarningMessage(`${terminal.name} attend une autorisation : réponds-lui d'abord.`);
		return undefined;
	}
	claude.sendMessage(terminal, message);
	terminal.show(true);
	return terminal;
}
