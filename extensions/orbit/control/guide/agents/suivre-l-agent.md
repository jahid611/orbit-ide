---
title: Suivre l'agent
description: Les fichiers que l'agent écrit s'ouvrent seuls, les lignes écrites s'allument, l'explorateur suit son projet.
order: 14
icon: eye
---

Quand l'agent écrit un fichier, Orbit l'ouvre dans l'éditeur, déplie l'explorateur jusqu'à lui et allume de haut en bas les lignes écrites, puis les estompe. Tu vois le travail arriver sans chercher où il se passe.

## À quoi ça sert

Tu regardes le code se faire au lieu de lire un compte rendu après coup. Et quand l'agent travaille dans un dossier que l'explorateur ne montre pas, le projet apparaît tout seul, sans rechargement de la fenêtre.

## Comment l'utiliser

Rien à faire : la fonction est active par défaut. Elle suit **l'agent que tu regardes**, c'est-à-dire le terminal courant. Si tu as plusieurs agents, seul celui qui est affiché pilote l'éditeur : ils ne se disputent pas l'écran.

À chaque fichier écrit :

1. le fichier s'ouvre dans l'éditeur, sans voler le focus à ton terminal ;
2. l'explorateur se déplie jusqu'à lui ;
3. les lignes modifiées s'allument de haut en bas, un repère « écrit » suit la ligne en cours, puis le surlignage s'efface.

## Le projet apparaît dans l'explorateur

Quand l'agent écrit, ou commence à lire, dans un projet que l'explorateur ne montre pas, la racine de ce projet (repérée par `.git`, `package.json`…) y est ajoutée. Orbit ne touche jamais aux dossiers privés de l'agent et d'Orbit (`~/.claude`, `~/.orbit`), aux dossiers système ni au dossier temporaire.

Sans dossier ouvert, démarrer un agent propose d'abord de choisir un projet (« Projet rapide »).

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.claude.followAgent` | `true` | Ouvre chaque fichier écrit par l'agent affiché, déplie l'explorateur et allume les lignes. |
| `orbit.claude.followFolder` | `auto` | Quand l'agent travaille dans un dossier absent de l'explorateur : `auto` l'affiche seul, `ask` demande d'abord (bouton « Afficher ce dossier »), `off` ne change jamais l'explorateur. |

> **Astuce** Si l'ouverture automatique te gêne pendant que tu édites toi-même, mets `orbit.claude.followAgent` à `false` : le suivi du dossier continue séparément, selon `orbit.claude.followFolder`.

## Limites

- Seul l'agent affiché est suivi.
- Pour un fichier modifié, seules les lignes entre la première et la dernière différence sont allumées. Une suppression pure ne laisse allumé que l'endroit où elle a eu lieu.
- Un fichier hors du projet ouvert n'est montré qu'après l'apparition de son dossier dans l'explorateur ; s'il n'y apparaît pas, il n'est pas ouvert.

## Voir aussi

- [Vue Orbite](/docs/agents/vue-orbite)
- [Radar de collision](/docs/agents/radar-de-collision)
- [Statut et notifications](/docs/agents/statut-et-notifications)
