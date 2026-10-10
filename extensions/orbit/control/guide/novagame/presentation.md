---
title: Présentation
description: NovaGame est l'atelier de jeux Unity d'Orbit : un bac à sable prêt en un clic, tes jeux, et un agent qui construit dans l'éditeur.
order: 1
icon: gamepad-2
---

NovaGame relie Orbit à l'éditeur Unity. Tu ouvres un bac à sable ou un jeu, Orbit installe un petit pont dans le projet, et tu vois et modifies le jeu depuis Orbit pendant que l'agent travaille dans la scène avec toi.

![NovaGame](/captures/jeu.jpg)

## À quoi ça sert

- Essayer Unity sans rien configurer : un bac à sable avec une scène où marcher est créé et réglé tout seul.
- Créer un jeu : un nouveau projet Unity, écrit sans lancer Unity.
- Demander à l'agent un gameplay (« un joueur qui saute », « des ennemis qui patrouillent ») : il écrit les scripts C#, les branche dans la scène et vérifie le résultat à l'image.
- Jouer au jeu dans Orbit, au clavier et à la souris.

## Comment l'utiliser

1. Clique la manette de la barre d'activité : c'est l'onglet **NovaGame**. Si Unity manque, NovaGame te guide (voir [Installer Unity](/docs/novagame/installer-unity)).
2. Choisis **Ouvrir le bac à sable**, **Nouveau jeu…** ou **Ouvrir un jeu Unity…**.
3. Orbit ajoute le pont au projet, lance Unity dessus (réglage `novagame.launchUnity`) et ouvre le [studio](/docs/novagame/studio).
4. Demande à l'agent ce que tu veux : il a les [outils `orbit-unity`](/docs/novagame/agent) pour voir et piloter l'éditeur.

## Ce que contient l'onglet

| Élément | Rôle |
|---|---|
| Studio de jeu | Ouvre le studio, quand un jeu est ouvert. |
| Ouvrir le bac à sable | Crée (la première fois) et ouvre le [bac à sable](/docs/novagame/bac-a-sable). |
| Nouveau jeu… | Crée un projet Unity dans le dossier des jeux. |
| Ouvrir un jeu Unity… | Choisis un dossier qui contient `Assets` et `ProjectSettings`. |
| Mes jeux | Les jeux récents, ceux d'Unity Hub et le bac à sable. |
| Configuration | L'état de Unity, d'Unity Hub, du bac à sable, du pont et de l'éditeur. |

Ouvrir un jeu le fait dans la fenêtre courante s'il n'y a pas de dossier ouvert ; sinon une nouvelle fenêtre s'ouvre, et tes agents en cours restent où ils sont. La fenêtre qui s'ouvre termine le travail : pont, Unity, studio. Quand Unity tourne sur le jeu ouvert, la vue du jeu s'ouvre seule (réglage `novagame.autoOpen`).

## Commandes

| Commande | Effet |
|---|---|
| **Ouvrir NovaGame** | Affiche l'onglet, et le studio si un jeu est ouvert. |
| **Ouvrir le bac à sable** | Voir ci-dessus. |
| **Nouveau jeu…** | Crée un jeu. |
| **Ouvrir un jeu Unity…** | Ouvre un jeu existant. |
| **Installer et configurer Unity** | Lance l'installation guidée. |
| **Lancer Unity sur ce jeu** | Ouvre l'éditeur sur le jeu courant. |
| **Remettre le bac à sable à zéro** | Efface et recrée le bac à sable. |

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Studio de jeu (ou onglet NovaGame si aucun jeu n'est ouvert) | `Ctrl+Alt+U` | `⌥⌘U` |

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `novagame.folder` | vide | Dossier des jeux et du bac à sable. Vide : `Orbit/NovaGame` dans ton dossier personnel. |
| `novagame.unityPath` | vide | Chemin de l'éditeur Unity. Vide : NovaGame le trouve seul. |
| `novagame.launchUnity` | `true` | Lance Unity tout seul quand un jeu s'ouvre. Décoché : NovaGame prépare tout et te laisse lancer Unity. |
| `novagame.autoOpen` | `true` | Ouvre la vue du jeu dès que Unity tourne sur le jeu ouvert. |

## Avec ChatGPT

NovaGame n'a pas été vérifié avec ChatGPT, et ses pages parlent encore de Claude dans leurs textes.

## Limites

- Unity doit être installé, ou installable sur la machine : NovaGame ne remplace pas l'éditeur, il le pilote.
- Le pont est un paquet d'éditeur : il n'entre jamais dans les builds du jeu.

## Voir aussi

- [Installer Unity](/docs/novagame/installer-unity)
- [Bac à sable et nouveau jeu](/docs/novagame/bac-a-sable)
- [Le studio](/docs/novagame/studio)
