---
title: Réglages
description: Tous les réglages d'Orbit, avec leur valeur par défaut.
order: 2
icon: settings
---

Les réglages se changent dans les paramètres d'Orbit (`Ctrl+,`), en cherchant leur nom, ou dans le fichier `settings.json`. Beaucoup se règlent aussi depuis le [Studio](/docs/personnaliser/studio).

> **À savoir** Cette page est écrite automatiquement d'après les extensions d'Orbit : elle est toujours à jour avec la version décrite par ce site.

## Orbit

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.assistant` | `"claude"` | L'IA avec laquelle Orbit travaille. Une seule à la fois : terminaux, modèles, logo, jauge d'utilisation et textes suivent ce choix. Valeurs : `claude`, `chatgpt`. |
| `orbit.board.parallel` | `2` | Tableau de tâches : nombre d'agents qui travaillent en même temps avec « Tout lancer ». |
| `orbit.chatgpt.extraArgs` | `""` | Arguments ajoutés à la ligne de commande de Codex. |
| `orbit.chatgpt.model` | `""` | Modèle des nouveaux terminaux quand Orbit travaille avec ChatGPT. Vide : celui de Codex. |
| `orbit.chatgpt.path` | `"codex"` | Programme Codex lancé quand Orbit travaille avec ChatGPT. |
| `orbit.claude.autoStart` | `true` | Open a terminal with Claude running when a project opens. |
| `orbit.claude.billing` | `"subscription"` | How the agent is billed. Valeurs : `subscription`, `apiKey`. |
| `orbit.claude.extraArgs` | `""` | Extra command-line flags for claude, e.g. --verbose. |
| `orbit.claude.followAgent` | `true` | Follow the agent you are looking at: open each file it writes, reveal it in the explorer and light up the lines it changes as they land. |
| `orbit.claude.followFolder` | `"auto"` | When Claude works in a folder the explorer does not show. Valeurs : `auto`, `ask`, `off`. |
| `orbit.claude.language` | `""` | Language Claude answers in (added to the system prompt). Empty keeps Claude Code's behaviour. |
| `orbit.claude.model` | `""` | Model passed to new Claude terminals (--model). Valeurs : ``, `opus`, `sonnet`, `haiku`, `claude-fable-5-1`. |
| `orbit.claude.path` | `"claude"` | Path to the Claude Code CLI. The agent uses your logged-in Claude account (run `claude` once in a terminal to sign in). |
| `orbit.claude.permissionMode` | `""` | Permission mode for new Claude terminals (--permission-mode). Valeurs : ``, `acceptEdits`, `plan`, `auto`. |
| `orbit.claude.persona` | `""` | Extra instructions appended to Claude's system prompt in every terminal. |
| `orbit.claude.projectsFolder` | `""` | Where new Orbit projects are created. Empty uses ~/Orbit. |
| `orbit.claude.resumeOnOpen` | `true` | À l'ouverture d'un projet, reprendre sa dernière discussion au lieu d'en commencer une nouvelle. Les discussions restent de toute façon dans la vue « Discussions ». |
| `orbit.claude.revealNewFiles` | `true` | Reveal files created in the project in the explorer and preview them, without leaving the terminal. |
| `orbit.env.hideFromAgent` | `true` | Interdit à Claude Code de lire les fichiers .env du projet (sauf .env.example). Les valeurs se gèrent dans la page « Variables d'environnement » ; l'agent n'en connaît que les noms. S'applique aux agents lancés ensuite. |
| `orbit.higgsfield.enabled` | `true` | Higgsfield dans Orbit. Désactivé (bouton de déconnexion du studio) : le studio est fermé et les agents lancés ensuite n'ont plus les outils Higgsfield, même si le compte reste relié à claude.ai. |
| `orbit.higgsfield.folder` | `"assets/higgsfield"` | Dossier du projet où arrivent les fichiers générés avec Higgsfield. |
| `orbit.higgsfield.simulateDisconnected` | `false` | Mode test : le studio Higgsfield fait comme si le compte n'était pas relié, pour essayer le parcours de connexion d'un nouvel utilisateur. |
| `orbit.inlineEdit.model` | `"sonnet"` | Model used for inline edits (Cmd+K). A faster model feels snappier. Valeurs : `opus`, `sonnet`, `haiku`, `claude-fable-5-1`. |
| `orbit.phone.done` | `true` | Téléphone : prévenir quand un long travail est terminé et qu'Orbit n'est pas au premier plan. |
| `orbit.phone.queue` | `true` | Téléphone : prévenir à la fin de la file de nuit. |
| `orbit.phone.topic` | `""` | Sujet ntfy privé des notifications sur le téléphone. Vide : désactivé. Se règle sur la page « Orbit sur ton téléphone ». |
| `orbit.phone.waiting` | `true` | Téléphone : prévenir quand un agent attend ton accord. |
| `orbit.project.openIn` | `"ask"` | Où s'ouvre un autre projet quand la fenêtre en montre déjà un. Valeurs : `ask`, `newWindow`, `replace`. |
| `orbit.queue.taskMinutes` | `90` | File de nuit : durée maximale d'une tâche, en minutes, avant de passer à la suivante. |
| `orbit.timeMachine.enabled` | `true` | Take a save point of the project each time a message is sent to an agent, so it can be rewound. Save points live outside the project and never touch its git repository. |
| `orbit.update.mode` | `"notify"` | Mises à jour d'Orbit, publiées sur GitHub. Valeurs : `notify`, `off`. |
| `orbit.verify.mode` | `"notify"` | Automatic verification of Claude's work (types, lint, tests). Valeurs : `notify`, `auto`, `off`. |
| `orbit.verify.timeoutSeconds` | `180` | Longest time a single check may run before Orbit stops it. |
| `orbit.visualCheck.mode` | `"auto"` | Relecture visuelle : que faire quand un agent a modifié l'interface et que la page tourne en local. Valeurs : `auto`, `notify`, `off`. |
| `orbit.visualCheck.url` | `""` | Relecture visuelle : adresse de la page à photographier (par exemple http://localhost:3000/tarifs). Vide : le premier serveur local trouvé. |

## StarCapture

| Réglage | Défaut | Effet |
|---|---|---|
| `starcapture.exportFolder` | `""` | Dossier des exports. Vide : à côté du projet, dans « exports ». |
| `starcapture.ffmpegPath` | `""` | Chemin de ffmpeg. Vide : StarCapture le cherche (PATH, installation winget, Homebrew). |
| `starcapture.hardwareEncoding` | `true` | Encoder avec la carte graphique (NVENC, VideoToolbox, QuickSync) quand elle est disponible : exports bien plus rapides. |
| `starcapture.recordFps` | `30` | Images par seconde de l'enregistrement d'écran. |
| `starcapture.transcriptionModel` | `"small"` | Modèle Whisper des sous-titres automatiques (téléchargé une fois) : base est rapide, small un bon compromis, medium le plus juste. Valeurs : `base`, `small`, `medium`. |

## NovaGame

| Réglage | Défaut | Effet |
|---|---|---|
| `novagame.autoOpen` | `true` | Ouvrir la vue du jeu toute seule dès que Unity tourne sur le jeu ouvert. |
| `novagame.folder` | `""` | Dossier des jeux créés par NovaGame et du bac à sable. Vide : Orbit/NovaGame dans ton dossier personnel. |
| `novagame.launchUnity` | `true` | Lancer Unity tout seul quand un jeu s'ouvre. Décoché : NovaGame prépare tout et te laisse lancer Unity. |
| `novagame.unityPath` | `""` | Chemin de l'éditeur Unity (Unity.exe). Vide : NovaGame le trouve seul (Unity Hub, installations classiques). |

## Interface

Ces réglages changent l'apparence de la fenêtre. Ils se règlent le plus simplement depuis le [Studio](/docs/personnaliser/studio).

- `orbit.ui.animations`
- `orbit.ui.compactTabs`
- `orbit.ui.cornerRadius`
- `orbit.ui.customCss`
- `orbit.ui.floatingPanels`
- `orbit.ui.fontFamily`
- `orbit.ui.fontSize`
- `orbit.ui.glass`
- `orbit.ui.minimalChrome`
- `orbit.ui.panelGap`
- `orbit.ui.splashScreen`
- `orbit.ui.wallpaper`
