/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';

/**
 * Hands a message to the agent, from a page of the IDE. It goes to the agent the user is working
 * with: the terminal in front, else the last one used, else any other whose agent still runs
 * (the team lead included). A new agent only starts when there is none to give it to.
 *
 * The text is never typed into a terminal whose agent has quit: that is a bare shell, which
 * would try to run every line. Such a terminal is known by the end of its session (a hook, or
 * the check made when terminals come back with the window). An agent that has not said anything
 * yet (just opened, still waiting for its first message) is alive: it used to be taken for
 * missing, and a second agent opened beside it.
 * Returns the terminal that received it, or undefined when the agent is waiting for an answer.
 */
export function deliverToAgent(claude: ClaudeTerminals, tracker: AgentTracker, message: string): vscode.Terminal | undefined {
	const alive = (terminal: vscode.Terminal) => !tracker.get(claude.keyOf(terminal))?.ended;
	const preferred = claude.current();
	const terminal = [...(preferred ? [preferred] : []), ...claude.list().reverse()].find(alive);
	if (!terminal) {
		return claude.create({ flags: [message] });
	}
	if (tracker.get(claude.keyOf(terminal))?.status === 'waiting') {
		vscode.window.showWarningMessage(`${terminal.name} attend une autorisation : réponds-lui d'abord.`);
		return undefined;
	}
	claude.sendMessage(terminal, message);
	terminal.show(true);
	return terminal;
}
