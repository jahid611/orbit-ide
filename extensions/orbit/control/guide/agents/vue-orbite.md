---
title: Vue Orbite
description: Une carte où ton projet est au centre et chaque agent une planète, avec les fichiers qu'il lit et modifie.
order: 7
icon: orbit
---

La vue Orbite est la tour de contrôle des agents. Le projet est au centre, chaque agent tourne autour comme une planète, et les fichiers de son tour de travail sont ses lunes. Tu vois d'un regard qui fait quoi, et si deux agents se marchent dessus.

![Vue Orbite](/captures/orbite.png)

## À quoi ça sert

- Suivre plusieurs agents en même temps sans ouvrir chaque terminal.
- Repérer les fichiers touchés par chacun.
- Voir les [collisions](/docs/agents/radar-de-collision) entre agents.

## Comment l'utiliser

1. Ouvre la vue avec `Ctrl+Alt+O`, le bouton en forme de globe de la barre du panneau, ou la liste des agents (`Ctrl+Alt+A`).
2. Chaque planète porte la couleur et le nom d'un agent, avec son état (travaille, attend ton accord, a terminé, prêt) et l'outil en cours.
3. Clique une planète pour aller au terminal de l'agent, un fichier pour l'ouvrir.

### Les lunes

Chaque lune est un fichier du tour en cours de l'agent : pleine quand il le **modifie**, creuse quand il le **lit**. Un trait rouge relie deux planètes dont les agents modifient le même fichier.

### Le panneau latéral

Il compte les agents et ceux qui sont au travail. Chaque agent a une carte avec son rôle (s'il en a un), la consigne en cours, le nombre de fichiers modifiés et lus, la durée du tour et ses cinq fichiers les plus récents. Les collisions s'affichent en haut. En bas, des boutons lancent un agent, la grille, le chef d'orchestre, la fusion et le message à tous.

### Dans l'explorateur

Les mêmes traces apparaissent sur les fichiers : l'initiale de l'agent, en couleur quand il modifie le fichier, en minuscule quand il le lit. Elles remontent sur les dossiers parents.

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Vue Orbite | `Ctrl+Alt+O` | `⌥⌘O` |

## Avec ChatGPT

La vue fonctionne avec les mêmes informations. Orbit déduit les fichiers lus et modifiés des journaux de Codex : les fichiers modifiés sont tirés des en-têtes des correctifs (`apply_patch`).

## Limites

- Les traces d'un agent s'effacent à son message suivant : la carte montre le tour en cours, pas l'historique. Un fichier simplement lu s'efface au bout d'environ 25 secondes.
- Seuls les outils de lecture et d'édition de l'agent sont suivis. Un fichier modifié par une commande shell (`sed`, un script, un formateur) n'est pas vu.
- Sans agent ouvert, la vue le dit et propose d'en lancer un.

## Voir aussi

- [Radar de collision](/docs/agents/radar-de-collision)
- [Chef d'équipe](/docs/agents/chef-d-equipe)
- [Chef d'orchestre](/docs/agents/chef-d-orchestre)
