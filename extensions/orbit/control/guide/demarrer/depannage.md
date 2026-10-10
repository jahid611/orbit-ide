---
title: Dépannage
description: Les pièges connus quand on utilise Orbit installé, avec ce qu'il faut faire pour chacun.
order: 7
icon: settings
---

Cette page rassemble les situations qui surprennent le plus souvent, avec la réponse pour chacune. Elle ne concerne que l'usage d'Orbit installé.

## L'agent n'est pas trouvé

Si une action indique « Claude Code introuvable » ou « Codex introuvable », Orbit ne trouve pas le programme de l'agent.

- Vérifie que l'agent est installé (`npm install -g @anthropic-ai/claude-code` ou `npm install -g @openai/codex`) et connecté.
- Si le programme n'est pas dans le `PATH`, indique son chemin dans `orbit.claude.path` ou `orbit.chatgpt.path`.
- Sous Windows, Orbit retrouve le vrai `claude.exe` derrière le raccourci npm `claude.cmd`, et lance toujours les terminaux d'agent dans PowerShell, quel que soit ton shell par défaut.

## La jauge est absente ou en erreur

- « Connexion expirée » : ouvre un terminal d'agent pour que Claude Code renouvelle sa connexion, puis actualise. Orbit ne la renouvelle jamais lui-même.
- « Connecte-toi d'abord dans un terminal Claude (/login) » : connecte-toi dans Claude Code.
- La jauge disparaît avec `orbit.claude.billing` sur `apiKey`, et avec ChatGPT tant que Codex n'a pas répondu une première fois.

Voir [Abonnement et facturation](/docs/demarrer/abonnement).

## Le statut des agents n'apparaît pas

Orbit suit les agents Claude grâce aux crochets (hooks) de Claude Code. Sous Windows, ces crochets passent par Git Bash, que Claude Code exige déjà : vérifie qu'il est installé. Avec ChatGPT, Orbit lit les journaux de session de Codex à la place.

## Un terminal d'agent apparaît en double

Après un rechargement de la fenêtre, un nouveau terminal d'agent peut s'ajouter à celui qui revient avec un peu de retard. Ferme le surplus.

## Terminaux revenus sans agent

Quand tu fermes puis rouvres Orbit, les terminaux d'agents reviennent en simples shells. Orbit les détecte et les ferme ; la dernière discussion du projet est reprise à la place (avec Claude).

## Les couleurs de l'agent sont ternes

Un `NO_COLOR` hérité du shell qui a lancé Orbit rendait Claude Code monochrome. Orbit le retire de l'environnement des terminaux d'agents, donc le problème ne doit plus apparaître. Si tu règles toi-même `terminal.integrated.minimumContrastRatio`, garde 1 : c'est ce qui laisse les applications afficher leurs couleurs exactes.

## Clavier Mac AZERTY : `@ { [ |` ne s'écrivent plus

N'active jamais `terminal.integrated.macOptionIsMeta` : il casse la saisie de ces caractères avec la touche Option.

## Un raccourci d'Orbit ne marche pas dans un terminal

Quand un terminal a le focus, VS Code envoie au programme du terminal tout raccourci dont la commande n'est pas dans `terminal.integrated.commandsToSkipShell`. Orbit y déclare ses commandes ; si un raccourci que tu as ajouté toi-même est avalé par le terminal, ajoute sa commande à ce réglage.

## Comportements du mode d'autorisation

- En mode « Accepter les modifications », Claude Code peut créer des dossiers sans demander : c'est son comportement.
- `Ctrl+K` (édition en ligne) masque les accords `Ctrl+K` suivis d'une touche de VS Code quand l'éditeur a le focus.
- Dans la vue discussion, les demandes d'autorisation envoient des touches au terminal (Entrée, « 2 », Échap). Ce chemin n'a pas été testé avec une vraie demande d'autorisation ; si un bouton ne répond pas, réponds dans le terminal.

## Après une mise à jour, l'ancien comportement reste

Orbit met parfois en cache l'ancien code de l'interface : redémarre complètement Orbit plutôt que de recharger la fenêtre.

## SmartScreen ou macOS refuse d'ouvrir Orbit

Les installateurs ne sont pas signés. La marche à suivre est dans [Installer Orbit](/docs/demarrer/installation).

## Une règle de CSS libre a rendu l'interface inutilisable

Vide le réglage `orbit.ui.customCss` (dans les paramètres, ou dans le Studio, section « CSS libre »). Voir [CSS libre](/docs/personnaliser/css-libre).

## Voir aussi

- [Installer Orbit](/docs/demarrer/installation)
- [Mises à jour](/docs/demarrer/mises-a-jour)
- [Terminaux d'agents](/docs/agents/terminaux)
