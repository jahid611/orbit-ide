---
title: Chef d'équipe
description: Un agent à qui tu parles, qui crée, nomme et pilote les autres agents à ta place.
order: 9
icon: users
---

Le chef d'équipe est un agent spécial : tu ne parles qu'à lui. Il découpe le travail, crée d'autres agents dans de nouveaux terminaux, leur donne un nom, un rôle et une consigne, suit leur avancement et te rapporte les résultats.

## À quoi ça sert

- Confier une grosse demande en langage courant et laisser l'équipe s'organiser.
- Voir chaque agent avec son nom, son rôle et son icône, plutôt que « Claude 3 ».

## Comment l'utiliser

1. Lance le chef d'équipe avec `Ctrl+Alt+C`, ou le bouton de la vue **Équipe** (barre d'activité, avec les discussions).
2. Si un agent ordinaire est déjà ouvert, une fenêtre propose « Remplacer ce Claude » (le chef reprend sa discussion si elle a commencé) ou « En ouvrir un nouveau ». Remplacer un agent qui travaille l'interrompt.
3. Décris ce que tu veux au chef d'équipe.

Il dispose d'outils, fournis par un serveur `orbit-team` que seul son terminal reçoit :

| Outil | Rôle |
|---|---|
| `team_create_agent` | crée un agent (nom, rôle, icône, consigne, worktree optionnel) |
| `team_list` | liste les agents et leur état |
| `team_message` | écrit à un agent, comme si tu le tapais |
| `team_read` | lit les dernières réponses d'un agent |
| `team_wait` | attend la fin du travail des agents (600 secondes au plus) |
| `team_focus` | amène un terminal sous tes yeux |
| `team_rename` | change nom, rôle ou icône |
| `team_stop` | interrompt un agent (comme Échap) |
| `team_close` | ferme un agent qui a fini |
| `team_show_map` | ouvre la [vue Orbite](/docs/agents/vue-orbite) |
| `team_open_file` | ouvre un fichier à une ligne donnée |

Ses consignes lui demandent de ne jamais créer plus de six agents à la fois, d'éviter que deux agents éditent les mêmes fichiers (sinon un [worktree](/docs/agents/worktrees) par agent) et de te dire quel agent attend une autorisation.

### Ce que tu vois

- La consigne de chaque agent est écrite dans `.orbit/tasks/<nom>.md` : l'agent démarre en lisant ce fichier.
- Le nom, le rôle et l'icône s'affichent sur l'onglet (le rôle est la première ligne au survol), dans la vue Équipe et dans la vue Orbite.
- La vue Équipe liste le chef puis ses agents, avec leur état et les jetons écrits. Le survol détaille le contexte, les fichiers modifiés et la dernière consigne. Les actions de la ligne permettent d'écrire à l'agent, de l'interrompre ou de le fermer.
- Les agents créés par le chef travaillent en mode auto. Voir [Mode auto en un clic](/docs/agents/mode-auto).

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Chef d'équipe | `Ctrl+Alt+C` | `⌥⌘C` |

## Avec ChatGPT

Le chef d'équipe lit les réponses des agents dans les journaux de ChatGPT comme dans ceux de Claude, mais il n'a pas été essayé avec ChatGPT.

## Limites

- Les rôles sont gardés pour le projet ouvert dans la fenêtre. Fermer un terminal retire son rôle.
- Plusieurs agents consomment chacun ton abonnement : garde un œil sur la jauge (voir [Utilisation et jetons](/docs/agents/utilisation)).
- Un nom d'agent est unique : le chef doit en choisir un autre si le nom existe déjà.

## Voir aussi

- [Chef d'orchestre](/docs/agents/chef-d-orchestre)
- [L'agent pilote Orbit](/docs/agents/agent-pilote-orbit)
- [Vue Orbite](/docs/agents/vue-orbite)
