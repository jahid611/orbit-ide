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

interface CodexBlock { type?: string; text?: string }

/**
 * Orbit reads conversations in the shape Claude Code writes them (`user` and `assistant` entries
 * holding text, `tool_use` and `tool_result` blocks). A line of a Codex session log is given that
 * shape here, so that the discussion view, the list of discussions and the counters read ChatGPT's
 * conversations with the code that reads Claude's. Anything else comes back as it is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function claudeShaped(entry: any): any {
	const payload = entry?.payload;
	if (entry?.type !== 'response_item' || !payload) {
		return entry;
	}
	const uuid = String(payload.id ?? payload.call_id ?? entry.ordinal ?? entry.timestamp ?? '');
	if (payload.type === 'message') {
		const text = (Array.isArray(payload.content) ? payload.content as CodexBlock[] : []).filter(b => b.type === 'input_text' || b.type === 'output_text' || b.type === 'text').map(b => b.text ?? '').join('\n').trim();
		if (payload.role === 'assistant') {
			return { type: 'assistant', uuid, message: { content: [{ type: 'text', text }] } };
		}
		// What Codex is told (its instructions, the state of the machine) is not something the user said.
		if (payload.role !== 'user' || !text || text.startsWith('<') || text.startsWith('[orbit-terminal:') || text.startsWith('The following is the Codex agent history')) {
			return { type: 'other' };
		}
		return { type: 'user', uuid, message: { content: text } };
	}
	if (payload.type === 'custom_tool_call' || payload.type === 'function_call' || payload.type === 'local_shell_call') {
		let input: unknown = payload.input ?? payload.arguments ?? payload.action;
		if (typeof input === 'string') {
			try {
				input = JSON.parse(input);
			} catch {
				// a patch, or a command given as text
				input = payload.name === 'apply_patch' ? { patch: input } : { command: input };
			}
		}
		const name = payload.name === 'apply_patch' ? 'Edit' : /shell|exec|command/i.test(String(payload.name ?? payload.type)) ? 'Bash' : String(payload.name ?? 'Outil');
		return { type: 'assistant', uuid, message: { content: [{ type: 'tool_use', id: String(payload.call_id ?? uuid), name, input }] } };
	}
	if (payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output' || payload.type === 'local_shell_call_output') {
		const output = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '');
		return { type: 'user', uuid, message: { content: [{ type: 'tool_result', tool_use_id: String(payload.call_id ?? ''), content: output }] } };
	}
	return { type: 'other' };
}

export function lastAgentAnswer(transcript: string | undefined): string | undefined {
	return agentAnswers(transcript).pop();
}
