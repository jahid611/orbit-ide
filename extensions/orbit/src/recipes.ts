/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeTerminals } from './claudeTerminals';

const VIEW_ID = 'orbit.recipes';
const FILE_NAME = 'recipes.json';
const DEFAULT_ICON = 'beaker';

type Source = 'project' | 'user' | 'builtin';
type FileSource = Exclude<Source, 'builtin'>;

/** A ready-made instruction for Claude, as stored in a `recipes.json`. */
interface Recipe {
	id: string;
	name: string;
	description: string;
	/** Codicon id, without the `$( )` wrapper. */
	icon: string;
	prompt: string;
}

interface GroupNode {
	kind: 'group';
	source: Source;
}

interface RecipeNode {
	kind: 'recipe';
	source: Source;
	recipe: Recipe;
}

/** A line that is not a recipe: an empty group's hint, or a file that could not be read. */
interface NoteNode {
	kind: 'note';
	source: Source;
	label: string;
	icon: string;
	tooltip?: string;
	command?: vscode.Command;
}

type Node = GroupNode | RecipeNode | NoteNode;

interface Loaded {
	recipes: Recipe[];
	error?: string;
}

const GROUPS: Record<Source, { label: string; icon: string; tooltip: string }> = {
	project: { label: 'Projet', icon: 'folder', tooltip: 'Recettes du projet (.orbit/recipes.json), à partager avec l\'équipe' },
	user: { label: 'Mes recettes', icon: 'account', tooltip: 'Tes recettes, disponibles dans tous les projets (~/.orbit/recipes.json)' },
	builtin: { label: 'Orbit', icon: 'library', tooltip: 'Recettes fournies avec Orbit' },
};

