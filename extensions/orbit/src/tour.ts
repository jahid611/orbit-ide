/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { assistant } from './assistant';

interface Stop {
	chapter: string;
	title: string;
	body: string;
	/** Shortcut shown as a chip: macOS form, then the Windows and Linux form. */
	keys?: [string, string];
	/** Commands that bring the feature on screen. They only open things: a stop never starts work. */
	show?: string[];
	/** The stop opens a page in the editor area: it is closed when the tour moves on. */
	page?: boolean;
	/** CSS selector, in the workbench, of the element the stop talks about. */
	target?: string;
}

const SEEN_KEY = 'orbit.tour.seen';
const statusItem = (id: string) => `#vscode\\.orbit\\.${id.replace(/\./g, '\\.')}, [id="vscode.orbit.${id}"]`;
const toolbar = (label: string) => `.part.panel .action-label[aria-label^="${label}"], .part.auxiliarybar .action-label[aria-label^="${label}"]`;
const activity = (label: string) => `.activitybar .action-item:has(.action-label[aria-label^="${label}"])`;

/** Every stop of the circuit, in the order a newcomer meets the features. */
function stops(ai: string): Stop[] {
	return [
		{ chapter: 'Bienvenue', title: 'Bienvenue dans Orbit', body: `Orbit est un éditeur construit autour de ${ai} : l'IA tourne dans de vrais terminaux, et l'éditeur sait à chaque instant ce que fait chaque agent.\nCe circuit passe par toutes les fonctions, une par une, en les ouvrant pour de vrai. Tu peux déplacer cette carte en la tirant par le haut.` },

		{ chapter: 'Les agents', title: `Le terminal ${ai}`, body: `Ton IA vit ici, dans le panneau de droite. C'est le vrai programme, pas une imitation : tout ce que tu sais faire en ligne de commande marche pareil.\nL'onglet montre son état : en train de travailler, en attente de ta réponse, ou terminé.`, keys: ['⌘L', 'Ctrl+L'], show: ['orbit.claude.focus'], target: '.part.panel .terminal-outer-container, .part.auxiliarybar .terminal-outer-container' },
		{ chapter: 'Les agents', title: 'Plusieurs agents à la fois', body: 'Ouvre autant d\'agents que tu veux : un nouveau terminal, deux côte à côte, ou une grille de 2, 3, 4 ou 6 agents d\'un coup. Chacun peut aussi travailler dans sa propre copie du projet (« worktree ») pour ne gêner personne.', keys: ['⌥⌘N nouveau · ⌥⌘G grille · ⌥⌘A organiser', 'Ctrl+Alt+N nouveau · Ctrl+Alt+G grille · Ctrl+Alt+A organiser'] },
		{ chapter: 'Les agents', title: 'Modèle, mode et tout en auto', body: 'En haut du panneau : le modèle utilisé (clic pour en changer), et l\'éclair qui passe tous les agents en mode auto d\'un coup. Les agents qui attendent une réponse sont laissés tranquilles.', show: ['orbit.claude.focus'], target: toolbar('Changer de modèle') },
		{ chapter: 'Les agents', title: 'Choisir son IA', body: 'Orbit marche avec Claude ou avec ChatGPT (Codex), une seule à la fois. Ce bouton bascule en un clic : logos, modèles, jauge et textes suivent, le reste ne bouge pas.', target: statusItem('orbit.assistant') },
		{ chapter: 'Les agents', title: 'Ta consommation, en direct', body: 'La jauge de ton abonnement (session et semaine) reste visible ici. Un clic ouvre le détail. Orbit passe toujours par ton abonnement, jamais par une clé facturée à l\'usage.', target: statusItem('orbit.usage') },
		{ chapter: 'Les agents', title: 'La vue discussion', body: 'Tu préfères une conversation à un terminal ? La vue discussion habille le même agent : mêmes messages, mêmes autorisations, avec des boutons. On bascule de l\'une à l\'autre quand on veut.', keys: ['⌥⌘T', 'Ctrl+Alt+T'], target: toolbar('Vue discussion') },
		{ chapter: 'Les agents', title: 'Envoyer du code ou une capture', body: 'Sélectionne du code et envoie-le à l\'agent avec sa référence exacte. Et colle une capture d\'écran directement dans le terminal : elle est jointe au message.', keys: ['⇧⌘L envoyer la sélection · ⌘V coller une capture', 'Ctrl+Maj+L envoyer la sélection · Ctrl+V coller une capture'] },

		{ chapter: 'Suivre le travail', title: 'Discussions, équipe, frise, recettes', body: 'Cet onglet regroupe tout ce qui concerne tes agents : l\'équipe en cours, tes discussions passées (reprise en un clic), la frise du projet et tes recettes.', show: ['workbench.view.extension.orbit-sessions'], target: activity('Discussions') },
		{ chapter: 'Suivre le travail', title: 'La machine à remonter le temps', body: 'À chaque message, Orbit photographie le projet. La frise montre ce que chaque tour a changé, fichier par fichier, et permet de revenir en arrière — tout le tour, ou un seul fichier. Ton dépôt git n\'est jamais touché.', show: ['orbit.timeline.focus'], target: '.pane-header[aria-label^="Frise"]' },
		{ chapter: 'Suivre le travail', title: 'Les recettes', body: 'Des consignes prêtes à l\'emploi (relire, tester, documenter, créer un composant…) à envoyer en un clic. Ajoute les tiennes, pour toi ou pour le projet.', keys: ['⌥⌘J', 'Ctrl+Alt+J'], show: ['orbit.recipes.focus'], target: '.pane-header[aria-label^="Recettes"]' },
		{ chapter: 'Suivre le travail', title: 'Qui touche à quoi', body: 'Dans l\'explorateur, chaque fichier lu ou modifié par un agent porte sa pastille. Si deux agents modifient le même fichier, Orbit t\'alerte tout de suite. Et « Suivre » ouvre les fichiers au fur et à mesure que l\'agent les écrit.', show: ['workbench.view.explorer'], target: activity('Explorer') },
		{ chapter: 'Suivre le travail', title: 'La vue Orbite', body: 'Ta tour de contrôle : le projet au centre, chaque agent en planète, ses fichiers en lunes, les collisions en rouge. Un clic t\'emmène au terminal ou au fichier.', keys: ['⌥⌘O', 'Ctrl+Alt+O'], show: ['orbit.map.show'], page: true },

		{ chapter: 'Coder plus vite', title: 'L\'édition en ligne', body: 'Dans un fichier, sélectionne du code, appuie sur le raccourci et décris le changement : la modification apparaît sur place, à accepter ou à rejeter.', keys: ['⌘K', 'Ctrl+K'] },
		{ chapter: 'Coder plus vite', title: 'La vérification automatique', body: 'Quand un agent a fini d\'écrire, Orbit lance les contrôles du projet (types, lint, tests). En cas d\'échec, l\'erreur peut repartir toute seule chez l\'agent. Et dans le panneau Problèmes, un bouton fait corriger n\'importe quelle erreur.', target: statusItem('orbit.verify') },
		{ chapter: 'Coder plus vite', title: 'Le commit intelligent', body: 'Dans le Contrôle de source, le bouton au logo de ton IA lit tes changements et rédige le message de commit, dans le style des précédents.', keys: ['⌥⌘M', 'Ctrl+Alt+M'], show: ['workbench.view.scm'], target: activity('Source Control') },

		{ chapter: 'Déléguer', title: 'Le chef d\'équipe', body: `Un ${ai} qui pilote les autres : il crée des agents, leur donne un rôle, leur écrit, lit leurs réponses et te rend compte. Tu parles à une seule IA, elle fait travailler toute l'équipe.`, keys: ['⌥⌘C', 'Ctrl+Alt+C'], target: statusItem('orbit.team') },
		{ chapter: 'Déléguer', title: 'Le chef d\'orchestre', body: 'Pour une grosse tâche : Orbit la découpe en 2 à 4 morceaux qui ne se marchent pas dessus, lance un agent par morceau dans sa propre copie du projet, puis fusionne le tout.\nDans la palette : « Chef d\'orchestre ».' },
		{ chapter: 'Déléguer', title: 'Le tableau de tâches', body: 'Un kanban du projet : dépose des cartes dans « À faire », tes agents les prennent, les traitent et les passent dans « À vérifier » avec leur compte rendu. Toi seul décides de ce qui est « Fait ».', show: ['orbit.board.show'], page: true },
		{ chapter: 'Déléguer', title: 'La file de nuit', body: 'Empile des tâches, lance, va dormir. Elles s\'enchaînent une par une, chacune dans un agent neuf, avec des garde-fous. Au matin, un compte rendu par tâche t\'attend.', keys: ['⌥⌘Q', 'Ctrl+Alt+Q'], show: ['orbit.queue.show'], page: true },
		{ chapter: 'Déléguer', title: 'Orbit sur ton téléphone', body: 'Scanne un code, et ton téléphone te prévient quand un agent attend ta réponse, quand il a fini, ou quand la file de nuit est terminée.', show: ['orbit.phone.setup'], page: true },

		{ chapter: 'Construire', title: 'La vue vivante', body: 'Ton site ou ton app, en direct dans Orbit, sur 14 appareils réels. Clique un élément de la page : Orbit retrouve le code qui le dessine et l\'envoie à l\'agent avec ta demande.', keys: ['⌥⌘V', 'Ctrl+Alt+V'], show: ['orbit.preview.show'], page: true },
		{ chapter: 'Construire', title: 'L\'agent se relit avec ses yeux', body: 'Quand un agent modifie l\'interface, Orbit photographie la page avant et après et lui donne les deux images : il voit ce qu\'il a vraiment produit et corrige ce qui déborde ou se chevauche.', show: ['orbit.visual.show'], page: true },
		{ chapter: 'Construire', title: 'La base de données', body: 'SQLite et PostgreSQL : tables, schéma en cartes reliées, modifications en attente appliquées d\'un coup. Décris une requête en français, l\'IA l\'écrit ; toute écriture demande ton accord.', keys: ['⌥⌘D', 'Ctrl+Alt+D'], show: ['orbit.database.show'], page: true },
		{ chapter: 'Construire', title: 'Vercel : en ligne en un clic', body: 'Un clic sur « Publier » : commit, envoi sur GitHub, construction et mise en ligne. La page reprend le tableau de bord Vercel : capture du site, domaines, déploiements, journal de construction.', show: ['orbit.vercel.show'], page: true, target: toolbar('Vercel') },
		{ chapter: 'Construire', title: 'Les variables d\'environnement', body: 'Tes clés et mots de passe sur une page : valeurs masquées, exclues de git, envoyées vers Vercel en un clic. Les agents n\'en voient que les noms, jamais les valeurs.', show: ['orbit.env.show'], page: true },
		{ chapter: 'Construire', title: 'Supabase et Stripe', body: 'Base de données, comptes utilisateurs et paiements, reliés en un clic. Orbit range les clés au bon endroit, te signale une table sans protection, crée un produit et son lien de paiement, puis demande à l\'agent de tout brancher.', show: ['orbit.supabase.show'], page: true },
		{ chapter: 'Construire', title: 'Figma vers code', body: 'Colle le lien d\'une maquette : ton agent la lit avec le connecteur officiel de Figma et construit l\'écran avec ce que le projet utilise déjà.', show: ['orbit.figma.show'], page: true },
		{ chapter: 'Construire', title: 'Higgsfield : images, vidéos, 3D, sons', body: 'Décris ce que tu veux : l\'IA le génère avec ton compte Higgsfield et le fichier arrive dans le projet, prêt à servir dans ton code, ton montage ou ton jeu.', keys: ['⌥⌘H', 'Ctrl+Alt+H'], show: ['orbit.higgsfield.show'], page: true, target: toolbar('Higgsfield') },

		{ chapter: 'Créer', title: 'StarCapture : le montage vidéo', body: 'Un vrai éditeur vidéo dans Orbit : timeline, textes, transitions, sous-titres karaoké, suppression des silences, enregistrement d\'écran. Et l\'IA peut monter à ta place.', keys: ['⌥⌘S', 'Ctrl+Alt+S'], show: ['workbench.view.extension.starcapture'], page: true, target: activity('StarCapture') },
		{ chapter: 'Créer', title: 'NovaGame : l\'atelier de jeux', body: 'Crée un jeu Unity sans quitter Orbit : bac à sable prêt à l\'emploi, installation de Unity guidée s\'il manque, scène visible et jouable ici, et l\'IA qui manipule la scène avec toi.', show: ['workbench.view.extension.novagame'], target: activity('NovaGame') },
		{ chapter: 'Créer', title: 'Le magasin de compétences', body: 'De nouveaux outils pour ton agent en un clic : GitHub, Sentry, Linear, Notion, Playwright… et des paquets de recettes prêtes à l\'emploi. La communauté peut publier les siens.', show: ['orbit.store.show'], page: true, target: toolbar('Outils du projet') },
		{ chapter: 'Créer', title: 'La communauté', body: 'Pars d\'un projet partagé par un autre utilisateur d\'Orbit, ou partage le tien : Orbit retire tes secrets avant de publier et te demande deux fois confirmation.', show: ['orbit.community.show'], page: true },

		{ chapter: 'Chez toi', title: 'Le Studio de personnalisation', body: 'Thèmes, couleur d\'accent, fond d\'écran, dispositions, polices, terminaux : tout se règle ici, avec aperçu immédiat. Ton profil s\'exporte et s\'importe.', keys: ['⌥⌘,', 'Ctrl+Alt+,'], show: ['orbit.openStudio'], page: true },
		{ chapter: 'Chez toi', title: `${ai} pilote aussi Orbit`, body: 'Dernier secret : ton IA peut manœuvrer Orbit elle-même. Demande-lui « ouvre la vue vivante », « montre-moi ce fichier » ou « passe sur mon autre projet » : elle le fait.' },
		{ chapter: 'C\'est parti', title: 'Tu connais tout Orbit', body: 'Tu peux refaire ce circuit quand tu veux : dans la palette de commandes, tape « circuit ».\nLe plus simple pour commencer : dis à ton IA ce que tu veux construire.', keys: ['⇧⌘P palette de commandes', 'Ctrl+Maj+P palette de commandes'], show: ['orbit.claude.focus'] },
	];
}

