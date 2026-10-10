---
title: Discussions du projet
description: Retrouve, renomme et reprends les discussions d'un projet, y compris après l'avoir déplacé.
order: 6
icon: history
---

Chaque agent garde sa conversation sur le disque. Orbit les range par projet dans la vue « Discussions », te laisse en reprendre une en un clic, et rouvre la dernière quand tu ouvres le projet.

## À quoi ça sert

- Reprendre un travail laissé la veille avec tout son contexte.
- Retrouver une discussion par son titre ou son contenu.
- Garder ses discussions quand on déplace ou renomme le dossier du projet.

## La liste

La vue **Discussions** se trouve dans la barre d'activité (icône Orbit, conteneur « Discussions Claude »). Elle liste les discussions du projet, groupées par jour : Aujourd'hui, Hier, 7 derniers jours, Ce mois-ci, Plus ancien. Chaque ligne indique le temps écoulé, ou l'état de l'agent si la discussion est ouverte dans un terminal (en cours, attend ton accord, terminé, ouverte).

- Un clic reprend la discussion dans un nouveau terminal, ou t'amène à celui où elle est déjà ouverte.
- `Ctrl+Alt+R` ouvre la recherche, par titre ou par contenu.
- Le crayon d'une ligne, ou le clic droit, renomme la discussion. Le nom se retrouve sur l'onglet du terminal. « Renommer la discussion actuelle… » est aussi dans le menu de l'onglet.

Le titre vient du titre donné par l'agent, sinon du début de ton premier message. Les discussions sans message ne sont pas listées. Ce sont celles de Claude Code : elles existent aussi hors d'Orbit, et celles lancées hors d'Orbit apparaissent ici.

## Reprise à l'ouverture

Quand tu ouvres un projet, Orbit reprend sa dernière discussion au lieu de commencer un agent neuf. Une notification annonce « Discussion reprise : <titre> » avec un bouton **Nouvelle discussion** si tu préfères repartir de zéro.

Les terminaux revenus sans agent après une fermeture d'Orbit sont fermés ; la dernière discussion est alors reprise à leur place.

## Projet déplacé ou renommé

Claude Code range une discussion sous le chemin du dossier où elle a eu lieu : déplacer ou renommer le dossier la laisserait derrière. Pour l'éviter, Orbit donne un identifiant à chaque projet qui a des discussions, dans `.orbit/project.json` à l'intérieur du dossier, et note dans `~/.orbit/projects.json` tous les chemins où il a été vu. Les discussions d'un projet sont celles de tous ses chemins. Au moment de reprendre une discussion rangée sous un ancien chemin, Orbit en copie le fichier sous le chemin actuel (l'original reste en place).

L'identifiant n'est créé qu'une fois que le projet a au moins une discussion : un dossier simplement ouvert n'est pas modifié.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.claude.resumeOnOpen` | `true` | Reprend la dernière discussion à l'ouverture d'un projet au lieu d'en commencer une nouvelle. |
| `orbit.claude.autoStart` | `true` | Ouvre un terminal d'agent à l'ouverture d'un projet. |

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Rechercher une discussion | `Ctrl+Alt+R` | `⌥⌘R` |

## Avec ChatGPT

La liste est construite à partir des journaux de Codex dans `~/.codex/sessions/`, triés d'après le dossier écrit sur leur première ligne. Les discussions internes que Codex lance de lui-même sont écartées. La reprise automatique à l'ouverture du projet ne concerne que Claude : avec ChatGPT, un agent neuf démarre.

## Limites

- Les discussions sont rangées par dossier de projet : un worktree a sa propre liste (voir [Worktrees](/docs/agents/worktrees)).
- Une discussion de plus de 6 Mo est lue par son début et sa fin : son titre et son dernier message sont justes, mais le nombre de messages n'est qu'approximatif.

## Voir aussi

- [Vue discussion](/docs/agents/vue-discussion)
- [Terminaux d'agents](/docs/agents/terminaux)
- [Machine à remonter le temps](/docs/boucle/machine-a-remonter-le-temps)