const BUILTIN: Recipe[] = [
	{
		id: 'composant-interface',
		name: 'Ajouter un composant d\'interface',
		description: 'Un composant soigné, adapté au style du projet',
		icon: 'layout',
		prompt: [
			'Ajoute ce composant d\'interface au projet : {{question: Quel composant ? (ex. barre de navigation, tableau de prix, carte produit)}}.',
			'1. Regarde d\'abord comment le projet est fait : bibliothèque d\'interface, système de styles, composants déjà là, conventions de nommage. Le nouveau composant doit avoir l\'air d\'avoir toujours été là.',
			'2. Si tu as des outils de bibliothèque de composants (21st.dev ou autre), cherche-y deux ou trois candidats de qualité et dis-moi lequel tu retiens et pourquoi ; sinon écris-le toi-même.',
			'3. Intègre-le à l\'endroit où il sert, avec de vraies données du projet plutôt qu\'un texte de remplissage, et rends-le correct au clavier, sur mobile et en thème sombre si le projet en a un.',
			'4. Vérifie le résultat dans la vue vivante d\'Orbit et corrige ce qui déborde ou se chevauche.',
			'Termine par le chemin des fichiers créés et l\'endroit où le composant est utilisé.',
		].join('\n'),
	},
	{
		id: 'revue-diff',
		name: 'Revue de code du diff courant',
		description: 'Relit les changements non commités, classés par gravité',
		icon: 'git-compare',
		prompt: [
			'Fais une revue de code des changements en cours dans ce dépôt.',
			'1. Lance `git status` puis `git diff HEAD` et lis aussi les fichiers non suivis.',
			'2. Lis autour de chaque changement le code nécessaire pour le comprendre (appelants, types, tests existants).',
			'3. Cherche : bugs logiques, cas limites oubliés (valeurs vides, nulles, erreurs réseau, concurrence), erreurs avalées, failles de sécurité, régressions de comportement, code mort, tests manquants.',
			'Rends une liste classée en trois niveaux : Bloquant, À corriger, Suggestion. Pour chaque point : fichier:ligne, le problème en une phrase, pourquoi c\'est un problème, le correctif proposé.',
			'Ne signale que ce dont tu es sûr après avoir lu le code ; pas de remarques de style que le linter gère déjà.',
			'Ne modifie aucun fichier. Termine par un verdict : prêt à commiter, ou non et pourquoi.',
		].join('\n'),
	},
	{
		id: 'tests-fichier',
		name: 'Écrire les tests du fichier ouvert',
		description: 'Tests du fichier actif, avec le framework déjà en place',
		icon: 'checklist',
		prompt: [
			'Écris les tests de @{{fichier}}.',
			'1. Repère le framework de test et les conventions du projet (dossier, nommage, utilitaires, mocks) en lisant deux ou trois tests existants ; n\'ajoute aucune dépendance sans me le demander.',
			'2. Liste les comportements publics du fichier, puis couvre : le cas nominal, les cas limites (vide, nul, bornes, entrées invalides) et les chemins d\'erreur.',
			'3. Un test = un comportement, avec un nom qui dit ce qui est attendu. Teste le comportement observable, pas les détails d\'implémentation.',
			'4. Lance les tests et corrige-les jusqu\'à ce qu\'ils passent. Si un test révèle un vrai bug du fichier, ne le maquille pas : garde le test et signale-le moi.',
			'Termine par la liste de ce qui est couvert et de ce qui ne l\'est pas, avec la raison.',
		].join('\n'),
	},
	{
		id: 'expliquer-fichier',
		name: 'Expliquer le fichier à un débutant',
		description: 'Le rôle du fichier, pas à pas, sans jargon',
		icon: 'mortar-board',
		prompt: [
			'Explique-moi @{{fichier}} comme à quelqu\'un qui débute en programmation.',
			'- Commence par deux phrases : à quoi sert ce fichier et où il se place dans le projet (qui l\'utilise, ce qu\'il utilise).',
			'- Puis parcours-le dans l\'ordre de lecture, bloc par bloc : ce que fait chaque partie et pourquoi elle est là.',
			'- Définis chaque terme technique la première fois qu\'il apparaît, avec une comparaison simple quand ça aide.',
			'- Montre un exemple concret : ce qui se passe, étape par étape, quand ce code s\'exécute.',
			'- Termine par les trois choses à retenir et les pièges où un débutant se tromperait en le modifiant.',
			'Ne modifie aucun fichier.',
		].join('\n'),
	},
	{
		id: 'chasser-bugs',
		name: 'Chasser les bugs d\'un fichier',
		description: 'Cherche les vrais bugs du fichier actif et les prouve',
		icon: 'bug',
		prompt: [
			'Cherche les bugs de @{{fichier}}.',
			'Lis le fichier en entier, puis ses appelants et ce qu\'il appelle, pour connaître les valeurs réellement possibles.',
			'Passe en revue : valeurs nulles ou absentes, tableaux vides, erreurs d\'indice et de bornes, promesses non attendues, exceptions non gérées, conditions de concurrence, ressources jamais libérées, comparaisons et conversions de types douteuses, états incohérents après une erreur.',
			'Pour chaque bug : la ligne, le scénario précis qui le déclenche (entrées et étapes), la conséquence visible, le correctif.',
			'Sépare clairement les bugs avérés des simples soupçons, et n\'invente rien pour faire du volume : « aucun bug trouvé » est une réponse valable.',
			'Ne corrige rien pour l\'instant : montre-moi la liste, je choisirai quoi corriger.',
		].join('\n'),
	},
	{
		id: 'refactoriser',
		name: 'Refactoriser sans changer le comportement',
		description: 'Code plus lisible, comportement strictement identique',
		icon: 'wrench',
		prompt: [
			'Refactorise @{{fichier}} sans rien changer à son comportement.',
			'1. Avant de toucher au code, repère les tests qui le couvrent et lance-les. S\'il n\'y en a pas, écris d\'abord des tests qui figent le comportement actuel.',
			'2. Améliore la lisibilité : noms clairs, fonctions courtes à responsabilité unique, duplication supprimée, imbrications aplaties, code mort retiré.',
			'3. Ne change ni les signatures publiques, ni les valeurs retournées, ni les effets de bord, ni les messages d\'erreur. N\'ajoute aucune fonctionnalité et ne corrige aucun bug en passant : signale-les moi à part.',
			'4. Avance par petites étapes et relance les tests après chacune.',
			'Termine par un résumé des changements et la preuve que les tests passent toujours.',
		].join('\n'),
	},
	{
		id: 'documenter',
		name: 'Documenter : README à jour',
		description: 'Aligne le README sur ce que fait vraiment le projet',
		icon: 'book',
		prompt: [
			'Mets à jour le README du projet pour qu\'il décrive ce que le code fait réellement aujourd\'hui.',
			'1. Lis le README actuel, les fichiers de configuration (dépendances, scripts, variables d\'environnement) et les points d\'entrée du code.',
			'2. Vérifie chaque commande du README : garde seulement celles qui existent vraiment, corrige les autres.',
			'3. Le README doit contenir, dans cet ordre : ce que fait le projet en deux phrases, les prérequis avec leurs versions, l\'installation, le lancement en développement, les tests, la configuration (chaque variable d\'environnement, sans aucune valeur secrète), la structure des dossiers en quelques lignes, le déploiement s\'il existe.',
			'4. Style : phrases courtes, commandes dans des blocs de code, rien d\'inventé. Ce que tu n\'as pas pu vérifier, pose-moi la question au lieu de le deviner.',
			'Garde la langue du README existant. Montre-moi le diff à la fin.',
		].join('\n'),
	},
	{
		id: 'mise-en-production',
		name: 'Préparer une mise en production',
		description: 'Liste de contrôle vérifiée point par point avant de livrer',
		icon: 'rocket',
		prompt: [
			'Prépare la mise en production de ce projet. Vérifie réellement chaque point, puis rends une liste de contrôle avec pour chacun : OK, À corriger ou Non vérifiable, et la preuve (commande lancée, fichier lu).',
			'- Build de production : il passe, sans erreur ni avertissement bloquant.',
			'- Tests et linter : ils passent.',
			'- Dépôt : rien d\'oublié dans `git status`, pas de code de débogage (console.log, TODO bloquants, données de test, identifiants en dur).',
			'- Secrets : aucun secret commité, fichiers .env ignorés par git, variables d\'environnement de production listées.',
			'- Dépendances : fichier de verrouillage à jour, pas de vulnérabilité connue grave (audit du gestionnaire de paquets).',
			'- Base de données : migrations présentes, rejouables, et plan de retour arrière.',
			'- Erreurs et journaux : erreurs gérées côté utilisateur, journaux utiles et sans données personnelles.',
			'- Version et notes de version : numéro à jour, changements résumés.',
			'- Retour arrière : comment revenir à la version précédente.',
			'Ne déploie rien et ne pousse rien. Termine par les points bloquants, du plus grave au moins grave.',
		].join('\n'),
	},
	{
		id: 'audit-securite',
		name: 'Audit de sécurité',
		description: 'Failles exploitables du projet, avec le correctif',
		icon: 'shield',
		prompt: [
			'Fais un audit de sécurité de ce projet.',
			'Commence par dresser la carte des entrées : routes et API, formulaires, fichiers envoyés, paramètres d\'URL, variables d\'environnement, tâches planifiées.',
			'Puis cherche, en lisant le code réel :',
			'- injections (SQL, commandes shell, chemins de fichiers, HTML/XSS) ;',
			'- authentification et autorisations : routes sans contrôle, accès aux données d\'un autre utilisateur, sessions et jetons mal protégés ;',
			'- secrets dans le code, dans l\'historique git ou envoyés au navigateur ;',
			'- validation des entrées côté serveur, limites de taille et de débit ;',
			'- configuration : CORS, en-têtes de sécurité, cookies, mode débogage actif ;',
			'- dépendances vulnérables (lance l\'audit du gestionnaire de paquets).',
			'Pour chaque faille : gravité (Critique, Élevée, Moyenne, Faible), fichier:ligne, comment l\'exploiter concrètement, le correctif.',
			'Ne signale que ce qui est exploitable dans ce code, pas une liste de généralités. Ne modifie rien et n\'affiche jamais la valeur d\'un secret : indique seulement où il se trouve.',
		].join('\n'),
	},
	{
		id: 'performances',
		name: 'Optimiser les performances',
		description: 'Mesure d\'abord, puis corrige ce qui coûte vraiment',
		icon: 'dashboard',
		prompt: [
			'Optimise les performances de ce projet. Ce qui est lent : {{question: Qu\'est-ce qui est lent ? (page, action, commande…)}}',
			'1. Mesure avant de changer quoi que ce soit : reproduis la lenteur et donne un chiffre (temps, nombre de requêtes, taille, mémoire).',
			'2. Trouve la cause dans le code : requêtes en boucle (N+1), calculs refaits inutilement, rendus en trop, gros fichiers ou dépendances chargés sans besoin, absence de cache ou d\'index, travail bloquant.',
			'3. Propose les corrections classées par gain attendu rapporté à l\'effort, et attends mon accord avant les changements lourds.',
			'4. Applique les corrections simples, sans changer le comportement, puis mesure à nouveau avec la même méthode.',
			'Termine par un tableau avant/après. Pas de micro-optimisation sans effet mesurable.',
		].join('\n'),
	},
	{
		id: 'responsive',
		name: 'Rendre une page responsive',
		description: 'Adapte la page active du téléphone au grand écran',
		icon: 'device-mobile',
		prompt: [
			'Rends @{{fichier}} responsive, du téléphone (360 px) au grand écran (1440 px et plus).',
			'1. Repère comment le projet gère déjà les styles (Tailwind, modules CSS, points de rupture existants) et réutilise-le ; n\'introduis pas un nouveau système.',
			'2. Pars du mobile : une colonne, texte lisible sans zoom (16 px minimum), zones tactiles d\'au moins 44 px, aucun défilement horizontal.',
			'3. Élargis ensuite par points de rupture : grilles et flexbox plutôt que largeurs fixes, images fluides qui gardent leur ratio, tableaux et menus adaptés aux petits écrans.',
			'4. Vérifie à 360, 768, 1024 et 1440 px que rien ne déborde, ne se chevauche ni ne disparaît.',
			'Ne change ni le contenu ni l\'apparence sur grand écran sans me le dire. Termine par la liste de ce qui a changé à chaque largeur.',
		].join('\n'),
	},
	{
		id: 'erreurs-compilation',
		name: 'Corriger les erreurs de compilation',
		description: 'Build et typage au vert, sans masquer les erreurs',
		icon: 'error',
		prompt: [
			'Corrige les erreurs de compilation de ce projet.',
			'1. Trouve la commande de build ou de vérification des types du projet (scripts, configuration) et lance-la.',
			'2. Traite les erreurs dans l\'ordre, en commençant par la première : les suivantes en découlent souvent. Corrige la cause, pas le symptôme.',
			'3. Interdit pour faire taire une erreur : `any`, `@ts-ignore`, conversions forcées, suppression de code utile, désactivation d\'une règle. Si c\'est vraiment la seule issue, explique-moi pourquoi avant de le faire.',
			'4. Relance la commande après chaque série de corrections, jusqu\'à zéro erreur.',
			'Termine par la liste des erreurs corrigées avec leur cause, et signale tout changement qui modifie le comportement.',
		].join('\n'),
	},
	{
		id: 'resume-jour',
		name: 'Résumer ce qui a changé aujourd\'hui',
		description: 'Les commits et les changements en cours du jour',
		icon: 'history',
		prompt: [
			'Résume ce qui a changé aujourd\'hui dans ce dépôt.',
			'1. Lance `git log --since=midnight --stat` sur toutes les branches locales, puis `git status` et `git diff HEAD` pour le travail pas encore commité.',
			'2. Regroupe par sujet (fonctionnalité, correction, refactorisation, configuration) plutôt que commit par commit.',
			'3. Pour chaque sujet : ce qui a changé pour l\'utilisateur ou pour le développeur, les fichiers principaux, et l\'état (commité ou en cours).',
			'Termine par ce qui reste à finir ou à vérifier, d\'après le code lui-même (TODO ajoutés, tests manquants, changements à moitié faits).',
			'Reste court et factuel : un résumé que je pourrais envoyer tel quel à l\'équipe. Ne modifie aucun fichier.',
		].join('\n'),
	},
];