/**
 * The discovery circuit: a guided tour through every feature of Orbit. Each stop brings the real
 * feature on screen and explains it on a card floating over the window (drawn by the workbench,
 * `_orbit.tour`). Offered once at first launch, and available at any time from the palette.
 */
export class Tour implements vscode.Disposable {

	private list: Stop[] = [];
	private index = -1;
	/** A stop is being brought on screen: clicks made meanwhile are ignored, so stops never overlap. */
	private moving = false;
	/** The tabs that were open before the current stop opened its page. */
	private before = new Set<vscode.Tab>();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly context: vscode.ExtensionContext) {
		this.disposables.push(
			vscode.commands.registerCommand('orbit.tour.start', () => this.start()),
			vscode.commands.registerCommand('orbit.tour.next', () => this.go(this.index + 1)),
			vscode.commands.registerCommand('orbit.tour.previous', () => this.go(this.index - 1)),
			vscode.commands.registerCommand('orbit.tour.stop', () => this.stop()),
		);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}

	/**
	 * First launch: the circuit starts by itself, once. Only where the workbench can draw the card:
	 * as a row of plain messages, thirty stops are for someone who asked for them.
	 */
	async offerOnce(): Promise<void> {
		if (!this.context.globalState.get<boolean>(SEEN_KEY) && (await vscode.commands.getCommands(false)).includes('_orbit.tour')) {
			await this.start();
		}
	}

	async start(): Promise<void> {
		await this.context.globalState.update(SEEN_KEY, true);
		this.list = stops(assistant().name);
		this.index = -1;
		await this.go(0);
	}

	private async leave(): Promise<void> {
		const stop = this.list[this.index];
		// The pages a stop opened are closed again, so the circuit leaves the editor as it found it.
		if (stop?.page) {
			const opened = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => !this.before.has(tab) && (tab.input instanceof vscode.TabInputWebview || tab.input instanceof vscode.TabInputCustom));
			if (opened.length) {
				await vscode.window.tabGroups.close(opened, true);
			}
		}
	}

	private async go(index: number): Promise<void> {
		if (!this.list.length || index < 0) {
			return;
		}
		if (index >= this.list.length) {
			return this.stop();
		}
		if (this.moving) {
			return;
		}
		this.moving = true;
		const stop = this.list[index];
		try {
			await this.leave();
			this.index = index;
			this.before = new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs));
			for (const command of stop.show ?? []) {
				try {
					await vscode.commands.executeCommand(command);
				} catch {
					// a feature that cannot open here (no project, missing tool) is still explained
				}
			}
		} finally {
			this.moving = false;
		}
		const last = index === this.list.length - 1;
		const step = {
			index,
			total: this.list.length,
			chapter: stop.chapter,
			title: stop.title,
			body: stop.body,
			keys: stop.keys?.[process.platform === 'darwin' ? 0 : 1],
			target: stop.target,
			labels: { next: last ? 'Terminer' : 'Suivant', previous: 'Précédent', stop: 'Quitter le circuit' },
			commands: { next: 'orbit.tour.next', previous: 'orbit.tour.previous', stop: 'orbit.tour.stop' },
		};
		try {
			await vscode.commands.executeCommand('_orbit.tour', step);
		} catch {
			// An Orbit whose workbench does not draw the card yet: the same stop, as a plain message.
			const choice = await vscode.window.showInformationMessage(`${index + 1}/${this.list.length} · ${stop.title} — ${stop.body.replace(/\n/g, ' ')}${step.keys ? ` (${step.keys})` : ''}`, step.labels.next, ...(index ? [step.labels.previous] : []));
			if (this.index !== index) {
				return;
			}
			if (choice === step.labels.next) {
				await this.go(index + 1);
			} else if (choice === step.labels.previous) {
				await this.go(index - 1);
			} else {
				this.index = -1;
				this.list = [];
			}
		}
	}

	private async stop(): Promise<void> {
		await this.leave();
		this.index = -1;
		this.list = [];
		try {
			await vscode.commands.executeCommand('_orbit.tour', undefined);
		} catch {
			// nothing was drawn
		}
	}
}
