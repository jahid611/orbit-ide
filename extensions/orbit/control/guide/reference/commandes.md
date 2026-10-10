---
title: Commandes
description: Toutes les commandes d'Orbit, à lancer depuis la palette.
order: 1
icon: terminal
---

Ouvre la palette de commandes avec `Ctrl+Maj+P` (`⇧⌘P` sur macOS) et tape quelques lettres du nom. Les commandes qui ont un raccourci sont aussi dans la page [Raccourcis](/docs/reference/raccourcis).

> **À savoir** Cette page est écrite automatiquement d'après les extensions d'Orbit : elle est toujours à jour avec la version décrite par ce site.

## Orbit

| Commande | Identifiant |
|---|---|
| Orbit : Accept Inline Edit | `orbit.acceptInlineEdit` |
| Orbit : Actualiser | `orbit.sessions.refresh` |
| Orbit : Actualiser la frise | `orbit.time.refresh` |
| Orbit : Actualiser les recettes | `orbit.recipes.refresh` |
| Orbit : Ajouter une tâche à la file de nuit | `orbit.queue.add` |
| Orbit : Ajouter une tâche au tableau | `orbit.board.add` |
| Orbit : Aller à l'agent | `orbit.team.show` |
| Orbit : Animer avec Higgsfield | `orbit.higgsfield.animate` |
| Orbit : Annuler ce fichier seulement | `orbit.time.revertFile` |
| Orbit : Apply Layout Preset… | `orbit.applyLayoutPreset` |
| Orbit : Basculer vue discussion / terminal | `orbit.chat.toggle` |
| Orbit : Base de données : explorer et modifier avec Claude | `orbit.database.show` |
| Orbit : Changer d'IA en un clic | `orbit.assistant.toggle` |
| Orbit : Changer de modèle… | `orbit.claude.pickModel` |
| Orbit : Changer de projet ou en créer un… | `orbit.project.switch` |
| Orbit : Chef d'équipe : un Claude qui pilote tous les autres | `orbit.team.start` |
| Orbit : Chef d'orchestre : découper une tâche entre plusieurs agents… | `orbit.conductor.start` |
| Orbit : Chef d'orchestre : fusionner le travail des agents… | `orbit.conductor.merge` |
| Orbit : Choisir l'IA avec laquelle travailler | `orbit.assistant.choose` |
| Orbit : Choisir les contrôles du projet (.orbit/checks.json) | `orbit.verify.configure` |
| Orbit : Circuit de découverte : étape précédente | `orbit.tour.previous` |
| Orbit : Circuit de découverte : étape suivante | `orbit.tour.next` |
| Orbit : Circuit de découverte : quitter | `orbit.tour.stop` |
| Orbit : Circuit de découverte : visiter toutes les fonctions d'Orbit | `orbit.tour.start` |
| Orbit : Claude Agent Grid… | `orbit.claude.grid` |
| Orbit : Claude in Isolated Git Worktree… | `orbit.claude.worktree` |
| Orbit : Coller (texte, capture d'écran ou images) dans le terminal Claude | `orbit.claude.paste` |
| Orbit : Commenter ce fichier pour Claude | `orbit.time.comment` |
| Orbit : Communauté : templates des autres utilisateurs d'Orbit | `orbit.community.show` |
| Orbit : Continue Last Claude Conversation | `orbit.claude.continue` |
| Orbit : Corriger avec Claude | `orbit.problems.fix` |
| Orbit : Créer des variantes avec Higgsfield | `orbit.higgsfield.vary` |
| Orbit : Créer un point de sauvegarde | `orbit.time.snapshot` |
| Orbit : Écrire à l'agent… | `orbit.team.message` |
| Orbit : Edit Project Rules for Claude (CLAUDE.md) | `orbit.editRules` |
| Orbit : Edit with Claude (Inline) | `orbit.inlineEdit` |
| Orbit : Enregistrer la sélection comme recette… | `orbit.recipes.saveSelection` |
| Orbit : Envoyer la recette à Claude | `orbit.recipes.run` |
| Orbit : Envoyer une notification de test sur le téléphone | `orbit.phone.test` |
| Orbit : Faire corriger par Claude les problèmes de ce fichier | `orbit.problems.fixFile` |
| Orbit : Faire corriger par Claude tous les problèmes du projet | `orbit.problems.fixAll` |
| Orbit : Fermer l'agent | `orbit.team.close` |
| Orbit : Figma vers code : construire un écran à partir d'une maquette | `orbit.figma.show` |
| Orbit : File de nuit : enchaîner des tâches et lire le rapport | `orbit.queue.show` |
| Orbit : Focus Claude Terminal | `orbit.claude.focus` |
| Orbit : Higgsfield : générer images, vidéos, 3D et sons dans le projet | `orbit.higgsfield.show` |
| Orbit : Interrompre l'agent | `orbit.team.stop` |
| Orbit : Magasin de compétences : connecteurs et recettes | `orbit.store.show` |
| Orbit : Modifier la recette | `orbit.recipes.edit` |
| Orbit : New Claude Terminal | `orbit.claude.new` |
| Orbit : New Claude Terminal with Model and Mode… | `orbit.claude.withOptions` |
| Orbit : New Project with Claude… | `orbit.claude.newProject` |
| Orbit : Nouveau projet depuis un dépôt GitHub ou GitLab | `orbit.project.fromRepo` |
| Orbit : Nouvelle recette… | `orbit.recipes.add` |
| Orbit : NovaGame : studio de jeu Unity | `orbit.unity.show` |
| Orbit : Open Claude Terminal in Editor Area | `orbit.claude.inEditor` |
| Orbit : Open Customization Studio | `orbit.openStudio` |
| Orbit : Orbit sur ton téléphone : relier et régler les notifications | `orbit.phone.setup` |
| Orbit : Outils du projet : tableau, variables, Vercel, Supabase, Stripe, Figma… | `orbit.tools` |
| Orbit : Ouvrir la discussion | `orbit.sessions.open` |
| Orbit : Partager ce projet dans la communauté… | `orbit.community.share` |
| Orbit : Passer tous les Claude en mode auto | `orbit.claude.autoModeAll` |
| Orbit : Projet rapide : nouveau dossier et Claude, sans question | `orbit.claude.quickProject` |
| Orbit : Recettes : envoyer une consigne prête à l'emploi… | `orbit.recipes.pick` |
| Orbit : Rechercher une discussion… | `orbit.sessions.search` |
| Orbit : Rechercher une mise à jour d'Orbit | `orbit.update.check` |
| Orbit : Rédiger le message de commit | `orbit.git.smartCommit` |
| Orbit : Reject Inline Edit | `orbit.rejectInlineEdit` |
| Orbit : Relecture visuelle : capturer la page maintenant | `orbit.visual.now` |
| Orbit : Relecture visuelle : la page avant et après | `orbit.visual.show` |
| Orbit : Renommer | `orbit.sessions.rename` |
| Orbit : Renommer la discussion actuelle… | `orbit.sessions.renameCurrent` |
| Orbit : Resume a Claude Conversation… | `orbit.claude.resume` |
| Orbit : Revenir avant ce message | `orbit.time.rewind` |
| Orbit : Send File or Selection to Claude | `orbit.claude.sendSelection` |
| Orbit : Send Message to All Claude Terminals… | `orbit.claude.broadcast` |
| Orbit : Split Claude Terminal | `orbit.claude.split` |
| Orbit : Stripe : paiements du projet | `orbit.stripe.show` |
| Orbit : Supabase : base de données, comptes et stockage du projet | `orbit.supabase.show` |
| Orbit : Supprimer la recette | `orbit.recipes.delete` |
| Orbit : Switch Claude Terminal… | `orbit.claude.switch` |
| Orbit : Tableau de tâches : des cartes que les agents prennent et traitent | `orbit.board.show` |
| Orbit : Tutoriel : découvrir Orbit | `orbit.tutorial` |
| Orbit : Utilisation de Claude | `orbit.usage.show` |
| Orbit : Variables d'environnement : fichiers .env masqués et synchronisés | `orbit.env.show` |
| Orbit : Vercel : mettre le projet en ligne | `orbit.vercel.show` |
| Orbit : Vercel : publier maintenant | `orbit.vercel.publish` |
| Orbit : Vérification automatique : régler… | `orbit.verify.menu` |
| Orbit : Vérifier le projet maintenant (types, lint, tests) | `orbit.verify.run` |
| Orbit : Voir le changement | `orbit.time.diff` |
| Orbit : Vue discussion | `orbit.chat.show` |
| Orbit : Vue Orbite : tour de contrôle des agents | `orbit.map.show` |
| Orbit : Vue terminal | `orbit.chat.showTerminal` |
| Orbit : Vue vivante : voir et modifier l'interface en direct | `orbit.preview.show` |

## StarCapture

| Commande | Identifiant |
|---|---|
| StarCapture : Actualiser | `starcapture.refreshHome` |
| StarCapture : Ajouter au montage | `starcapture.addToMontage` |
| StarCapture : Enregistrer l'écran (démarrer / arrêter) | `starcapture.record` |
| StarCapture : Exporter la vidéo… | `starcapture.export` |
| StarCapture : Importer des vidéos, sons, images… | `starcapture.importMedia` |
| StarCapture : Monter avec Claude | `starcapture.askClaude` |
| StarCapture : Monter dans StarCapture | `starcapture.openWith` |
| StarCapture : Nouveau montage | `starcapture.newProject` |
| StarCapture : Ouvrir StarCapture | `starcapture.open` |
| StarCapture : Ouvrir une vidéo ou un montage… | `starcapture.openFile` |

## NovaGame

| Commande | Identifiant |
|---|---|
| NovaGame : Actualiser | `novagame.refresh` |
| NovaGame : Afficher dans l'explorateur de fichiers | `novagame.reveal` |
| NovaGame : Installer et configurer Unity | `novagame.setup` |
| NovaGame : Lancer Unity sur ce jeu | `novagame.launchUnity` |
| NovaGame : Nouveau jeu… | `novagame.newGame` |
| NovaGame : Ouvrir le bac à sable | `novagame.sandbox` |
| NovaGame : Ouvrir NovaGame | `novagame.open` |
| NovaGame : Ouvrir un jeu Unity… | `novagame.openGame` |
| NovaGame : Remettre le bac à sable à zéro | `novagame.resetSandbox` |
| NovaGame : Retirer de la liste | `novagame.forget` |

