---
title: Radar de collision
description: Orbit te prévient dès que deux agents modifient le même fichier, avant que l'un écrase le travail de l'autre.
order: 8
icon: triangle-alert
---

Des agents qui travaillent en parallèle dans le même dossier peuvent modifier le même fichier sans le savoir, et le dernier à écrire gagne. Le radar de collision surveille les fichiers que chaque agent lit et modifie, et donne l'alerte dès que deux agents modifient le même.

![Collision entre deux agents](/captures/tuto-collision.png)

## À quoi ça sert

- Repérer un conflit pendant qu'il est encore facile à régler, plutôt qu'au moment de relire le résultat.
- Savoir quel agent touche à quoi, sans ouvrir chaque terminal.

## Comment ça marche

Orbit retient, pour chaque agent, les fichiers qu'il lit et ceux qu'il modifie pendant son tour. Il ne demande rien : il s'appuie sur les événements de l'agent (voir [Statut et notifications](/docs/agents/statut-et-notifications)).

- Dans l'explorateur, un fichier modifié porte l'initiale de l'agent dans sa couleur. Un fichier lu porte l'initiale en minuscule. Le marquage remonte sur les dossiers parents.
- Quand deux agents modifient le même fichier, le fichier prend un badge `!` orange et une alerte s'affiche : « Collision : A et B modifient tous les deux <fichier> ». Elle propose **Voir** chaque agent (le terminal s'ouvre) et **Ouvrir le fichier**.
- Dans la [vue Orbite](/docs/agents/vue-orbite), un trait rouge relie les deux planètes et la collision est listée dans le panneau latéral.

Chaque collision n'est signalée qu'une fois. Quand un agent reçoit un nouveau message, ses traces sont effacées. La marque d'un fichier seulement lu disparaît au bout d'environ 25 secondes.

## Que faire d'une alerte

1. Va voir les deux agents avec les boutons de l'alerte.
2. Arrête-en un (Échap dans son terminal) ou précise-lui de laisser ce fichier à l'autre.
3. Pour l'avenir, sépare les agents : une zone de code par agent, ou un [worktree](/docs/agents/worktrees) chacun.

## Avec ChatGPT

Orbit déduit les fichiers lus et modifiés des journaux de Codex. Les fichiers modifiés sont tirés des en-têtes des correctifs (`apply_patch`).

## Limites

- Seuls les outils d'édition de l'agent sont suivis (écriture, édition, modification multiple, carnets de notes) ainsi que la lecture. Un fichier modifié par une commande shell (`sed`, un script, un formateur) n'est pas vu.
- Le radar prévient, il n'empêche rien : l'écrasement a pu avoir lieu.
- Les agents isolés dans des worktrees ne se marchent pas dessus, puisqu'ils écrivent dans des dossiers différents.

## Voir aussi

- [Vue Orbite](/docs/agents/vue-orbite)
- [Worktrees](/docs/agents/worktrees)
- [Grille et splits](/docs/agents/grille-et-splits)
