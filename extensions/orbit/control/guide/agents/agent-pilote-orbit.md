---
title: L'agent pilote l'IDE
description: Chaque agent lancé par Orbit reçoit le serveur MCP « orbit » et peut ouvrir des dossiers, des fichiers, des vues et des projets lui-même.
order: 19
icon: plug
---

Chaque agent démarré par Orbit reçoit un serveur MCP nommé `orbit`. Avec lui, l'agent agit sur l'IDE : il affiche le dossier où il travaille, ouvre un fichier, montre une vue, bascule sur un autre projet. Il n'a pas besoin de te demander de le faire.

## À quoi ça sert

Tu n'ouvres plus un dossier à la main quand l'agent travaille ailleurs, et tu vois toujours ce qu'il est en train de faire. Quand tu demandes de passer à un autre projet, l'agent termine l'actuel puis y envoie un nouvel agent avec une consigne complète.

## Comment ça marche

Orbit écrit un fichier de configuration MCP par installation (`~/.orbit/mcp/orbit-control-<empreinte>.json`) et le passe à chaque agent. Chaque fenêtre d'Orbit s'inscrit dans `~/.orbit/control/` avec une adresse locale (127.0.0.1) et un jeton. Le serveur retrouve la fenêtre propriétaire du terminal de l'agent à chaque appel, sinon la dernière fenêtre active : il continue donc à fonctionner quand les extensions redémarrent parce que les dossiers affichés changent.

Les consignes d'Orbit demandent à l'agent d'utiliser ces outils de lui-même : montrer un dossier avant d'y travailler, ouvrir le résultat important, ne jamais te demander d'ouvrir un dossier.

> **À savoir** Les outils demandent encore l'accord de l'agent selon ses règles de permission : Orbit ne les pré-autorise pas.

## Les outils

| Outil | Ce qu'il fait |
|---|---|
| `state` | Ce que tu vois : dossiers de l'explorateur, fichier actif et sélection, éditeurs ouverts, terminaux d'agents (nom, dossier, état). |
| `show_folder` | Affiche un dossier dans l'explorateur sans recharger la fenêtre ni couper les terminaux. Mode `replace` (défaut), `add` ou `remove` ; `create` crée le dossier s'il manque. |
| `open_project` | Bascule sur un autre projet (`create` le crée, `git init` compris) et y démarre un nouvel agent, avec `prompt` comme premier message. |
| `open_file` | Ouvre un fichier à une ligne (ou un bloc, avec `endLine`), éventuellement à côté. Documents, images, vidéos et montages s'ouvrent dans leur lecteur. |
| `show_view` | Affiche une vue d'Orbit : carte des agents, équipe, frise, base de données, vue vivante, utilisation, file de nuit, tableau, variables d'environnement, relecture visuelle, magasin, Vercel, Supabase, Stripe, Higgsfield et d'autres. |
| `open_url` | Ouvre une adresse : un serveur local dans la vue vivante, une page web dans le navigateur intégré, ou le navigateur du système avec `external`. |
| `new_claude` | Ouvre un autre terminal d'agent, dans un dossier, avec un nom et un premier message. |
| `notify` | Affiche une notification (`info`, `warning` ou `error`). |
| `run_command` | Exécute une commande d'Orbit ou de VS Code par son identifiant. Un argument `{"$uri": "chemin"}` devient un chemin de fichier. |
| `find_commands` | Cherche les commandes dont l'identifiant contient tous les mots donnés. |
| `board_list`, `board_add`, `board_take`, `board_move` | Le [Tableau de tâches](/docs/agents/tableau-de-taches) : lister, ajouter, prendre et déplacer des cartes (jamais vers « Fait »). |
| `env_names` | Les noms des variables d'environnement du projet, jamais les valeurs. |
| `env_ask` | Demande une variable à remplir : la page des variables s'ouvre avec la demande de l'agent. |

## Changer de projet

`open_project` suit le réglage `orbit.project.openIn`. Si la fenêtre montre déjà un projet, Orbit te demande « Ouvrir en plus » (nouvelle fenêtre, le projet et ses agents restent) ou « Remplacer celui-ci ». Dans une même fenêtre, les terminaux actuels, l'agent compris, se ferment environ 2 secondes après : l'agent doit donc terminer son travail (commit, push) et te répondre avant.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.project.openIn` | `ask` | Ouvrir un projet : `ask` (question), `newWindow` ou `replace`. |

## Avec ChatGPT

Orbit convertit les fichiers MCP en une configuration que Codex lit pour chaque terminal (`~/.codex/orbit-<id>.config.toml`), avec les mêmes consignes. Les outils `orbit` sont donc fournis aux deux agents.

## Limites

- Les outils ne fonctionnent que pour un agent lancé par Orbit : un agent démarré ailleurs ne reçoit rien.
- `run_command` peut exécuter n'importe quelle commande de l'IDE, dans les limites des permissions accordées à l'agent.

## Voir aussi

- [Chef d'équipe](/docs/agents/chef-d-equipe)
- [Tableau de tâches](/docs/agents/tableau-de-taches)
- [Variables d'environnement](/docs/outils/variables-d-environnement)
- [Vue vivante](/docs/boucle/vue-vivante)
