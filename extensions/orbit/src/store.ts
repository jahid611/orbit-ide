/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { assistantId } from './assistant';
import { claudeEnv, resolveClaudeExecutable } from './config';
import { Page, requestJson } from './page';
import { signInTerminal, waitSignedIn } from './signIn';

interface Connector {
	id: string;
	name: string;
	/** Slug of the logo on Simple Icons, and the brand colour behind it. */
	logo: string;
	color: string;
	category: string;
	description: string;
	/** A hosted server (the user signs in from the browser), or a program run on this machine. */
	url?: string;
	command?: string[];
	site: string;
}

interface RecipeEntry {
	name: string;
	description: string;
	icon: string;
	prompt: string;
}

interface Pack {
	id: string;
	name: string;
	description: string;
	recipes: RecipeEntry[];
}

/** Connectors published by the tools themselves. Each address is the one its maker documents. */
const CONNECTORS: Connector[] = [
	{ id: 'github', name: 'GitHub', logo: 'github', color: '#181717', category: 'Code', description: 'Issues, pull requests, revues et recherche dans tes dépôts.', url: 'https://api.githubcopilot.com/mcp/', site: 'https://github.com' },
	{ id: 'figma', name: 'Figma', logo: 'figma', color: '#1e1e1e', category: 'Design', description: 'Lit tes maquettes : structure, styles, variables, captures. Sert à « Figma vers code ».', url: 'https://mcp.figma.com/mcp', site: 'https://figma.com' },
	{ id: 'supabase', name: 'Supabase', logo: 'supabase', color: '#1c1c1c', category: 'Données', description: 'Tables, requêtes SQL, migrations et journaux de ton projet Supabase.', url: 'https://mcp.supabase.com/mcp', site: 'https://supabase.com' },
	{ id: 'stripe', name: 'Stripe', logo: 'stripe', color: '#635bff', category: 'Paiement', description: 'Produits, prix, clients, liens de paiement et documentation Stripe.', url: 'https://mcp.stripe.com', site: 'https://stripe.com' },
	{ id: 'vercel', name: 'Vercel', logo: 'vercel', color: '#000000', category: 'Mise en ligne', description: 'Projets, déploiements et journaux de construction Vercel.', url: 'https://mcp.vercel.com', site: 'https://vercel.com' },
	{ id: 'sentry', name: 'Sentry', logo: 'sentry', color: '#362d59', category: 'Qualité', description: 'Les erreurs de ton app en production, avec leur pile, pour les faire corriger.', url: 'https://mcp.sentry.dev/mcp', site: 'https://sentry.io' },
	{ id: 'linear', name: 'Linear', logo: 'linear', color: '#5e6ad2', category: 'Organisation', description: 'Tickets, projets et cycles Linear : l\'agent lit le ticket et le met à jour.', url: 'https://mcp.linear.app/mcp', site: 'https://linear.app' },
	{ id: 'notion', name: 'Notion', logo: 'notion', color: '#191919', category: 'Organisation', description: 'Recherche, lecture et écriture dans tes pages et bases Notion.', url: 'https://mcp.notion.com/mcp', site: 'https://notion.so' },
	{ id: 'context7', name: 'Context7', logo: 'upstash', color: '#00c98d', category: 'Documentation', description: 'La documentation à jour des bibliothèques, pour que l\'agent n\'invente pas d\'API.', url: 'https://mcp.context7.com/mcp', site: 'https://context7.com' },
	{ id: 'playwright', name: 'Playwright', logo: 'playwright', color: '#2ead33', category: 'Qualité', description: 'Un vrai navigateur piloté par l\'agent : cliquer, remplir, vérifier une page.', command: ['npx', '-y', '@playwright/mcp@latest'], site: 'https://playwright.dev' },
	{ id: 'higgsfield', name: 'Higgsfield', logo: '', color: '#d1fe17', category: 'Création', description: 'Images, vidéos, modèles 3D et sons générés avec ton compte Higgsfield.', url: 'https://mcp.higgsfield.ai/mcp', site: 'https://higgsfield.ai' },
	{ id: 'cloudflare', name: 'Cloudflare', logo: 'cloudflare', color: '#f38020', category: 'Mise en ligne', description: 'La documentation Cloudflare (Workers, Pages, R2, D1) à portée de l\'agent.', url: 'https://docs.mcp.cloudflare.com/mcp', site: 'https://cloudflare.com' },
	{ id: 'huggingface', name: 'Hugging Face', logo: 'huggingface', color: '#ffd21e', category: 'IA', description: 'Modèles, jeux de données et espaces du Hub Hugging Face.', url: 'https://huggingface.co/mcp', site: 'https://huggingface.co' },
	{ id: 'canva', name: 'Canva', logo: 'canva', color: '#00c4cc', category: 'Design', description: 'Crée et retrouve tes visuels Canva depuis l\'agent.', url: 'https://mcp.canva.com/mcp', site: 'https://canva.com' },
	{ id: 'atlassian', name: 'Jira et Confluence', logo: 'atlassian', color: '#0052cc', category: 'Organisation', description: 'Tickets Jira et pages Confluence de ton équipe.', url: 'https://mcp.atlassian.com/v1/sse', site: 'https://atlassian.com' },
];