/**
 * Recipes: a library of ready-made instructions for Claude, from the project
 * (`.orbit/recipes.json`), the user (`~/.orbit/recipes.json`) and Orbit itself.
 */
export class Recipes implements vscode.TreeDataProvider<Node>, vscode.Disposable {

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private readonly loaded: Record<FileSource, Loaded> = { project: { recipes: [] }, user: { recipes: [] } };
	/** Errors already shown, so a broken file is reported once and not at every save of another. */
	private readonly reported: Partial<Record<FileSource, string>> = {};
	private readonly disposables: vscode.Disposable[] = [];
	private watchers: vscode.Disposable[] = [];
	private reloadTimer: NodeJS.Timeout | undefined;

	constructor(private readonly claude: ClaudeTerminals) {
		this.reload();
		this.watch();
		this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
			this.watch();
			this.reload();
		}));
	}

	/** Registers the view and every command; the caller owns the returned disposables. */
	register(): vscode.Disposable[] {
		const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this, showCollapseAll: true });
		return [
			view,
			// A change missed by the watcher (network drive, folder created later) shows up when the view does.
			view.onDidChangeVisibility(e => e.visible && this.reload()),
			vscode.commands.registerCommand('orbit.recipes.run', (node?: Node) => this.run(node)),
			vscode.commands.registerCommand('orbit.recipes.pick', () => this.run()),
			vscode.commands.registerCommand('orbit.recipes.add', (node?: Node) => this.add(node)),
			vscode.commands.registerCommand('orbit.recipes.edit', (node?: Node) => this.edit(node)),
			vscode.commands.registerCommand('orbit.recipes.delete', (node?: Node) => this.delete(node)),
			vscode.commands.registerCommand('orbit.recipes.saveSelection', () => this.saveSelection()),
			vscode.commands.registerCommand('orbit.recipes.refresh', () => this.reload()),
		];
	}

	dispose(): void {
		clearTimeout(this.reloadTimer);
		this.watchers.forEach(d => d.dispose());
		this.disposables.forEach(d => d.dispose());
		this._onDidChangeTreeData.dispose();
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.kind === 'group') {
			const group = GROUPS[node.source];
			const item = new vscode.TreeItem(group.label, vscode.TreeItemCollapsibleState.Expanded);
			const count = this.recipesOf(node.source).length;
			item.id = `group:${node.source}`;
			item.iconPath = new vscode.ThemeIcon(group.icon);
			item.description = count ? String(count) : undefined;
			item.tooltip = group.tooltip;
			item.contextValue = `recipeGroup.${node.source}`;
			return item;
		}
		if (node.kind === 'note') {
			const item = new vscode.TreeItem(node.label);
			item.iconPath = new vscode.ThemeIcon(node.icon);
			item.tooltip = node.tooltip ?? node.label;
			item.command = node.command;
			item.contextValue = 'recipeNote';
			return item;
		}
		const { recipe } = node;
		const item = new vscode.TreeItem(recipe.name);
		item.id = `recipe:${node.source}:${recipe.id}`;
		item.iconPath = new vscode.ThemeIcon(recipe.icon);
		item.description = recipe.description;
		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**${escapeMarkdown(recipe.name)}**`);
		if (recipe.description) {
			tooltip.appendMarkdown(`\n\n${escapeMarkdown(recipe.description)}`);
		}
		tooltip.appendCodeblock(recipe.prompt.length > 1200 ? `${recipe.prompt.slice(0, 1200)}…` : recipe.prompt, 'markdown');
		item.tooltip = tooltip;
		item.command = { command: 'orbit.recipes.run', title: 'Envoyer à Claude', arguments: [node] };
		item.contextValue = `recipe.${node.source}`;
		return item;
	}

	getChildren(node?: Node): Node[] {
		if (!node) {
			return (['project', 'user', 'builtin'] as const).map(source => ({ kind: 'group', source }));
		}
		if (node.kind !== 'group') {
			return [];
		}
		const { source } = node;
		const children: Node[] = [];
		if (source !== 'builtin') {
			const file = this.fileOf(source);
			if (!file) {
				return [{ kind: 'note', source, icon: 'info', label: 'Ouvre un dossier pour avoir des recettes de projet' }];
			}
			const error = this.loaded[source].error;
			if (error) {
				children.push({
					kind: 'note', source, icon: 'warning', label: error, tooltip: `${file}\n${error}`,
					command: { command: 'vscode.open', title: 'Ouvrir le fichier', arguments: [vscode.Uri.file(file)] },
				});
			}
		}
		const recipes = this.recipesOf(source);
		children.push(...recipes.map<Node>(recipe => ({ kind: 'recipe', source, recipe })));
		if (!children.length) {
			children.push({
				kind: 'note', source, icon: 'add', label: 'Ajouter une recette…',
				tooltip: source === 'project' ? 'Enregistrée dans .orbit/recipes.json, à partager avec l\'équipe' : 'Enregistrée dans ~/.orbit/recipes.json',
				command: { command: 'orbit.recipes.add', title: 'Nouvelle recette', arguments: [node] },
			});
		}
		return children;
	}

	private recipesOf(source: Source): Recipe[] {
		return source === 'builtin' ? BUILTIN : this.loaded[source].recipes;
	}

	private fileOf(source: FileSource): string | undefined {
		if (source === 'user') {
			return path.join(os.homedir(), '.orbit', FILE_NAME);
		}
		const folder = vscode.workspace.workspaceFolders?.[0];
		return folder?.uri.scheme === 'file' ? path.join(folder.uri.fsPath, '.orbit', FILE_NAME) : undefined;
	}

	private watch(): void {
		this.watchers.forEach(d => d.dispose());
		this.watchers = [];
		const patterns: vscode.RelativePattern[] = [];
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (folder?.uri.scheme === 'file') {
			// Through the workspace watcher: `.orbit` may not exist yet in the project.
			patterns.push(new vscode.RelativePattern(folder, `.orbit/${FILE_NAME}`));
		}
		const home = path.join(os.homedir(), '.orbit');
		try {
			fs.mkdirSync(home, { recursive: true });
			patterns.push(new vscode.RelativePattern(vscode.Uri.file(home), FILE_NAME));
		} catch {
			// no home folder to watch: the view still reloads when it is shown
		}
		for (const pattern of patterns) {
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			this.watchers.push(watcher, watcher.onDidCreate(() => this.reloadSoon()), watcher.onDidChange(() => this.reloadSoon()), watcher.onDidDelete(() => this.reloadSoon()));
		}
	}

	private reloadSoon(): void {
		clearTimeout(this.reloadTimer);
		// Editors save in several writes: wait for the file to settle.
		this.reloadTimer = setTimeout(() => this.reload(), 150);
	}

	private reload(): void {
		for (const source of ['project', 'user'] as const) {
			const file = this.fileOf(source);
			const loaded = file ? loadFile(file) : { recipes: [] };
			this.loaded[source] = loaded;
			if (file && loaded.error && this.reported[source] !== loaded.error) {
				vscode.window.showWarningMessage(`Recettes « ${GROUPS[source].label} » : ${loaded.error}`, 'Ouvrir le fichier').then(choice => {
					if (choice) {
						vscode.window.showTextDocument(vscode.Uri.file(file));
					}
				});
			}
			this.reported[source] = loaded.error;
		}
		this._onDidChangeTreeData.fire(undefined);
	}

	private all(filter: (source: Source) => boolean = () => true): RecipeNode[] {
		return (['project', 'user', 'builtin'] as const)
			.filter(filter)
			.flatMap(source => this.recipesOf(source).map<RecipeNode>(recipe => ({ kind: 'recipe', source, recipe })));
	}

	/** QuickPick over the recipes, grouped like the view. */
	private async choose(title: string, placeHolder: string, filter?: (source: Source) => boolean): Promise<RecipeNode | undefined> {
		const nodes = this.all(filter);
		if (!nodes.length) {
			vscode.window.showInformationMessage('Aucune recette ici pour l\'instant.');
			return undefined;
		}
		const items: (vscode.QuickPickItem & { node?: RecipeNode })[] = [];
		let previous: Source | undefined;
		for (const node of nodes) {
			if (node.source !== previous) {
				items.push({ label: GROUPS[node.source].label, kind: vscode.QuickPickItemKind.Separator });
				previous = node.source;
			}
			items.push({ label: `$(${node.recipe.icon}) ${node.recipe.name}`, description: node.recipe.description, node });
		}
		const pick = await vscode.window.showQuickPick(items, { title, placeHolder, matchOnDescription: true });
		return pick?.node;
	}

	private async run(node?: Node): Promise<void> {
		const target = node?.kind === 'recipe' ? node : await this.choose('Recettes', 'Quelle recette envoyer à Claude ?');
		if (!target) {
			return;
		}
		const text = await this.fill(target.recipe);
		if (!text) {
			return;
		}
		const terminal = this.claude.current();
		if (!terminal) {
			// A Claude still starting would drop typed text: the recipe is its first prompt.
			this.claude.create({ flags: [text] });
			return;
		}
		terminal.show();
		this.claude.sendMessage(terminal, text);
	}

	/** Replaces the `{{…}}` variables of a recipe; undefined when a value is missing or the user gave up. */
	private async fill(recipe: Recipe): Promise<string | undefined> {
		const matches = [...recipe.prompt.matchAll(/\{\{\s*(?<name>[^\s:{}]+)\s*(?::\s*(?<label>[^{}]*?))?\s*\}\}/g)];
		const editor = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0];
		const values = new Map<string, string>();
		for (const match of matches) {
			const name = variableName(match.groups?.name ?? '');
			const label = match.groups?.label?.trim() ?? '';
			const key = `${name}:${label}`;
			if (values.has(key)) {
				continue;
			}
			if (name === 'fichier') {
				if (!editor || editor.document.uri.scheme !== 'file') {
					vscode.window.showWarningMessage(`La recette « ${recipe.name} » travaille sur un fichier : ouvre (et enregistre) le fichier voulu dans l'éditeur, puis relance-la.`);
					return undefined;
				}
				values.set(key, vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/'));
			} else if (name === 'selection') {
				const selection = editor ? editor.document.getText(editor.selection) : '';
				if (!selection.trim()) {
					vscode.window.showWarningMessage(`La recette « ${recipe.name} » travaille sur une sélection : sélectionne du texte dans l'éditeur, puis relance-la.`);
					return undefined;
				}
				values.set(key, selection);
			} else if (name === 'dossier') {
				const folder = (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)) ?? vscode.workspace.workspaceFolders?.[0];
				if (!folder) {
					vscode.window.showWarningMessage(`La recette « ${recipe.name} » travaille sur le dossier du projet : ouvre un dossier, puis relance-la.`);
					return undefined;
				}
				values.set(key, folder.uri.fsPath);
			} else if (name === 'question') {
				const answer = await vscode.window.showInputBox({
					title: recipe.name,
					prompt: label || 'Précision pour Claude',
					ignoreFocusOut: true,
					validateInput: value => value.trim() ? undefined : 'Réponds pour continuer, ou Échap pour annuler',
				});
				if (answer === undefined) {
					return undefined;
				}
				values.set(key, answer.trim());
			}
		}
		// One pass over the original text: a value that itself contains `{{…}}` is never expanded again.
		let text = '';
		let last = 0;
		for (const match of matches) {
			const value = values.get(`${variableName(match.groups?.name ?? '')}:${match.groups?.label?.trim() ?? ''}`);
			text += recipe.prompt.slice(last, match.index) + (value ?? match[0]);
			last = match.index + match[0].length;
		}
		return (text + recipe.prompt.slice(last)).trim();
	}

	private async add(node?: Node, prompt?: string): Promise<void> {
		const name = await vscode.window.showInputBox({
			title: prompt === undefined ? 'Nouvelle recette (1/2)' : 'Enregistrer la sélection comme recette',
			prompt: 'Nom de la recette',
			placeHolder: 'ex. : Traduire le fichier en anglais',
			ignoreFocusOut: true,
			validateInput: value => value.trim() ? undefined : 'Donne un nom à la recette',
		});
		if (!name) {
			return;
		}
		if (prompt === undefined) {
			prompt = await vscode.window.showInputBox({
				title: 'Nouvelle recette (2/2)',
				prompt: 'Consigne envoyée à Claude. Variables : {{fichier}}, {{selection}}, {{dossier}}, {{question: Intitulé}}',
				placeHolder: 'ex. : Traduis @{{fichier}} en anglais sans toucher au code',
				ignoreFocusOut: true,
				validateInput: value => value.trim() ? undefined : 'Écris la consigne',
			});
			if (!prompt) {
				return;
			}
		}
		const source = await this.destination(node);
		const file = source && this.fileOf(source);
		if (!source || !file) {
			return;
		}
		const text = prompt;
		let id = '';
		const written = await this.write(file, list => {
			id = uniqueId(list, slug(name));
			list.push({ id, name: name.trim(), description: '', icon: DEFAULT_ICON, prompt: text });
		});
		if (!written) {
			return;
		}
		const choice = await vscode.window.showInformationMessage(`Recette « ${name.trim()} » ajoutée dans « ${GROUPS[source].label} ».`, 'Modifier (icône, description)');
		if (choice) {
			await this.openAt(file, id, name.trim());
		}
	}

	/** Where a new recipe goes: the group it was added from, else the user's choice. */
	private async destination(node?: Node): Promise<FileSource | undefined> {
		if (node && node.source !== 'builtin' && this.fileOf(node.source)) {
			return node.source;
		}
		if (!this.fileOf('project')) {
			return 'user';
		}
		const pick = await vscode.window.showQuickPick([
			{ label: `$(${GROUPS.user.icon}) ${GROUPS.user.label}`, detail: 'Pour toi, dans tous tes projets (~/.orbit/recipes.json)', source: 'user' as const },
			{ label: `$(${GROUPS.project.icon}) ${GROUPS.project.label}`, detail: 'Dans ce projet, à partager avec l\'équipe (.orbit/recipes.json)', source: 'project' as const },
		], { title: 'Où enregistrer la recette ?' });
		return pick?.source;
	}

	private async saveSelection(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const selection = editor ? editor.document.getText(editor.selection) : '';
		if (!selection.trim()) {
			vscode.window.showWarningMessage('Sélectionne d\'abord dans l\'éditeur le texte à enregistrer comme recette.');
			return;
		}
		await this.add(undefined, selection.trim());
	}

	private async edit(node?: Node): Promise<void> {
		const target = node?.kind === 'recipe' ? node : await this.choose('Modifier une recette', 'Quelle recette modifier ?');
		if (!target) {
			return;
		}
		if (target.source !== 'builtin') {
			const file = this.fileOf(target.source);
			if (file) {
				await this.openAt(file, target.recipe.id, target.recipe.name);
			}
			return;
		}
		// Orbit's own recipes are read-only: a copy in the user's file is the one to change.
		const choice = await vscode.window.showInformationMessage(`« ${target.recipe.name} » est fournie avec Orbit. La copier dans « ${GROUPS.user.label} » pour la modifier ?`, { modal: true }, 'Copier et modifier');
		const file = this.fileOf('user');
		if (!choice || !file) {
			return;
		}
		let id = '';
		const written = await this.write(file, list => {
			id = uniqueId(list, target.recipe.id);
			list.push({ ...target.recipe, id });
		});
		if (written) {
			await this.openAt(file, id, target.recipe.name);
		}
	}

	private async delete(node?: Node): Promise<void> {
		const target = node?.kind === 'recipe' ? node : await this.choose('Supprimer une recette', 'Quelle recette supprimer ?', source => source !== 'builtin');
		if (!target) {
			return;
		}
		const file = target.source === 'builtin' ? undefined : this.fileOf(target.source);
		if (!file) {
			vscode.window.showInformationMessage('Les recettes fournies avec Orbit ne se suppriment pas.');
			return;
		}
		const choice = await vscode.window.showWarningMessage(`Supprimer la recette « ${target.recipe.name} » de « ${GROUPS[target.source].label} » ?`, { modal: true }, 'Supprimer');
		if (!choice) {
			return;
		}
		await this.write(file, list => {
			const found = normalise(list).entries.find(entry => entry.recipe.id === target.recipe.id);
			if (found) {
				list.splice(found.index, 1);
			}
		});
	}

	/**
	 * Changes the recipe list of a file and saves it. A file that does not parse is
	 * left untouched: rewriting it would throw away what the user typed.
	 */
	private async write(file: string, change: (list: unknown[]) => void): Promise<boolean> {
		let root: unknown = { recipes: [] };
		try {
			root = JSON.parse(stripBom(await fs.promises.readFile(file, 'utf8')));
		} catch (err) {
			if (!isMissing(err)) {
				const choice = await vscode.window.showErrorMessage(`Impossible de modifier ${file} : ${err instanceof SyntaxError ? 'son JSON est invalide, corrige-le d\'abord' : firstLine(err)}.`, 'Ouvrir le fichier');
				if (choice) {
					await vscode.window.showTextDocument(vscode.Uri.file(file));
				}
				return false;
			}
		}
		let list = listOf(root);
		if (!list) {
			// An object without `recipes` (or anything else): keep its other keys and add the list.
			list = [];
			root = isRecord(root) ? { ...root, recipes: list } : { recipes: list };
		}
		change(list);
		try {
			await fs.promises.mkdir(path.dirname(file), { recursive: true });
			await fs.promises.writeFile(file, `${JSON.stringify(root, undefined, '\t')}\n`);
		} catch (err) {
			vscode.window.showErrorMessage(`Impossible d'écrire ${file} : ${firstLine(err)}`);
			return false;
		}
		this.reload();
		return true;
	}

	/** Opens a recipes file with the given recipe selected. */
	private async openAt(file: string, id: string, name: string): Promise<void> {
		let document: vscode.TextDocument;
		try {
			document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		} catch (err) {
			vscode.window.showErrorMessage(`Impossible d'ouvrir ${file} : ${firstLine(err)}`);
			return;
		}
		const text = document.getText();
		const at = [`"id"\\s*:\\s*${escapeRegExp(JSON.stringify(id))}`, `"name"\\s*:\\s*${escapeRegExp(JSON.stringify(name))}`]
			.map(pattern => text.search(new RegExp(pattern)))
			.find(index => index >= 0);
		const line = at === undefined ? undefined : document.lineAt(document.positionAt(at).line);
		const editor = await vscode.window.showTextDocument(document, line ? { selection: line.range } : undefined);
		if (line) {
			editor.revealRange(line.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		}
	}
}

