---
title: Worktrees
description: Lance un agent sur sa propre branche git, dans un dossier séparé, pour qu'il ne touche pas à ton travail.
order: 3
icon: git-branch
---

Un worktree est une copie de travail de ton dépôt sur une autre branche, dans un dossier à part. Orbit s'en sert pour isoler un agent : il modifie ses fichiers sans toucher aux tiens ni à ceux des autres agents.

## À quoi ça sert

C'est la façon sûre de faire travailler deux agents sur la même partie du code. Chacun a sa branche et son dossier ; tu fusionnes ensuite ce qui te convient.

## Comment l'utiliser

1. Ouvre le sélecteur d'agents (`Ctrl+Alt+A`) et choisis « Claude dans un worktree… », ou lance la commande « Claude in Isolated Git Worktree… » depuis la palette.
2. Donne le nom de la branche. Orbit propose `orbit/` suivi de la date et de l'heure. Seuls les lettres, chiffres, `/`, `.`, `-` et `_` sont acceptés.
3. Orbit crée la branche avec `git worktree add -b`, dans un dossier voisin de ton projet, nommé `<projet>-<branche>` (les `/` et `.` de la branche deviennent des `-`).
4. Un agent démarre dans ce dossier. Son onglet porte le nom de la branche.

Le projet doit être un dépôt git. Si la création échoue, Orbit affiche la première ligne de l'erreur de git.

## Où vivent les worktrees

| Origine | Dossier |
|---|---|
| Commande « Claude dans un worktree… » | dossier voisin du projet : `<projet>-<branche>` |
| [Chef d'orchestre](/docs/agents/chef-d-orchestre) | `.orbit/worktrees/` dans le projet |
| [Chef d'équipe](/docs/agents/chef-d-equipe), quand il isole un agent | `.orbit/worktrees/` dans le projet |

Dans les deux derniers cas, Orbit ajoute `.orbit/` aux exclusions de git (`.git/info/exclude`) : ces dossiers n'apparaissent pas dans l'historique.

## Fusionner

La commande « Chef d'orchestre : fusionner le travail des agents… » liste les worktrees dont la branche commence par `orbit/`, y compris celui créé à la main avec le nom proposé par défaut. Elle commite les fichiers de l'agent dans sa branche, puis fait un `merge --no-ff` dans ton projet. Les conditions (projet propre, identité git configurée) sont décrites sur la page du [chef d'orchestre](/docs/agents/chef-d-orchestre).

## Discussions

Un worktree a sa propre liste de discussions : les conversations sont rangées par dossier de travail (voir [Discussions du projet](/docs/agents/discussions)).

## Limites

- Pour un worktree créé à la main, Orbit ne le supprime pas après usage : retire-le avec `git worktree remove`. Seule la fusion du chef d'orchestre propose le nettoyage des dossiers et des branches.
- Un worktree ne contient que les fichiers suivis par git : ce qui est ignoré (un dossier `node_modules`, un fichier `.env`) n'y est pas copié.

## Voir aussi

- [Grille et splits](/docs/agents/grille-et-splits)
- [Radar de collision](/docs/agents/radar-de-collision)
- [Chef d'orchestre](/docs/agents/chef-d-orchestre)
