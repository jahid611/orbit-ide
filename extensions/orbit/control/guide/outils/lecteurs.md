---
title: Documents, modèles 3D et polices
description: Orbit ouvre les PDF, les présentations PowerPoint, les documents Word, les modèles 3D et les fichiers de polices dans des lecteurs intégrés, en lecture seule.
order: 10
icon: book-open
---

Les fichiers PDF, PowerPoint, Word, les modèles 3D et les polices s'ouvrent dans Orbit au lieu de s'afficher comme du binaire illisible. Chaque lecteur est l'éditeur par défaut de ses fichiers et ne modifie jamais le fichier. Aucun compte ni aucun jeton n'est en jeu : tout est lu sur ton disque.

## Lecteur de PDF et de présentations

Un double-clic sur un `*.pdf` ouvre le lecteur de PDF ; un double-clic sur un `*.pptx`, `*.ppsx` ou `*.potx` ouvre le lecteur de présentations. Les deux partagent la même page :

- défilement continu et **miniatures** ;
- saut de page, **zoom** (liste, molette avec `Ctrl`, `Ctrl +`, `Ctrl -` et `Ctrl 0`), ajustement à la largeur ou à la page entière ;
- **recherche** avec `Ctrl+F`, résultat suivant par `Entrée` ;
- **mode présentation** : la touche `F` ou le bouton « Présenter » met la page seule sur tout l'écran (par le mode Zen d'Orbit), les flèches changent de page, `Échap` en sort ;
- bouton **« Demander à l'agent »** : le chemin du fichier, la page ou la diapositive en cours et le texte sélectionné partent vers l'agent, avec ta question ou, par défaut, la demande de lire le document et d'en dire l'essentiel ;
- **rechargement automatique** quand le fichier change sur le disque, par exemple parce qu'un agent l'a réécrit ;
- un bouton pour l'ouvrir avec l'application du système.

### PDF

Les pages sont dessinées à la demande, à la densité de ton écran, et libérées quand elles sont loin. Le texte est sélectionnable, les liens internes et externes fonctionnent, et le bouton de rotation pivote la page.

### Présentations

Les diapositives sont dessinées dans la page. Une police absente de la machine est remplacée, ce qui peut décaler légèrement la largeur du texte. Le bouton **« Rendu exact »** n'apparaît que si LibreOffice ou PowerPoint (sous Windows) est installé : il convertit la présentation en PDF avec ce logiciel pour un rendu identique à l'original. Le résultat est gardé tant que le fichier ne change pas.

## Lecteur Word

Un double-clic sur un `*.docx`, `*.docm` ou `*.dotx` ouvre le document mis en page, comme dans Word : pages blanches, en-têtes et pieds de page, tableaux, images, encadrés, notes de bas de page.

- **pages** : saut de page, flèches page précédente et suivante ; les pages tombent là où Word les avait mises au dernier enregistrement ;
- **zoom** : « Automatique » (taille réelle, réduite si la fenêtre est étroite), largeur, page entière, de 50 à 300 %, molette avec `Ctrl`, `Ctrl +`, `Ctrl -` et `Ctrl 0` ;
- **recherche** avec `Ctrl+F`, sans tenir compte des majuscules ni des accents ; `Entrée` passe au résultat suivant, `Maj+Entrée` au précédent ;
- le texte est sélectionnable, les liens vers le web s'ouvrent dans le navigateur, les renvois internes défilent jusqu'à leur cible ;
- bouton **« Demander à l'agent »** : le chemin du fichier, la page en cours et le texte sélectionné partent vers l'agent ;
- **rechargement automatique** quand le fichier change sur le disque, à la même position ;
- le bouton **« Rendu exact »** n'apparaît que si LibreOffice ou Word (sous Windows) est installé : il convertit le document en PDF avec ce logiciel, sans jamais modifier l'original, et l'ouvre dans le lecteur de PDF.

Le document est mis en page par Orbit, pas par Word : une police absente de la machine est remplacée, et une page très remplie peut déborder un peu plus bas que dans Word.

## Visionneuse 3D

