---
title: Le studio
description: Vois le jeu en direct, parcours la hiérarchie, modifie l'inspecteur et lis la console de Unity depuis Orbit.
order: 4
icon: layout-dashboard
---

Le studio est la page d'Orbit qui montre l'éditeur Unity ouvert sur ton jeu : la vue du jeu ou de la scène en direct, la hiérarchie des objets, l'inspecteur de chaque composant, la console, et un champ pour parler à l'agent. Il se connecte à Unity par le pont d'Orbit.

![Studio de jeu](/captures/tuto-unity.png)

## À quoi ça sert

Tu règles une valeur, crées un objet ou lis une erreur sans quitter Orbit, et tu montres à l'agent exactement l'objet dont tu parles.

## Comment l'ouvrir

Le studio s'ouvre quand tu ouvres un jeu depuis [NovaGame](/docs/novagame/presentation). Tu peux aussi l'ouvrir avec `Ctrl+Alt+U` ou la commande **NovaGame : studio de jeu Unity** dans un dossier de projet Unity (sans jeu ouvert, ce raccourci ouvre l'onglet NovaGame). Réglage `novagame.autoOpen` : la vue du jeu s'ouvre seule dès que Unity tourne sur le jeu ouvert.

Au premier lancement dans un projet, le studio propose **Installer le pont** : un petit paquet d'éditeur, `Packages/com.orbit.bridge`, qui relie Unity à Orbit. Il ne s'inclut jamais dans tes builds. Si le projet contient une ancienne version du pont, la page le remplace et Unity recompile quelques secondes. Si Unity n'est pas ouvert, le studio l'indique et propose **Ouvrir dans Unity** ; il se connecte tout seul dès que l'éditeur est prêt.

## Les zones du studio

| Zone | Ce que tu peux faire |
|---|---|
| Barre du haut | **Lancer**, **Pause**, **Arrêter** le jeu, **Jouer ici** ([détails](/docs/novagame/jouer)), choisir la vue **Jeu** ou **Scène**, **Sélectionner**, **Enregistrer** la scène, **Recompiler**. |
| Vue | Ce que voit la caméra du jeu, ou la vue Scène de l'éditeur, rafraîchie en continu. **Sélectionner** (ou `S`) puis un clic sur un objet le sélectionne aussi dans Unity. |
| Hiérarchie | Tous les objets des scènes ouvertes, avec une recherche. Le menu **+ Objet** crée un Cube, une Sphère, une Capsule, un Cylindre, un Plan ou un objet vide. |
| Inspecteur | Chaque composant de l'objet choisi et ses valeurs : positions, rotations, couleurs, nombres, cases à cocher. Une case active l'objet, une icône le supprime, un composant se retire, un champ en ajoute un (Rigidbody, BoxCollider, AudioSource…). |
| Console | Les messages de Unity. Le filtre **Erreurs** ne garde que les erreurs, **Effacer** vide la liste. |
| Champ du bas | Une demande à l'agent, envoyée avec **Envoyer à Claude**. |

Les modifications faites dans l'inspecteur sont appliquées tout de suite dans Unity ; `Ctrl+Z` dans Unity les annule. **ouvrir le script** ouvre le fichier C# du composant dans Orbit. Une scène jamais enregistrée est rangée dans `Assets/Scenes` quand tu l'enregistres : le pont n'ouvre jamais de fenêtre de dialogue, qui gèlerait tout.

## Parler à l'agent depuis le studio

Le champ du bas envoie ta demande avec l'objet sélectionné (son chemin dans la scène et ses composants) à l'agent courant, ou démarre un agent avec ce message. L'agent est invité à utiliser les [outils `orbit-unity`](/docs/novagame/agent), à appeler `unity_refresh` après un script C# et à vérifier la console.

Dans la console, cliquer `Fichier.cs:42` ouvre la ligne dans Orbit, et **Corriger avec Claude** envoie l'erreur à l'agent avec son fichier et sa pile d'appels (les erreurs de compilation C# sont signalées comme telles).

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Studio de jeu | `Ctrl+Alt+U` | `⌥⌘U` |

Dans le studio, `S` active ou coupe la sélection d'un objet dans la vue.

## Avec ChatGPT

Les messages du studio sont envoyés à l'agent courant, quel qu'il soit. Les textes de la page n'ont pas été adaptés à ChatGPT.

## Limites

- Unity doit être ouvert à côté : Orbit le pilote, il ne le remplace pas.
- Unity ne relit les fichiers modifiés que lorsque sa fenêtre reprend la main : après un changement de script, clique dans Unity ou utilise **Recompiler**.
- Les changements faits pendant la lecture sont perdus à l'arrêt, comme dans Unity.
- Le pont ne démarre pas dans les processus d'import ni en mode batch de Unity.

## Voir aussi

- [Jouer dans Orbit](/docs/novagame/jouer)
- [L'agent et Unity](/docs/novagame/agent)
- [Présentation](/docs/novagame/presentation)
