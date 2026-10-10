---
title: Terminaux d'agents
description: Chaque agent tourne dans un vrai terminal intégré, avec ses commandes, son abonnement et son dossier de travail.
order: 1
icon: terminal
---

Dans Orbit, l'agent n'est pas un chat greffé à l'éditeur : c'est le programme en ligne de commande (Claude Code, ou Codex pour ChatGPT) lancé dans un terminal intégré. Tu retrouves donc ses commandes, ses raccourcis et ton abonnement, et tu organises plusieurs terminaux comme n'importe quel terminal de l'éditeur.

## À quoi ça sert

- Garder le comportement exact de l'agent : ses commandes `/…` (`/model`, `/usage`, `/resume`) fonctionnent telles quelles.
- Avoir un terminal par tâche, chacun avec son onglet, sa couleur et son état (voir [Statut et notifications](/docs/agents/statut-et-notifications)).
- Travailler toujours dans un dossier que tu vois : les fichiers que l'agent crée s'ouvrent en aperçu dans l'éditeur, sans te faire quitter le terminal.

## Comment l'utiliser

1. Ouvre un projet : un terminal d'agent s'ouvre tout seul (réglage `orbit.claude.autoStart`).
2. Pour en ouvrir un autre, utilise `Ctrl+Alt+N`. Pour revenir au dernier terminal utilisé, `Ctrl+L`.
3. Sans dossier ouvert, Orbit te propose de démarrer par un projet : projet rapide, nouveau projet (créé dans `~/Orbit` par défaut), dossier existant, ou sans dossier (déconseillé : l'explorateur reste vide). Voir [Ouvrir et créer un projet](/docs/demarrer/projets).
4. Le sélecteur d'agents (`Ctrl+Alt+A`, ou la barre d'état) liste les terminaux ouverts et mène aux autres fonctions : split, grille, worktree, chef d'orchestre, discussions récentes, message à tous.

Quelques commandes de la palette complètent la liste :

- « New Claude Terminal with Model and Mode… » demande le modèle puis le mode de permission avant de lancer.
- « Open Claude Terminal in Editor Area » place l'agent dans la zone des éditeurs, à côté du fichier ouvert.
- « Send Message to All Claude Terminals… » envoie le même texte à tous les agents. Un agent qui attend ton autorisation est sauté, et Orbit te le signale.
- `Ctrl+Maj+L` dans un éditeur écrit `@fichier` (ou `@fichier#L3-10` pour une sélection) dans le prompt de l'agent.

Le profil de terminal « Claude » de la liste des profils ouvre aussi un agent.

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Aller au terminal d'agent (ou en lancer un) | `Ctrl+L` | `⌘L` |
| Nouveau terminal d'agent | `Ctrl+Alt+N` | `⌥⌘N` |
| Sélecteur d'agents | `Ctrl+Alt+A` | `⌥⌘A` |
| Envoyer le fichier ou la sélection | `Ctrl+Maj+L` | `⇧⌘L` |

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.claude.autoStart` | `true` | Ouvre un terminal d'agent à l'ouverture d'un projet. |
| `orbit.claude.model` | vide | Modèle des nouveaux terminaux (`--model`). |
| `orbit.claude.permissionMode` | vide | Mode de permission des nouveaux terminaux. |
| `orbit.claude.extraArgs` | vide | Arguments ajoutés à la ligne de commande de Claude. |
| `orbit.claude.revealNewFiles` | `true` | Aperçu des fichiers créés dans le projet. |
| `orbit.claude.projectsFolder` | vide | Dossier des nouveaux projets (vide : `~/Orbit`). |

## Avec ChatGPT

Orbit lance `codex` au lieu de `claude`. Le modèle et les arguments se règlent par `orbit.chatgpt.model` et `orbit.chatgpt.extraArgs`, le programme par `orbit.chatgpt.path`. Une seule IA est active à la fois (voir [Claude ou ChatGPT](/docs/demarrer/choisir-son-ia)). Au changement d'IA, les terminaux de l'autre sont fermés et un agent neuf démarre.

## Limites

- Sous Windows, les terminaux d'agents sont toujours des PowerShell, quel que soit ton shell par défaut.
- Orbit retire les clés d'API de l'environnement de ces terminaux : la facturation passe par ton abonnement (voir [Abonnement et facturation](/docs/demarrer/abonnement)).
- Quand Orbit est fermé puis rouvert, un terminal d'agent revient en simple shell : l'agent n'y tourne plus. Orbit le ferme, et avec Claude il reprend la dernière discussion à la place (voir [Discussions du projet](/docs/agents/discussions)).

## Voir aussi

- [Grille et splits](/docs/agents/grille-et-splits)
- [Worktrees](/docs/agents/worktrees)
- [Statut et notifications](/docs/agents/statut-et-notifications)