Un double-clic sur un `*.glb` ou un `*.gltf` ouvre le modèle en 3D, éclairé comme dans un studio, posé sur un sol quadrillé à sa taille.

- **souris** : glisser pour tourner autour, clic droit (ou `Maj` + glisser) pour déplacer, molette pour s'approcher, double-clic sur le modèle pour tourner autour de ce point ;
- **Recentrer** (`F`), **rotation automatique** (`R`), **fil de fer** (`W`), **sol** (`G`), **fond clair ou sombre** (`B`) ;
- **animations** : si le modèle en contient, elles se lisent tout de suite ; une liste permet de choisir laquelle, `Espace` arrête ou relance ;
- **fiche du modèle** (`I`) : triangles, sommets, maillages, matériaux, textures, animations, squelette, taille en mètres ou centimètres, logiciel qui l'a créé, extensions glTF utilisées ;
- **Capture** : enregistre la vue en cours en PNG, à côté du modèle par défaut ;
- bouton **« Demander à l'agent »** : le chemin du fichier et la fiche du modèle partent vers l'agent ;
- **rechargement automatique** quand le fichier change sur le disque, sans bouger la caméra : pratique quand un agent régénère le modèle.

Les modèles compressés en Draco ou meshopt s'ouvrent comme les autres. Un `.gltf` qui range ses données et ses textures dans des fichiers à côté de lui les trouve tant qu'ils sont dans le même dossier ou un sous-dossier.

## Lecteur de polices

Un double-clic sur un `*.ttf`, `*.otf`, `*.ttc`, `*.woff` ou `*.woff2` ouvre une fiche de la police :

- son nom et le nombre de glyphes ;
- un champ où taper **ton propre texte** dans la police, avec un curseur de taille de 12 à 220 px ;
- une **échelle de tailles** (12 à 80 px) ;
- **tous les caractères** que la police dessine, lus dans sa table de correspondance ; un clic sur un caractère le copie ;
- la **fiche du fichier** : famille, style, version, auteur, licence.

Pour les formats compressés (`.woff`, `.woff2`), seul le nom du fichier est connu ; la police s'affiche, mais la fiche et la liste complète des caractères ne sont pas lues.

## Avec ChatGPT

Les lecteurs fonctionnent de la même façon. Seul le bouton d'envoi change de nom : il porte celui de l'IA choisie (« Demander à … »).

## Réglages

Orbit règle deux défauts du mode Zen pour la présentation : `zenMode.centerLayout` à `false` et `zenMode.showTabs` à `none`.

## Limites

- Les lecteurs sont en lecture seule : on ne modifie pas un PDF, une présentation, un document ni un modèle depuis Orbit.
- Le « Rendu exact » n'a pas été essayé, ni LibreOffice ni PowerPoint ni Word n'étant présents sur la machine de développement.
- Le lecteur Word ne lit pas les anciens fichiers `.doc` (avant 2007) : ouvre-les avec Word ou LibreOffice, ou demande à l'agent de les convertir.
- La visionneuse 3D ne lit que le glTF (`.glb`, `.gltf`). Les textures compressées en KTX2 ne sont pas affichées. Les formats `.fbx`, `.obj` et `.stl` ne sont pas encore pris en charge.
- Vérifié le 15 octobre 2026 sous Windows : un document Word de quatre pages avec tableaux (pages, zoom, recherche, rechargement), un modèle texturé, un modèle compressé en Draco avec une animation, un `.gltf` avec ses fichiers à part (rotation à la souris, fil de fer, fond clair, rechargement). La capture n'a été vérifiée que jusqu'à l'image ; la fenêtre d'enregistrement n'a pas été ouverte pendant l'essai.
- Le lecteur de polices est récent : la lecture des tables a été vérifiée sur des polices de Windows, mais la page n'a pas encore été vue à l'écran.
- Un agent qui utilise l'outil `open_file` d'Orbit ouvre désormais les documents, images et vidéos dans leur lecteur, au lieu de les afficher en texte.

## Voir aussi

- [L'agent pilote Orbit](/docs/agents/agent-pilote-orbit)
- [Terminaux d'agents](/docs/agents/terminaux)
- [Thèmes et fond d'écran](/docs/personnaliser/themes)