/** Recipe packs that ship with Orbit: installed into the user's own recipes, where they can be edited. */
const PACKS: Pack[] = [
	{
		id: 'qualite', name: 'Qualité du code', description: 'Relire, tester et nettoyer avant de livrer.', recipes: [
			{ name: 'Revue sévère', description: 'Une vraie relecture, sans complaisance', icon: 'eye', prompt: 'Relis les changements non commités comme un relecteur exigeant. Cherche les bugs, les cas limites oubliés, les erreurs de logique et les failles. Classe par gravité, cite fichier et ligne, et ne propose que des corrections que tu as vérifiées.' },
			{ name: 'Tests manquants', description: 'Écrit les tests qui manquent', icon: 'beaker', prompt: 'Trouve les parties du code modifié qui ne sont couvertes par aucun test, et écris ces tests avec l\'outil de test du projet. Lance-les et corrige jusqu\'à ce qu\'ils passent.' },
			{ name: 'Code mort', description: 'Retire ce qui ne sert plus', icon: 'trash', prompt: 'Cherche le code mort du projet : fonctions jamais appelées, imports inutiles, fichiers orphelins, dépendances non utilisées. Montre-moi la liste avant de supprimer quoi que ce soit.' },
			{ name: 'Simplifier', description: 'Même comportement, moins de code', icon: 'wand', prompt: 'Simplifie {{fichier}} sans changer son comportement : moins de branches, noms plus clairs, duplication retirée. Explique chaque simplification en une ligne.' },
		],
	},
	{
		id: 'interface', name: 'Interface', description: 'Rendre un écran propre, accessible et adapté au téléphone.', recipes: [
			{ name: 'Adapter au téléphone', description: 'Rend la page utilisable sur petit écran', icon: 'device-mobile', prompt: 'Rends {{fichier}} parfaitement utilisable sur téléphone : rien ne déborde, les zones tactiles font au moins 44 px, les textes restent lisibles. Vérifie dans la vue vivante d\'Orbit sur un iPhone et un Galaxy.' },
			{ name: 'Accessibilité', description: 'Contrastes, clavier, lecteurs d\'écran', icon: 'accessibility', prompt: 'Passe l\'accessibilité de {{fichier}} en revue : contrastes, navigation au clavier, focus visible, libellés pour les lecteurs d\'écran, textes alternatifs. Corrige ce qui manque.' },
			{ name: 'États manquants', description: 'Chargement, vide, erreur', icon: 'layers', prompt: 'Pour chaque écran de {{dossier}}, vérifie qu\'il existe un état de chargement, un état vide et un état d\'erreur. Ajoute ceux qui manquent, dans le style du projet.' },
			{ name: 'Finition', description: 'Espacements, alignements, transitions', icon: 'sparkle', prompt: 'Soigne la finition de {{fichier}} : espacements réguliers, alignements, hiérarchie des textes, transitions douces, survols. Ne change ni les couleurs de la marque ni la structure.' },
		],
	},
	{
		id: 'securite', name: 'Sécurité', description: 'Chercher les failles avant qu\'un autre ne les trouve.', recipes: [
			{ name: 'Audit de sécurité', description: 'Injections, accès, secrets', icon: 'shield', prompt: 'Fais un audit de sécurité du projet : injections, contrôles d\'accès manquants, secrets dans le code, données sensibles dans les journaux, dépendances vulnérables. Classe par gravité et propose le correctif de chaque point.' },
			{ name: 'Secrets oubliés', description: 'Clés et mots de passe dans le code', icon: 'key', prompt: 'Cherche dans le code et dans l\'historique git les clés d\'API, jetons et mots de passe écrits en dur. Donne le fichier et la ligne de chacun, sans jamais afficher la valeur, et dis comment le déplacer dans une variable d\'environnement.' },
			{ name: 'Entrées de l\'utilisateur', description: 'Tout ce qui vient de dehors est validé', icon: 'filter', prompt: 'Recense chaque endroit où le projet reçoit une donnée de l\'extérieur (formulaire, URL, API, fichier). Vérifie qu\'elle est validée et échappée, et corrige les trous.' },
		],
	},
	{
		id: 'livraison', name: 'Livraison', description: 'Préparer une mise en ligne sans surprise.', recipes: [
			{ name: 'Prêt à publier ?', description: 'La liste de contrôle avant la mise en ligne', icon: 'rocket', prompt: 'Vérifie que le projet est prêt à être mis en ligne : la construction passe, pas d\'erreur de types ni de lint, variables d\'environnement documentées dans .env.example, pas de code de débogage, métadonnées de la page (titre, description, image de partage). Liste ce qui bloque.' },
			{ name: 'Notes de version', description: 'Ce qui a changé, pour les utilisateurs', icon: 'note', prompt: 'Écris les notes de version depuis la dernière étiquette git : ce qui est nouveau, ce qui est corrigé, ce qui change pour l\'utilisateur. Phrases courtes, sans jargon.' },
			{ name: 'Performance', description: 'Ce qui ralentit la page', icon: 'dashboard', prompt: 'Cherche ce qui ralentit le chargement : images trop lourdes, scripts bloquants, dépendances énormes, requêtes en cascade. Mesure avant, corrige, mesure après.' },
		],
	},
];

