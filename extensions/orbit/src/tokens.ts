/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';

export interface SessionUsage {
	/** Tokens Claude wrote. */
	output: number;
	/** Tokens read fresh (not from the cache). */
	input: number;
	cacheRead: number;
	cacheWrite: number;
	/** Size of the conversation at the last answer: what the context window holds. */
	context: number;
	/** Answers counted. */
	messages: number;
}

/** What is known of a transcript: the count so far, and how far the file has been read. */
const cache = new Map<string, { size: number; read: number; usage: SessionUsage; seen: Set<string> }>();
const PIECE = 4 * 1024 * 1024;

/**
 * What a session has consumed so far, read from its transcript. Only what was added since the last
 * call is read: a long session is tens of megabytes, written to several times a second while the
 * agent works, and reading it whole each time kept a processor core busy for as long as it ran.
 */
export function sessionUsage(transcript: string | undefined): SessionUsage | undefined {
	if (!transcript) {
		return undefined;
	}
	let size: number;
	try {
		size = fs.statSync(transcript).size;
	} catch {
		return undefined;
	}
	let known = cache.get(transcript);
	if (known?.size === size) {
		return known.usage;
	}
	if (!known || size < known.read) {
		// First look, or the file was rewritten (a compacted session): count again from the start.
		known = { size: 0, read: 0, usage: { output: 0, input: 0, cacheRead: 0, cacheWrite: 0, context: 0, messages: 0 }, seen: new Set() };
	}
	const { usage, seen } = known;
	const count = (line: string) => {
		if (!line.includes('"usage"')) {
			return;
		}
		try {
			const entry = JSON.parse(line) as { type?: string; isSidechain?: boolean; message?: { id?: string; usage?: Record<string, number> } };
			const u = entry.message?.usage;
			if (entry.type !== 'assistant' || !u) {
				return;
			}
			// One answer is written several times (streaming, tool calls): count each message id once.
			const id = entry.message?.id ?? `${seen.size}`;
			if (seen.has(id)) {
				return;
			}
			seen.add(id);
			usage.output += u.output_tokens ?? 0;
			usage.input += u.input_tokens ?? 0;
			usage.cacheRead += u.cache_read_input_tokens ?? 0;
			usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
			usage.messages++;
			if (!entry.isSidechain) {
				usage.context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
			}
		} catch {
			// not a line of the transcript
		}
	};
	try {
		const fd = fs.openSync(transcript, 'r');
		try {
			const buffer = Buffer.alloc(PIECE);
			let rest = Buffer.alloc(0);
			let position = known.read;
			while (position < size) {
				const got = fs.readSync(fd, buffer, 0, Math.min(PIECE, size - position), position);
				if (got <= 0) {
					break;
				}
				position += got;
				let data = rest.length ? Buffer.concat([rest, buffer.subarray(0, got)]) : buffer.subarray(0, got);
				// Whole lines only: the last one may still be being written, it is read next time.
				const last = data.lastIndexOf(10);
				if (last < 0) {
					rest = Buffer.from(data);
					continue;
				}
				rest = Buffer.from(data.subarray(last + 1));
				data = data.subarray(0, last);
				for (const line of data.toString('utf8').split('\n')) {
					count(line);
				}
			}
			known.read = position - rest.length;
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return undefined;
	}
	known.size = size;
	cache.set(transcript, known);
	return usage;
}

/** 1 234 → « 1,2 k », 1 234 567 → « 1,2 M ». */
export function compact(n: number): string {
	if (n >= 1e6) {
		return `${(n / 1e6).toFixed(1).replace('.', ',')} M`;
	}
	if (n >= 1000) {
		return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace('.', ',')} k`;
	}
	return String(n);
}