/** Reads a recipes file; a missing file is simply an empty list. */
function loadFile(file: string): Loaded {
	let text: string;
	try {
		text = stripBom(fs.readFileSync(file, 'utf8'));
	} catch (err) {
		return isMissing(err) ? { recipes: [] } : { recipes: [], error: `Fichier illisible (${firstLine(err)})` };
	}
	if (!text.trim()) {
		return { recipes: [] };
	}
	let root: unknown;
	try {
		root = JSON.parse(text);
	} catch (err) {
		return { recipes: [], error: `JSON invalide (${firstLine(err)})` };
	}
	const list = listOf(root);
	if (!list) {
		return { recipes: [], error: 'Format inattendu : il faut { "recipes": [ … ] }' };
	}
	const { entries, skipped } = normalise(list);
	return {
		recipes: entries.map(entry => entry.recipe),
		error: skipped ? `${skipped} ${skipped > 1 ? 'recettes ignorées' : 'recette ignorée'} : "name" et "prompt" sont obligatoires` : undefined,
	};
}

/** The recipe array of a parsed file: `{ "recipes": [...] }`, or a bare array. */
function listOf(root: unknown): unknown[] | undefined {
	if (Array.isArray(root)) {
		return root;
	}
	return isRecord(root) && Array.isArray(root.recipes) ? root.recipes : undefined;
}

