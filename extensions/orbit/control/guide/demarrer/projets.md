---
title: Ouvrir et créer un projet
description: Crée un projet dans ~/Orbit, lance un projet rapide, ouvre un dossier existant, et choisis d'ouvrir en plus ou de remplacer la fenêtre.
order: 5
icon: rocket
---

Orbit veut que l'agent écrive toujours dans un dossier que tu vois. Il propose donc de créer ou d'ouvrir un projet avant de lancer un agent, et il lance l'agent dans le projet à l'ouverture.

## Les façons de démarrer

Toutes passent par la commande « Changer de projet ou en créer un… » (`Ctrl+Alt+P`, `⌥⌘P`).

| Choix | Ce qu'il fait |
|---|---|
| Projet rapide | Crée un dossier daté (`projet-JJ-MM-HHhMM`), l'ouvre et lance l'agent, sans question. |
| Nouveau projet… | Tu donnes un nom ; le dossier est créé dans `~/Orbit`, l'agent s'y lance. |
| Nouveau projet ailleurs… | Tu choisis d'abord le dossier parent, puis le nom. |
| Ouvrir un dossier… | Ouvre un projet existant et y lance l'agent. |
| Partir d'un template de la communauté… | Ouvre la [Communauté](/docs/outils/communaute). |
| Récents | Les projets ouverts récemment et ceux de `~/Orbit`. |

Dans les deux cas de création, Orbit exécute `git init` dans le nouveau dossier si git est installé ; sinon le dossier est créé sans dépôt. Un nom déjà pris est refusé avec le message « Le dossier … existe déjà ici ». Le nom est converti en nom de dossier simple.

Quand aucun dossier n'est ouvert, « Nouveau terminal » (`Ctrl+Alt+N`) te demande d'abord où l'agent doit travailler : Projet rapide, Nouveau projet, Ouvrir un dossier, ou Sans dossier. Ce dernier choix est déconseillé : l'agent travaille dans ton dossier personnel et l'explorateur reste vide.

## Ouvrir en plus ou remplacer

Quand la fenêtre montre déjà un projet et que tu en ouvres un autre, une question s'affiche :

- **Ouvrir en plus** : une deuxième fenêtre Orbit s'ouvre sur le nouveau projet. La première reste telle quelle, avec ses agents.
- **Remplacer celui-ci** : la fenêtre passe sur le nouveau projet, et ses agents sont fermés.

Le réglage `orbit.project.openIn` évite la question : `newWindow` ouvre toujours une nouvelle fenêtre, `replace` remplace toujours.

Chaque fenêtre est indépendante : tu peux faire travailler des agents sur plusieurs projets en même temps. Tes agents peuvent aussi demander cette ouverture eux-mêmes (voir [L'agent pilote Orbit](/docs/agents/agent-pilote-orbit)) ; la même question apparaît.

## Ce qui se passe à l'ouverture

L'agent se lance tout seul dans le projet (`orbit.claude.autoStart`). Avec Claude, la dernière discussion du projet est reprise à la place d'une discussion neuve, avec un bouton « Nouvelle discussion » pour repartir de zéro. Un projet déplacé ou renommé retrouve ses discussions : voir [Discussions du projet](/docs/agents/discussions).

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Changer de projet ou en créer un | `Ctrl+Alt+P` | `⌥⌘P` |
| Nouveau terminal d'agent | `Ctrl+Alt+N` | `⌥⌘N` |

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.claude.projectsFolder` | vide | Où sont créés les nouveaux projets ; vide, c'est `~/Orbit`. |
| `orbit.project.openIn` | `ask` | `ask`, `newWindow` ou `replace` quand la fenêtre montre déjà un projet. |
| `orbit.claude.autoStart` | `true` | Lance l'agent à l'ouverture d'un projet. |
| `orbit.claude.resumeOnOpen` | `true` | Reprend la dernière discussion à l'ouverture. |

## Limites

- Avec ChatGPT, la dernière discussion n'est pas reprise à l'ouverture : un agent neuf démarre.
- Un nouveau terminal d'agent peut apparaître en double après un rechargement si les terminaux persistants reviennent tard.

## Voir aussi

- [Premier lancement](/docs/demarrer/premier-lancement)
- [Discussions du projet](/docs/agents/discussions)
- [Suivre l'agent](/docs/agents/suivre-l-agent)
