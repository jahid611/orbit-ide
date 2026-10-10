---
title: Machine à remonter le temps
description: Un point de sauvegarde de tout le projet à chaque message à l'agent, pour comparer, commenter ou revenir en arrière.
order: 4
icon: history
---

Chaque message que tu envoies à un agent crée un point de sauvegarde de tout le projet, puis un second quand l'agent a fini. La **Frise du projet** liste ces tours : tu vois ce que chacun a changé, tu peux comparer avant et après, et remettre le projet comme il était juste avant un message.

![Frise du projet](/captures/tuto-frise.png)

## À quoi ça sert

À essayer sans crainte. Si un tour a tout cassé, tu reviens en un clic à l'état d'avant. Si seul un fichier te déplaît, tu annules celui-là et tu gardes le reste. Tout est capturé, pas seulement ce que l'agent écrit : commandes du shell, scripts, formateurs et tes propres changements.

## Comment l'utiliser

1. Envoie des messages à ton agent comme d'habitude. La vue **Frise du projet** (barre latérale Orbit) se remplit toute seule.
2. Déplie un tour pour voir ses fichiers ajoutés, modifiés ou supprimés, avec les lignes ajoutées et retirées (`+12 −3`).
3. Clique un fichier pour ouvrir le avant / après.
4. Pour revenir en arrière, utilise la flèche à droite d'un tour (**Revenir avant ce message**), puis confirme.

Le bouton disquette (**Créer un point de sauvegarde**) en crée un à la main, avec le nom de ton choix, avant une manipulation risquée.

## Revenir en arrière

Le retour arrière remet le projet exactement comme il était avant le message : les fichiers modifiés reprennent leur contenu, ceux créés depuis disparaissent. Une fenêtre de confirmation liste les fichiers concernés. Le retour est lui-même annulable : l'état d'avant reste dans la frise, sous le nom « Retour avant… ».

**Arrête les agents avant de revenir en arrière** : un agent encore au travail continuerait d'écrire par-dessus.

## Revue d'un tour, fichier par fichier

Sur un fichier d'un tour, deux actions du menu contextuel :

- **Commenter ce fichier pour Claude** : tu écris ce qui ne va pas et Orbit l'envoie à l'agent qui a fait le changement (ou à l'agent courant), avec le fichier en référence.
- **Annuler ce fichier seulement** : le fichier reprend son contenu d'avant ce tour, ou est supprimé s'il a été créé pendant le tour. Les autres fichiers ne bougent pas, et l'état actuel est gardé dans la frise.

## Où vivent les sauvegardes

Dans un dépôt git fantôme par projet, sous `~/.orbit/snapshots/`. Il est séparé du projet : il ne crée ni commit, ni branche, ni modification de l'index de ton dépôt, et n'a pas besoin que le projet soit un dépôt git. Il faut en revanche que git soit installé : sinon Orbit te le signale.

Ne sont jamais sauvegardés : `node_modules`, `.orbit`, `.venv`, `__pycache__`, `.next`, `.turbo`, `.cache`, ainsi que les fichiers ignorés par le `.gitignore` du projet. La frise garde les 300 derniers tours.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.timeMachine.enabled` | `true` | Prend un point de sauvegarde à chaque message envoyé à un agent. |

## Avec ChatGPT

Les tours sont détectés de la même façon : Orbit traduit les journaux de session de Codex en début et fin de tour.

## Limites

- Avec plusieurs agents dans le même dossier, un tour montre tout ce qui a changé pendant ce temps, y compris le travail des autres.
- Les dossiers personnels et les racines de disque ne sont pas photographiés.
- Un point de sauvegarde pris à la main apparaît dans la frise sous le nom « Toi ».

## Voir aussi

- [Worktrees](/docs/agents/worktrees)
- [Commit intelligent](/docs/boucle/commit-intelligent)
- [Vérification automatique](/docs/boucle/verification)
