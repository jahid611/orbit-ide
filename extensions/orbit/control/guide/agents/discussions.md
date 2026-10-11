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

### Agents lancés avant une mise à jour

Un agent garde les outils et les consignes du jour où il a démarré. Recharger la fenêtre met Orbit à jour, pas un agent déjà en marche : son terminal continue de tourner tel quel.

Après une mise à jour d'Orbit, ou après l'installation d'une application du magasin, Orbit te le signale : une notification, et un bouton orange « agents à relancer » dans la barre du bas tant qu'il en reste. **Relancer** ferme le terminal et en rouvre un sur la même discussion, avec les outils d'aujourd'hui ; le chef d'équipe revient en chef d'équipe. Un agent en plein travail, ou qui attend ton accord, n'est pas touché : relance-le quand il a fini.

### Retrouver ton espace de travail

Tu peux fermer Orbit, éteindre l'ordinateur et revenir le lendemain : le projet se rouvre là où tu l'as laissé.

- **Tous les agents ouverts** reviennent, chacun sur sa propre discussion, pas seulement le dernier. Le chef d'équipe revient en chef d'équipe, avec ses outils. Un agent que tu as fermé toi-même avant de quitter ne revient pas.
- **Les fichiers ouverts** et la disposition de l'éditeur reviennent, comme dans tout éditeur.
- **La vue vivante** revient sur la même application et la même page, et ta session y est toujours ouverte. Les pages d'outils bâties sur le même modèle reviennent aussi : variables d'environnement, tableau de tâches, relecture visuelle, magasin, Figma, Supabase, Stripe.

« Reload Window » garde les mêmes choses, et en plus les agents continuent de tourner pendant le rechargement.

Ce qui ne revient pas : un travail qu'un agent était en train de faire au moment de la fermeture (il reprend sa discussion, à l'arrêt : dis-lui de continuer) ; la disposition des terminaux en grille ou côte à côte (ils reviennent en onglets) ; les pages Vercel, Higgsfield, Base de données, Orbite, Studio, File de nuit et NovaGame, à rouvrir à la main ; l'appareil choisi dans la vue vivante. Avec ChatGPT, les discussions ne sont pas reprises : un agent neuf démarre.

Les terminaux revenus sans agent après une fermeture d'Orbit sont fermés ; les discussions sont reprises à leur place.

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
