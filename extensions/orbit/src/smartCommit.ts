/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readConfig } from './config';
import { runClaude, stripFences } from './inlineEdit';

const execFileAsync = promisify(execFile);

/** The part of the built-in git extension's API this feature needs. */
interface GitRepository {
	readonly rootUri: vscode.Uri;
	readonly inputBox: { value: string };
}

interface GitApi {
	readonly repositories: GitRepository[];
	getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
	getAPI(version: 1): GitApi;
}

interface Changes {
	staged: boolean;
	stat: string;
	diff: string;
	untracked: string[];
}

const MAX_DIFF_CHARS = 60000;
const MAX_UNTRACKED = 200;
const HISTORY_LENGTH = 15;

const SYSTEM_PROMPT = `You write git commit messages inside an IDE. You receive the recent commit subjects of the repository and the changes about to be committed. Reply with ONLY the commit message: no explanations, no Markdown fences, no surrounding quotes.

Rules:
- Imitate the repository's recent commits: same language, same prefix convention (feat:, fix:, scope…) if they use one, same capitalization, similar length.
- First line: a summary of what the change does and why, at most about 72 characters. Add a body (blank line, then a few short lines) only when the change needs it.
- Describe the actual changes; never invent anything the diff does not show.
- ABSOLUTE RULE: the message never says or hints that an AI, an assistant or Claude wrote it. No "Co-Authored-By" line, no "Generated with" line, no signature, no emoji trailer.`;

/** Lines that credit a tool or a co-author for the commit: never kept, whatever the model wrote. */
const ATTRIBUTION = [
	/^\s*co-authored-by\s*:/i,
	/generated\s+(with|by)\b/i,
	/\u{1F916}/u,
	/noreply@anthropic\.com/i,
	/\b(written|authored|created|drafted|assisted|rédigée?s?|générée?s?|écrite?s?|créée?s?|assistée?s?)\s+(by|with|par|avec)\s+(an?\s+|une?\s+|l['’])?(claude|anthropic|ai|ia|llm|chatgpt|copilot)\b/i,
];

/** Command `orbit.git.smartCommit`: Claude drafts the commit message into the Source Control input box. */
export function registerSmartCommit(): vscode.Disposable {
	// The Source Control title button passes its SourceControl, whose rootUri names the repository.
	return vscode.commands.registerCommand('orbit.git.smartCommit', (target?: { rootUri?: vscode.Uri }) => smartCommit(target?.rootUri));
}

/** Repositories with a generation in flight: a second click must not start a second Claude. */
const drafting = new Set<string>();

async function smartCommit(hint?: vscode.Uri): Promise<void> {
	let repository: GitRepository | undefined;
	try {
		repository = await findRepository(hint);
	} catch (err) {
		vscode.window.showErrorMessage(`Orbit : Git est indisponible (${errorText(err)}).`);
		return;
	}
	if (!repository) {
		vscode.window.showWarningMessage('Orbit : aucun dépôt Git dans le dossier ouvert.');
		return;
	}

	let previous: string | undefined;
	for (; ;) {
		const message = await draft(repository, previous);
		if (!message) {
			return;
		}
		repository.inputBox.value = message;
		await vscode.commands.executeCommand('workbench.view.scm');
		const choice = await vscode.window.showInformationMessage('Message de commit rédigé : relis-le avant de valider.', 'Régénérer');
		if (choice !== 'Régénérer') {
			return;
		}
		previous = message;
	}
}

/** One generation, with its progress and its error messages. Returns nothing when there is no message to show. */
async function draft(repository: GitRepository, previous: string | undefined): Promise<string | undefined> {
	const root = repository.rootUri.fsPath;
	if (drafting.has(root)) {
		return undefined;
	}
	drafting.add(root);
	try {
		return await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, title: 'Claude rédige le message de commit…' }, async () => {
			const changes = await readChanges(root);
			if (!changes) {
				vscode.window.showInformationMessage('Orbit : rien à valider, aucun changement dans ce dépôt.');
				return undefined;
			}
			const history = await readHistory(root);
			const message = cleanMessage(await runClaude(buildPrompt(changes, history, previous), SYSTEM_PROMPT, root));
			if (!message) {
				vscode.window.showWarningMessage('Orbit : Claude n\'a renvoyé aucun message de commit.');
			}
			return message || undefined;
		});
	} catch (err) {
		vscode.window.showErrorMessage(`Orbit : ${errorText(err)}`);
		return undefined;
	} finally {
		drafting.delete(root);
	}
}

