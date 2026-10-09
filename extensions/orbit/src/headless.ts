/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { claudeEnv, readConfig, resolveClaudeExecutable } from './config';

/**
 * One question to ChatGPT without a terminal, for Orbit's background helpers (inline edit,
 * commit message, task splitting, SQL): `codex exec`, read-only, nothing kept afterwards.
 * The request goes through standard input (a diff does not fit on a command line) and the
 * answer comes back in a file, clean of Codex's progress output. Rejects with a message for the user.
 */
export function runCodex(prompt: string, system: string, cwd: string, signal?: { onCancel(listener: () => void): void }): Promise<string> {
	return new Promise((resolve, reject) => {
		const answer = path.join(os.tmpdir(), `orbit-codex-${randomBytes(6).toString('hex')}.txt`);
		const model = readConfig().model;
		const args = ['exec', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', ...(model ? ['-m', model] : []), '-o', answer, '-'];
		const program = resolveClaudeExecutable();
		// The npm install puts a .cmd shim on the PATH on Windows: it only runs through a shell.
		const viaShell = process.platform === 'win32' && !/\.exe$/i.test(program);
		const proc = viaShell
			? spawn([program, ...args].map(a => /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a).join(' '), { cwd, env: claudeEnv(), windowsHide: true, shell: true })
			: spawn(program, args, { cwd, env: claudeEnv(), windowsHide: true });
		let err = '';
		proc.stderr.on('data', d => err += d);
		proc.stdout.resume();
		signal?.onCancel(() => proc.kill());
		proc.on('error', e => reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'Codex introuvable : installe-le (npm install -g @openai/codex) ou règle orbit.chatgpt.path.' : e));
		proc.on('close', code => {
			let text = '';
			try {
				text = fs.readFileSync(answer, 'utf8');
				fs.rmSync(answer, { force: true });
			} catch {
				// no answer written
			}
			if (text.trim()) {
				resolve(text);
			} else {
				reject(`ChatGPT n'a pas répondu (code ${code}) ${err.slice(-400)}`);
			}
		});
		proc.stdin.end(`${system}\n\n---\n\n${prompt}`);
	});
}
