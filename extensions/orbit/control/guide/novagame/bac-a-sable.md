---
title: Bac à sable et nouveau jeu
description: Un projet Unity d'essai prêt à jouer en un clic, ou un nouveau jeu créé et configuré par NovaGame.
order: 3
icon: flask-conical
---

Le bac à sable est un projet Unity d'essai : une scène où marcher, des caisses à pousser, et rien de précieux. Un nouveau jeu est un projet Unity vide, configuré de la même façon. Dans les deux cas, NovaGame écrit le projet lui-même sans lancer Unity.

## À quoi ça sert

Le bac à sable sert à essayer l'agent et le studio tout de suite, et à tout casser sans conséquence. Le nouveau jeu est le point de départ d'un vrai projet.

## Comment l'utiliser

### Le bac à sable

1. Dans l'onglet NovaGame, clique **Ouvrir le bac à sable**.
2. À la première fois, NovaGame crée le projet dans `~/Orbit/NovaGame/Bac-a-sable` (ou dans le dossier du réglage `novagame.folder`), puis l'ouvre, lance Unity et ouvre le [studio](/docs/novagame/studio).
3. À la première ouverture dans Unity, un script d'éditeur construit la scène de départ `Assets/Scenes/BacASable.unity` : un sol, huit caisses avec de la physique et un joueur à la première personne.
4. Clique **Jouer ici** pour te promener ([Jouer dans Orbit](/docs/novagame/jouer)). Les contrôles du joueur : `ZQSD` ou `WASD` pour bouger, la souris pour regarder, `Espace` pour sauter, `Maj` pour courir.

### Un nouveau jeu

1. Clique **Nouveau jeu…**, puis donne un nom (« Mon jeu » par défaut). Le jeu est créé dans le même dossier des jeux, sous un nom de dossier nettoyé (accents retirés, caractères spéciaux remplacés par des tirets). Un dossier qui porte déjà ce nom est refusé.
2. Le jeu s'ouvre comme le bac à sable. Il n'a pas de scène de départ : demande-en une à l'agent.

## Ce que NovaGame écrit dans le projet

- `ProjectSettings/ProjectVersion.txt` avec la version de l'éditeur retenu, et un `ProjectSettings.asset` minimal qui active le fonctionnement en arrière-plan et les deux systèmes d'entrée (sans ce dernier réglage, Unity ouvre une fenêtre bloquante à la première ouverture).
- `Packages/manifest.json` : les modules du moteur (physique, audio, interface, particules, terrain, vidéo…), uGUI et le paquet **Input System**. Les versions dépendent de la génération d'Unity (Input System 1.11.2 à partir d'Unity 6, 1.7.0 avant).
- `Assets/Scripts` et `Assets/Scenes`, un `.gitignore` adapté à Unity, et le pont d'Orbit (`Packages/com.orbit.bridge`).
- Un fichier `CLAUDE.md` qui explique à l'agent le projet : rendu intégré (pas d'URP), entrées par Input System (jamais l'ancienne classe `Input`), emplacement des scripts et des scènes, et les outils [`orbit-unity`](/docs/novagame/agent) à utiliser.
- Pour le bac à sable seulement : `Assets/Scripts/NovaPlayer.cs` et `Assets/Editor/NovaGameStarter.cs`.

Unity génère tout le reste à la première ouverture du projet.

## Remettre le bac à sable à zéro

La commande **Remettre le bac à sable à zéro** (menu de la vue NovaGame) supprime `Assets`, `Packages`, `ProjectSettings`, `Library`, `Temp`, `Logs`, `UserSettings` et `obj`, puis recrée un bac à sable neuf. C'est définitif et il faut confirmer avec « Tout effacer et recommencer ». Ferme Unity avant : si l'éditeur a le bac à sable ouvert, la commande refuse.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `novagame.folder` | vide | Dossier des jeux et du bac à sable. Vide : `Orbit/NovaGame` dans ton dossier personnel. |

## Limites

- Il faut qu'un éditeur Unity soit installé ([Installer Unity](/docs/novagame/installer-unity)).
- Le projet utilise le rendu intégré d'Unity : il n'est pas configuré pour URP ou HDRP.

## Voir aussi

- [Présentation](/docs/novagame/presentation)
- [Jouer dans Orbit](/docs/novagame/jouer)
- [L'agent et Unity](/docs/novagame/agent)
