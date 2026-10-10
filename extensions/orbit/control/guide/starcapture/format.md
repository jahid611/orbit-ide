---
title: Format du projet
description: Proportions, définition, taille libre et cadrage des vidéos qui n'ont pas la forme du cadre.
order: 8
icon: settings
---

Le format du projet est la taille de l'image finale. Tu le règles dans l'inspecteur quand aucun clip n'est sélectionné (section **Format** de l'onglet **Projet**). Les proportions et la définition sont deux choix séparés : tu peux passer du 16:9 au 9:16 sans changer de définition, ou monter en 4K sans changer de forme.

## À quoi ça sert

Préparer une vidéo pour YouTube, pour les formats verticaux (Shorts, TikTok, Reels), pour Instagram ou pour un affichage carré, sans refaire le montage.

## Comment l'utiliser

Clique dans le vide de la timeline pour que rien ne soit sélectionné : l'inspecteur montre le projet.

### Proportions

| Proportions | Usage indiqué dans l'interface |
|---|---|
| 16:9 | YouTube |
| 9:16 | Shorts, TikTok |
| 1:1 | Carré |
| 4:5 | Instagram |
| 4:3 | Classique |
| 21:9 | Cinéma |

### Définition

Un menu choisit la définition : 720p (HD), 1080p (Full HD), 1440p (2K) ou 2160p (4K). Elle s'applique au plus petit côté de l'image : en 9:16 à 1080p, l'image fait 1080 × 1920.

### Taille libre

Deux champs, largeur et hauteur, permettent une taille précise (de 16 à 7680 pixels, par pas de 2). Les valeurs sont arrondies à un nombre pair, ce qu'exigent les encodeurs.

### Remplir ou Entières

Quand une vidéo n'a pas la forme du cadre, **Vidéos** propose deux choix :

- **Remplir** : la vidéo remplit le cadre, quitte à être rognée ;
- **Entières** : la vidéo est montrée en entier, avec des bandes.

Le choix agit sur les vidéos dont la forme diffère de celle du cadre. Les images (logos, bandeaux transparents) restent toujours entières.

### Images par seconde et fond

Les images par seconde se choisissent parmi 24, 25, 30, 50 et 60. La couleur de fond est visible là où aucun clip ne couvre l'image.

### Nouveau montage

La commande **Nouveau montage** propose quatre formats de départ : horizontal 16:9 en 1920 × 1080, vertical 9:16 en 1080 × 1920, carré 1:1 en 1080 × 1080 et 4K 16:9 en 3840 × 2160.

## Ce qui se passe quand tu changes de format

Les positions, les tailles de texte, les contours, les ombres et les images clés sont comptés en pixels du cadre. Quand le cadre change, ils suivent : les positions suivent chaque côté, les tailles suivent le côté qui a le plus rétréci pour qu'un texte qui tenait continue de tenir. Un titre réglé en 4K ne double donc pas de taille en 1080p.

Si la forme change (par exemple de 16:9 à 9:16), les vidéos remplissent le nouveau cadre en étant rognées, sauf si tu as choisi **Entières**. Les images restent entières.

## Limites

- Il n'y a pas encore de fond flouté derrière une vidéo montrée en entier : les bandes prennent la couleur de fond du projet.
- Le recalcul des textes lors d'un changement de format n'a pas été vérifié à l'écran sur un montage contenant des textes.

## Voir aussi

- [Texte et sous-titres](/docs/starcapture/texte-et-sous-titres)
- [Export](/docs/starcapture/export)
