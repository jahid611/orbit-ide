---
title: Grille et splits
description: Affiche deux à six agents côte à côte, ou ajoute un agent en split à côté du terminal courant.
order: 2
icon: layout-grid
---

Quand plusieurs agents travaillent en parallèle, tu veux les voir tous. Orbit propose deux façons : le split, qui ajoute un agent à côté du terminal courant, et la grille, qui en ouvre d'un coup deux, trois, quatre ou six dans la zone des éditeurs.

![Grille d'agents dans Orbit](/captures/grille.png)

## À quoi ça sert

- Suivre plusieurs agents sans changer d'onglet.
- Lancer en une fois un groupe d'agents pour des tâches indépendantes.
- Retrouver la couleur de chaque agent sur son onglet, sur ses fichiers dans l'explorateur et sur sa planète dans la [vue Orbite](/docs/agents/vue-orbite).

## Comment l'utiliser

### Split

`Ctrl+Alt+\` ouvre un nouvel agent coupé en deux avec le terminal actif. Répète pour en ajouter d'autres.

### Grille

1. Appuie sur `Ctrl+Alt+G`, ou clique le bouton de grille dans la barre du terminal (il est aussi dans la barre de la vue discussion).
2. Choisis la disposition :

| Choix | Disposition |
|---|---|
| 2 agents | côte à côte |
| 3 agents | trois colonnes |
| 4 agents | grille 2 × 2 |
| 6 agents | grille 3 × 2 |

3. Orbit organise la zone des éditeurs et lance un agent dans chaque case.

Chaque agent démarre avec le modèle et le mode de permission de tes réglages.

> **Attention** Des agents lancés dans le même dossier peuvent modifier les mêmes fichiers, et l'un écrase alors le travail de l'autre. Donne à chacun sa propre zone de code, isole-les dans des [worktrees](/docs/agents/worktrees), ou laisse le [radar de collision](/docs/agents/radar-de-collision) te prévenir.

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Claude en split | `Ctrl+Alt+\` | `⌥⌘\` |
| Grille d'agents | `Ctrl+Alt+G` | `⌥⌘G` |
| Sélecteur d'agents | `Ctrl+Alt+A` | `⌥⌘A` |

## Limites

- La grille propose exactement 2, 3, 4 ou 6 agents.
- Plusieurs agents consomment chacun ton abonnement : garde un œil sur la jauge (voir [Utilisation et jetons](/docs/agents/utilisation)).
- La grille réorganise la zone des éditeurs : les fichiers ouverts passent dans les groupes créés.

## Voir aussi

- [Terminaux d'agents](/docs/agents/terminaux)
- [Worktrees](/docs/agents/worktrees)
- [Chef d'orchestre](/docs/agents/chef-d-orchestre)
