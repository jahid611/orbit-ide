---
title: Jouer dans Orbit
description: Lance le jeu et joue au clavier et à la souris depuis la page du studio, sans quitter Orbit.
order: 5
icon: play
---

Le bouton **Jouer ici** du studio lance le jeu et envoie ton clavier et ta souris à Unity pendant que l'image s'affiche dans Orbit. Tu testes ce que l'agent vient de construire sans changer de fenêtre.

## À quoi ça sert

À essayer le jeu tout de suite après un changement : marcher dans le bac à sable, tester un saut, vérifier qu'un ennemi te poursuit. Le mode jeu cache les panneaux du studio pour laisser la place à l'image.

## Comment l'utiliser

1. Ouvre un jeu dans le [studio](/docs/novagame/studio) et attends que Unity soit connecté. Si Unity n'est pas ouvert, le bouton le lance et te dit d'attendre.
2. Clique **Jouer ici**. Le jeu démarre s'il ne tournait pas (le message « Le jeu démarre… » s'affiche), et le bouton devient **Quitter le jeu**.
3. Clique dans l'image pour prendre la souris. `Échap` la libère.
4. Joue au clavier. `Échap` encore (souris libre) ou **Quitter le jeu** sort du mode jeu et relâche toutes les touches.

Le bac à sable se joue ainsi : `ZQSD` ou `WASD`, souris, `Espace`, `Maj` (voir [Bac à sable](/docs/novagame/bac-a-sable)).

## Condition : le paquet Input System

Seul le paquet **Input System** peut recevoir les touches venues d'Orbit. C'est le cas du bac à sable et des jeux créés par NovaGame. L'ancienne classe `Input` ne peut pas être alimentée de l'extérieur : quand le jeu ne reçoit pas les touches d'Orbit, un bouton **Adapter le jeu** apparaît en haut du studio, et le message du mode jeu l'indique.

**Adapter le jeu** demande à l'agent de passer le jeu à Input System :

1. ajouter `com.unity.inputsystem` à `Packages/manifest.json` (1.11.2 pour Unity 6, 1.7.0 avant) ;
2. mettre `activeInputHandler` à 2 dans `ProjectSettings/ProjectSettings.asset`, Unity fermé (sinon Unity ouvre une fenêtre bloquante) ;
3. remplacer chaque appel à `Input` par `Keyboard.current` et `Mouse.current`, en gardant le même comportement ;
4. rouvrir le projet dans Unity et vérifier la console.

## Comment ça marche

Le pont d'Orbit crée deux périphériques virtuels (un clavier et une souris) dans Input System, alimentés par une route `/input`. Trois conditions sont nécessaires pour que le jeu réagisse, et le pont les gère pendant que tu joues :

- le réglage de projet « Run In Background » est activé (le réglage reste ensuite dans le projet), sinon l'éditeur gèle le jeu dès que Unity perd le focus ;
- la vue du jeu est marquée active à chaque envoi, sinon les événements sont jetés ;
- Unity ignore la perte de focus et envoie toutes les entrées à la vue du jeu, le temps de la partie.

Cette partie du pont n'existe que si le paquet Input System (1.4 ou plus) est présent dans le projet. Si le projet a un pont plus ancien, la page le remplace d'elle-même.

## Limites

- L'image vient de `Camera.Render` : les interfaces en superposition d'écran (Screen Space - Overlay) n'apparaissent pas.
- Tant que le mode jeu est actif, le vrai clavier atteint aussi le jeu en arrière-plan.
- Les touches ont été vérifiées par le pont (les touches D et A déplacent bien le joueur) ; le trajet complet depuis la page, avec une vraie frappe, n'a pas été rejoué.
- Les changements faits pendant la lecture sont perdus à l'arrêt, comme dans Unity.

## Voir aussi

- [Le studio](/docs/novagame/studio)
- [Bac à sable et nouveau jeu](/docs/novagame/bac-a-sable)
- [L'agent et Unity](/docs/novagame/agent)