/** The repository of the given resource or of the active file, otherwise the first one. */
async function findRepository(hint?: vscode.Uri): Promise<GitRepository | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension) {
		return undefined;
	}
	const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);
	for (const uri of [hint, vscode.window.activeTextEditor?.document.uri]) {
		const found = uri && api.getRepository(uri);
		if (found) {
			return found;
		}
	}
	return api.repositories[0];
}

/** Staged changes, or every change of the working tree when nothing is staged. */
async function readChanges(root: string): Promise<Changes | undefined> {
	const staged = (await git(root, ['diff', '--staged', '--name-only'])).trim().length > 0;
	const scope = staged ? ['--staged'] : [];
	const [stat, diff, others] = await Promise.all([
		git(root, ['diff', ...scope, '--stat=160,120', '--stat-graph-width=20']),
		git(root, ['diff', ...scope, '--no-color', '--no-ext-diff']),
		staged ? '' : git(root, ['ls-files', '--others', '--exclude-standard']),
	]);
	const untracked = others.split('\n').map(line => line.trim()).filter(Boolean);
	if (!diff.trim() && !untracked.length) {
		return undefined;
	}
	return { staged, stat: stat.trimEnd(), diff: truncate(diff), untracked };
}

/** Subjects of the last commits; empty in a repository without any commit. */
async function readHistory(root: string): Promise<string[]> {
	try {
		return (await git(root, ['log', `-${HISTORY_LENGTH}`, '--pretty=%s'])).split('\n').map(line => line.trim()).filter(Boolean);
	} catch {
		return [];
	}
}

async function git(root: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
		return stdout;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error('Git introuvable : installe-le pour rédiger un message de commit.');
		}
		throw err;
	}
}

/** Keeps the start of a long diff, cut at a line boundary; the stat above it stays complete. */
function truncate(diff: string): string {
	if (diff.length <= MAX_DIFF_CHARS) {
		return diff.trimEnd();
	}
	const cut = diff.lastIndexOf('\n', MAX_DIFF_CHARS);
	const kept = diff.slice(0, cut > 0 ? cut : MAX_DIFF_CHARS);
	return `${kept}\n[diff truncated: ${diff.length - kept.length} more characters, see the summary above for the other files]`;
}

function buildPrompt(changes: Changes, history: string[], previous: string | undefined): string {
	const language = readConfig().language;
	const untracked = changes.untracked.slice(0, MAX_UNTRACKED);
	if (changes.untracked.length > untracked.length) {
		untracked.push(`… and ${changes.untracked.length - untracked.length} more`);
	}
	return [
		history.length
			? `<recent_commits>\n${history.join('\n')}\n</recent_commits>`
			: `This repository has no commit yet: write a short, plain message${language ? ` in ${language}` : ''}.`,
		changes.staged ? 'The changes below are staged: they are exactly what will be committed.' : 'Nothing is staged: the changes below are everything in the working tree.',
		changes.stat ? `<summary>\n${changes.stat}\n</summary>` : '',
		untracked.length ? `<new_untracked_files>\n${untracked.join('\n')}\n</new_untracked_files>` : '',
		changes.diff ? `<diff>\n${changes.diff}\n</diff>` : '',
		previous ? `<previous_proposal>\n${previous}\n</previous_proposal>\nThe user asked for another proposal: write a noticeably different message for the same changes.` : '',
		'Write the commit message.',
	].filter(Boolean).join('\n\n');
}

/** The message alone: no fences, no quotes, and no line crediting an AI or a co-author. */
function cleanMessage(text: string): string {
	// Quotes come off first: a dropped last line would otherwise leave the opening one behind.
	return unquote(stripFences(text)).split(/\r?\n/)
		.map(line => line.trimEnd())
		.filter(line => !ATTRIBUTION.some(pattern => pattern.test(line)))
		.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function unquote(text: string): string {
	const quoted = text.trim().match(/^(?<quote>["'`])(?<inner>[\s\S]*)\k<quote>$/);
	return quoted?.groups?.inner ?? text;
}

function errorText(err: unknown): string {
	if (typeof err === 'string') {
		return err;
	}
	const text = err instanceof Error ? err.message : String(err);
	return text.split('\n')[0];
}
