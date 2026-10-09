/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';

/**
 * What the agent wrote to the user in a conversation log, oldest first. Reads both formats:
 * Claude Code's transcripts and Codex's session logs, told apart line by line.
 */
export function agentAnswers(transcript: string | undefined): string[] {
	if (!transcript) {
		return [];
	}
	const answers: string[] = [];
	let text: string;
	try {
		text = fs.readFileSync(transcript, 'utf8');
	} catch {
		return [];
	}
	for (const line of text.split('\n')) {
		if (!line.includes('"assistant"') && !line.includes('"agent_message"') && !line.includes('"task_complete"')) {
			continue;
		}
		try {
			const entry = JSON.parse(line);
			let answer: string | undefined;
			if (entry.type === 'assistant' && !entry.isSidechain) {
				// Claude Code
				answer = (entry.message?.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n');
			} else if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role === 'assistant') {
				// Codex
				answer = (entry.payload.content ?? []).filter((b: { type: string }) => b.type === 'output_text' || b.type === 'text').map((b: { text: string }) => b.text).join('\n');
			} else if (entry.type === 'event_msg' && entry.payload?.type === 'task_complete' && typeof entry.payload.last_agent_message === 'string') {
				// Codex repeats its closing message when a turn ends: keep it only if it was not seen as a message.
				answer = answers[answers.length - 1] === entry.payload.last_agent_message.trim() ? undefined : entry.payload.last_agent_message;
			}
			if (answer?.trim()) {
				answers.push(answer.trim());
			}
		} catch {
			// partial line
		}
	}
	return answers;
}

export function lastAgentAnswer(transcript: string | undefined): string | undefined {
	return agentAnswers(transcript).pop();
}