/** Valid recipes of a raw list with their position in it; ids are made up when absent and kept unique. */
function normalise(list: unknown[]): { entries: { recipe: Recipe; index: number }[]; skipped: number } {
	const entries: { recipe: Recipe; index: number }[] = [];
	const used = new Set<string>();
	let skipped = 0;
	list.forEach((entry, index) => {
		if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.prompt !== 'string' || !entry.prompt.trim()) {
			skipped++;
			return;
		}
		const base = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : slug(entry.name);
		let id = base;
		for (let i = 2; used.has(id); i++) {
			id = `${base}-${i}`;
		}
		used.add(id);
		const icon = typeof entry.icon === 'string' ? entry.icon.trim().replace(/^\$\((?<id>.*)\)$/, '$<id>') : '';
		entries.push({
			index,
			recipe: {
				id,
				name: entry.name.trim(),
				description: typeof entry.description === 'string' ? entry.description.trim() : '',
				icon: /^[a-z][a-z0-9-]*$/.test(icon) ? icon : DEFAULT_ICON,
				prompt: entry.prompt,
			},
		});
	});
	return { entries, skipped };
}

function uniqueId(list: unknown[], base: string): string {
	const used = new Set(normalise(list).entries.map(entry => entry.recipe.id));
	let id = base;
	for (let i = 2; used.has(id); i++) {
		id = `${base}-${i}`;
	}
	return id;
}

function slug(name: string): string {
	return withoutAccents(name.toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'recette';
}

/** `Sélection` and `SELECTION` are the same variable as `selection`. */
function variableName(name: string): string {
	return withoutAccents(name.toLowerCase());
}

function withoutAccents(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissing(err: unknown): boolean {
	return isRecord(err) && err.code === 'ENOENT';
}

function firstLine(err: unknown): string {
	return (err instanceof Error ? err.message : String(err)).split('\n')[0];
}

/** Files saved by Windows tools often start with a byte order mark, which JSON.parse rejects. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