const USER_RECIPES = path.join(os.homedir(), '.orbit', 'recipes.json');
const TOPIC = 'orbit-ide-skill';

/**
 * The skill store: connectors (the tools' own MCP servers, added to the assistant in one click and
 * signed in from the browser), recipe packs, and what other users published on GitHub under the
 * topic `orbit-ide-skill` (a repository with `.orbit/skill.json`: connectors and recipes).
 */
export class Store extends Page {

	/** The connectors the assistant lists, with whether each one is signed in. */
	private installed: { name: string; connected: boolean }[] | undefined;
	private working: string | undefined;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private community: any[] | undefined;
	private communityError: string | undefined;

	constructor(context: vscode.ExtensionContext, private readonly reloadRecipes: () => void) {
		super(context, 'store', 'Magasin de compétences');
		this.disposables.push(vscode.commands.registerCommand('orbit.store.show', () => this.show()));
	}

	private cli(args: string[], timeout: number): Promise<{ ok: boolean; out: string }> {
		const program = resolveClaudeExecutable();
		const shell = process.platform === 'win32' && !/\.exe$/i.test(program);
		return new Promise(resolve => execFile(program, shell ? args.map(a => /\s/.test(a) ? `"${a}"` : a) : args, { timeout, windowsHide: true, env: claudeEnv(), shell, cwd: os.homedir() }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout ?? ''}\n${stderr ?? ''}` })));
	}

	/** The connector the assistant lists under a name that contains this one (`figma`, `plugin:design:figma`, `claude.ai Figma`). */
	private listed(id: string): { name: string; connected: boolean } | undefined {
		const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
		const matches = this.installed?.filter(entry => plain(entry.name).includes(plain(id))) ?? [];
		return matches.find(entry => entry.connected) ?? matches[0];
	}

	/** Whether the assistant has this connector and is signed in to it. */
	has(id: string): boolean {
		return !!this.listed(id)?.connected;
	}

	async loadInstalled(): Promise<void> {
		const listed = await this.cli(['mcp', 'list'], 45000);
		if (!listed.ok && !listed.out.trim()) {
			return;
		}
		if (assistantId() === 'chatgpt') {
			// A table: name first, sign-in state last.
			this.installed = listed.out.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^name\s/i.test(l))
				.map(l => ({ name: l.split(/\s{2,}/)[0], connected: !/not logged in|disabled/i.test(l) }));
		} else {
			// « name: address - state », the name itself possibly holding colons (plugin:design:figma).
			this.installed = listed.out.split(/\r?\n/).map(l => l.match(/^(.+?):\s+\S.*\s-\s+(.*)$/) ?? l.match(/^(.+?):\s+\(.*\s-\s+(.*)$/))
				.filter((m): m is RegExpMatchArray => !!m)
				.map(m => ({ name: m[1].trim(), connected: /connected/i.test(m[2]) && !/needs|failed|not/i.test(m[2]) }));
		}
	}

	private userRecipes(): RecipeEntry[] {
		try {
			const data = JSON.parse(fs.readFileSync(USER_RECIPES, 'utf8').replace(/^﻿/, ''));
			return Array.isArray(data) ? data : Array.isArray(data.recipes) ? data.recipes : [];
		} catch {
			return [];
		}
	}

	private addRecipes(recipes: RecipeEntry[]): number {
		const mine = this.userRecipes();
		const known = new Set(mine.map(r => r.name));
		const fresh = recipes.filter(r => r && typeof r.name === 'string' && typeof r.prompt === 'string' && !known.has(r.name))
			.map(r => ({ id: `${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 6)}`, name: r.name.slice(0, 80), description: String(r.description ?? '').slice(0, 200), icon: /^[a-z-]+$/.test(String(r.icon)) ? r.icon : 'sparkle', prompt: r.prompt.slice(0, 8000) }));
		if (fresh.length) {
			fs.mkdirSync(path.dirname(USER_RECIPES), { recursive: true });
			fs.writeFileSync(USER_RECIPES, `${JSON.stringify({ recipes: [...mine, ...fresh] }, null, '\t')}\n`);
			this.reloadRecipes();
		}
		return fresh.length;
	}

	protected send(): void {
		const mine = new Set(this.userRecipes().map(r => r.name));
		this.post({
			type: 'state',
			connectors: CONNECTORS.map(c => ({ ...c, local: !!c.command, installed: this.installed ? this.has(c.id) : undefined, listed: !!this.listed(c.id) })),
			packs: PACKS.map(p => ({ id: p.id, name: p.name, description: p.description, recipes: p.recipes.map(r => ({ name: r.name, description: r.description, installed: mine.has(r.name) })) })),
			working: this.working,
			community: this.community,
			communityError: this.communityError,
			topic: TOPIC,
		});
	}

	protected override async refresh(): Promise<void> {
		this.send();
		await this.loadInstalled();
		this.send();
	}

	/** Adds a connector to the assistant, then opens its sign-in page when it has one. */
	async install(connector: Connector): Promise<boolean> {
		if (this.working) {
			return false;
		}
		// Already there but not signed in (it came with a plugin, or was added earlier): only the sign-in is missing.
		const existing = this.listed(connector.id);
		if (existing && !existing.connected) {
			await this.signIn(connector, existing.name);
			return this.has(connector.id);
		}
		const chat = assistantId() === 'chatgpt';
		const add = connector.url
			? chat ? ['mcp', 'add', connector.id, '--url', connector.url] : ['mcp', 'add', '--scope', 'user', '--transport', /\/sse$/.test(connector.url) ? 'sse' : 'http', connector.id, connector.url]
			: chat ? ['mcp', 'add', connector.id, '--', ...connector.command ?? []] : ['mcp', 'add', '--scope', 'user', connector.id, '--', ...connector.command ?? []];
		this.working = `Ajout de ${connector.name}…`;
		this.send();
		const added = await this.cli(add, 60000);
		if (!added.ok && !/already exists/i.test(added.out)) {
			this.working = undefined;
			await this.refresh();
			const last = added.out.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop();
			vscode.window.showErrorMessage(`${connector.name} : ${last ?? 'l\'ajout a échoué.'}`);
			return false;
		}
		await this.loadInstalled();
		// Not every server asks for a sign-in: one that is connected once added is left alone.
		if (connector.url && !this.has(connector.id)) {
			await this.signIn(connector, this.listed(connector.id)?.name ?? connector.id);
		}
		this.working = undefined;
		await this.refresh();
		return true;
	}

	/** The sign-in runs in a terminal of Orbit (the assistant's tool needs one), and the page follows it. */
	private async signIn(connector: Connector, name: string): Promise<void> {
		this.working = `${connector.name} : valide la connexion dans le navigateur. Si le terminal « Connexion · ${connector.name} » te le demande, colle-lui l'adresse de la page sur laquelle tu arrives.`;
		this.send();
		const terminal = signInTerminal(name, connector.name);
		await waitSignedIn(terminal, async () => {
			await this.loadInstalled();
			return this.has(connector.id);
		});
		this.working = undefined;
		await this.refresh();
	}

