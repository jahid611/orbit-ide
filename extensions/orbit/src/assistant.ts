/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export type AssistantId = 'claude' | 'chatgpt';

export interface AssistantModel {
	id: string;
	label: string;
}

export interface AssistantMode {
	id: string;
	label: string;
	hint: string;
}

/**
 * The AI Orbit is built around, for this user: one at a time, never mixed. Everything that
 * names, draws or launches the agent goes through this description, so the whole IDE follows
 * the choice: the logo, the models, the wording, the command line, the usage gauge.
 */
export interface Assistant {
	id: AssistantId;
	/** How the user calls it: "Claude", "ChatGPT". */
	name: string;
	/** The command-line agent Orbit runs in its terminals. */
	product: string;
	/** Default program name, looked up on the PATH. */
	program: string;
	/** Product icon (font glyph) for native UI: status bar, trees, menus. */
	icon: string;
	/** Theme colour of the mark. */
	color: string;
	/** Image of the mark, in the extension's media folder, for terminal tabs and pages. */
	image: string;
	/** Subscription the usage gauge reads. */
	plan: string;
	models: AssistantModel[];
	modes: AssistantMode[];
	/** Where to send someone who has not installed the command-line agent yet. */
	install: { command: string; login: string; url: string };
}

const CLAUDE: Assistant = {
	id: 'claude',
	name: 'Claude',
	product: 'Claude Code',
	program: 'claude',
	icon: 'orbit-claude',
	color: 'orbit.claudeOrange',
	image: 'claude.svg',
	plan: 'abonnement Claude',
	models: [
		{ id: '', label: 'Par défaut (Claude Code)' },
		{ id: 'opus', label: 'Opus' },
		{ id: 'sonnet', label: 'Sonnet' },
		{ id: 'haiku', label: 'Haiku' },
		{ id: 'claude-fable-5-1', label: 'Fable 5.1' },
	],
	modes: [
		{ id: '', label: 'Par défaut', hint: 'Claude demande avant chaque action sensible' },
		{ id: 'acceptEdits', label: 'Accepter les modifications', hint: 'Modifie les fichiers sans demander, demande pour les commandes' },
		{ id: 'plan', label: 'Plan', hint: 'Explore et propose un plan avant d\'agir' },
		{ id: 'auto', label: 'Auto', hint: 'Autonome, actions validées par un classifieur de sécurité' },
	],
	install: { command: 'npm install -g @anthropic-ai/claude-code', login: 'claude', url: 'https://claude.com/claude-code' },
};

const CHATGPT: Assistant = {
	id: 'chatgpt',
	name: 'ChatGPT',
	product: 'Codex',
	program: 'codex',
	icon: 'orbit-openai',
	color: 'orbit.chatgptMark',
	image: 'openai.svg',
	plan: 'abonnement ChatGPT',
	models: [
		{ id: '', label: 'Par défaut (Codex)' },
		{ id: 'gpt-6-astra', label: 'GPT-6 Astra' },
		{ id: 'gpt-reserve', label: 'GPT Reserve (rapide)' },
		{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
	],
	modes: [
		{ id: '', label: 'Par défaut', hint: 'ChatGPT demande avant de sortir du projet ou de lancer une commande sensible' },
		{ id: 'acceptEdits', label: 'Accepter les modifications', hint: 'Modifie les fichiers du projet sans demander' },
		{ id: 'plan', label: 'Lecture seule', hint: 'Explore et propose, sans rien modifier' },
		{ id: 'auto', label: 'Auto', hint: 'Autonome, demandes validées par une relecture automatique' },
	],
	install: { command: 'npm install -g @openai/codex', login: 'codex login', url: 'https://developers.openai.com/codex' },
};

export const ASSISTANTS: Assistant[] = [CLAUDE, CHATGPT];

/** Set while a text must name each assistant as it is (the list that offers to choose between them). */
export const wording = { literal: false };

export function assistantId(): AssistantId {
	return vscode.workspace.getConfiguration('orbit').get<string>('assistant') === 'chatgpt' ? 'chatgpt' : 'claude';
}

export function assistant(): Assistant {
	return assistantId() === 'chatgpt' ? CHATGPT : CLAUDE;
}

/** True once the user has picked an assistant (or kept the default knowingly). */
export function assistantChosen(): boolean {
	const inspected = vscode.workspace.getConfiguration('orbit').inspect<string>('assistant');
	return inspected?.globalValue !== undefined || inspected?.workspaceValue !== undefined;
}

/**
 * The choice, as a first-launch question and as a command. Changing it never touches running
 * terminals: they keep the agent they were started with, new ones take the new choice.
 */
export async function chooseAssistant(): Promise<AssistantId | undefined> {
	const current = assistantId();
	// This list names both assistants: it must not be reworded for the one in use.
	wording.literal = true;
	const pick = await Promise.resolve(vscode.window.showQuickPick(ASSISTANTS.map(a => ({
		label: `$(${a.icon}) ${a.name}`,
		description: `${a.product}${a.id === current && assistantChosen() ? ' · actuel' : ''}`,
		detail: a.id === 'claude'
			? 'Orbit lance Claude Code dans ses terminaux, sur ton abonnement Claude.'
			: 'Orbit lance Codex dans ses terminaux, sur ton abonnement ChatGPT.',
		id: a.id,
	})), { title: 'Avec quelle IA veux-tu travailler dans Orbit ?', placeHolder: 'Une seule à la fois : tout Orbit s\'adapte à ton choix', ignoreFocusOut: true })).finally(() => { wording.literal = false; });
	if (!pick) {
		return undefined;
	}
	await vscode.workspace.getConfiguration('orbit').update('assistant', pick.id, vscode.ConfigurationTarget.Global);
	return pick.id;
}
