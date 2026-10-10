---
title: PDF, présentations et polices
description: Orbit ouvre les PDF, les présentations PowerPoint et les fichiers de polices dans des lecteurs intégrés, en lecture seule.
order: 10
icon: book-open
---

Les fichiers PDF, PowerPoint et de polices s'ouvrent dans Orbit au lieu de s'afficher comme du binaire illisible. Chaque lecteur est l'éditeur par défaut de ses fichiers et ne modifie jamais le fichier. Aucun compte ni aucun jeton n'est en jeu : tout est lu sur ton disque.

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

- Les lecteurs sont en lecture seule : on ne modifie pas un PDF ni une présentation depuis Orbit.
- Le « Rendu exact » n'a pas été essayé, ni LibreOffice ni PowerPoint n'étant présents sur la machine de développement.
- Le lecteur de polices est récent : la lecture des tables a été vérifiée sur des polices de Windows, mais la page n'a pas encore été vue à l'écran.
- Un agent qui utilise l'outil `open_file` d'Orbit ouvre désormais les documents, images et vidéos dans leur lecteur, au lieu de les afficher en texte.

## Voir aussi

- [L'agent pilote Orbit](/docs/agents/agent-pilote-orbit)
- [Terminaux d'agents](/docs/agents/terminaux)
- [Thèmes et fond d'écran](/docs/personnaliser/themes)