	connector(id: string): Connector | undefined {
		return CONNECTORS.find(c => c.id === id);
	}

	private async loadCommunity(): Promise<void> {
		const answer = await requestJson('GET', `https://api.github.com/search/repositories?q=topic:${TOPIC}&sort=stars&per_page=30`, { 'accept': 'application/vnd.github+json', 'user-agent': 'Orbit' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const items = (answer.json as any)?.items;
		if (!answer.ok || !Array.isArray(items)) {
			this.communityError = answer.status === 403 ? 'GitHub limite les recherches pour l\'instant : réessaie dans une minute.' : 'GitHub ne répond pas.';
			this.community = [];
		} else {
			this.communityError = undefined;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			this.community = items.map((r: any) => ({ repo: String(r.full_name), description: String(r.description ?? ''), stars: Number(r.stargazers_count) || 0, owner: String(r.owner?.login ?? ''), avatar: String(r.owner?.avatar_url ?? ''), branch: String(r.default_branch ?? 'main') }));
		}
		this.send();
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'refresh':
				await this.refresh();
				break;
			case 'install': {
				const connector = this.connector(String(msg.id));
				if (connector) {
					await this.install(connector);
				}
				break;
			}
			case 'remove': {
				const connector = this.connector(String(msg.id));
				const name = this.listed(String(msg.id))?.name ?? String(msg.id);
				if (connector && await vscode.window.showWarningMessage(`Retirer ${connector.name} ?`, { modal: true, detail: 'Le connecteur est retiré de ton assistant. Ton compte chez l\'outil n\'est pas touché.' }, 'Retirer')) {
					this.working = `Retrait de ${connector.name}…`;
					this.send();
					await this.cli(['mcp', 'logout', name], 30000);
					const removed = await this.cli(['mcp', 'remove', name], 30000);
					this.working = undefined;
					await this.refresh();
					if (!removed.ok && this.listed(connector.id)) {
						vscode.window.showInformationMessage(`${connector.name} vient de ton compte ou d'une extension : il se retire là où il a été ajouté.`);
					}
				}
				break;
			}
			case 'pack': {
				const pack = PACKS.find(p => p.id === msg.id);
				if (pack) {
					const added = this.addRecipes(pack.recipes);
					this.post({ type: 'toast', text: added ? `${added} recette${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} à « Mes recettes »` : 'Tu as déjà toutes ces recettes' });
					this.send();
				}
				break;
			}
			case 'community':
				await this.loadCommunity();
				break;
			case 'skill': {
				// A community skill is shown before anything is installed: it is someone else's text and commands.
				const repo = String(msg.repo ?? '');
				const branch = String(msg.branch ?? 'main');
				if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[\w./-]+$/.test(branch)) {
					break;
				}
				const answer = await requestJson('GET', `https://raw.githubusercontent.com/${repo}/${branch}/.orbit/skill.json`, { 'user-agent': 'Orbit' });
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const skill = answer.json as any;
				if (!answer.ok || !skill) {
					vscode.window.showWarningMessage(`${repo} ne contient pas de fichier .orbit/skill.json lisible.`);
					break;
				}
				const recipes: RecipeEntry[] = Array.isArray(skill.recipes) ? skill.recipes : [];
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const connectors: Connector[] = (Array.isArray(skill.connectors) ? skill.connectors : []).filter((c: any) => c && /^[a-z0-9-]{2,40}$/.test(String(c.id)) && /^https:\/\/[^\s"']+$/.test(String(c.url)))
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					.map((c: any) => ({ id: String(c.id), name: String(c.name ?? c.id).slice(0, 40), logo: '', color: '#8b7bff', category: 'Communauté', description: '', url: String(c.url), site: '' }));
				const detail = [
					recipes.length ? `${recipes.length} recette${recipes.length > 1 ? 's' : ''} : ${recipes.map(r => r?.name).filter(Boolean).slice(0, 8).join(', ')}` : '',
					connectors.length ? `${connectors.length} connecteur${connectors.length > 1 ? 's' : ''} : ${connectors.map(c => `${c.name} (${c.url})`).join(', ')}` : '',
					'\nCe contenu vient d\'un autre utilisateur : une recette est un texte envoyé à ton agent, un connecteur lui donne des outils. N\'installe que ce en quoi tu as confiance.',
				].filter(Boolean).join('\n');
				if (!recipes.length && !connectors.length) {
					vscode.window.showWarningMessage(`${repo} ne propose ni recette ni connecteur.`);
					break;
				}
				if (await vscode.window.showInformationMessage(`Installer « ${repo} » ?`, { modal: true, detail }, 'Installer') !== 'Installer') {
					break;
				}
				const added = this.addRecipes(recipes);
				for (const connector of connectors) {
					await this.install(connector);
				}
				this.post({ type: 'toast', text: `Installé : ${added} recette${added > 1 ? 's' : ''}${connectors.length ? `, ${connectors.length} connecteur${connectors.length > 1 ? 's' : ''}` : ''}` });
				this.send();
				break;
			}
			case 'open':
				if (/^https:\/\//.test(String(msg.url))) {
					vscode.env.openExternal(vscode.Uri.parse(String(msg.url), true));
				}
				break;
			case 'recipes':
				await vscode.commands.executeCommand('orbit.recipes.pick');
				break;
		}
	}
}
