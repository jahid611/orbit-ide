---
title: Enregistrement d'écran
description: Filme ton écran d'un clic, arrête-le d'un clic, et la vidéo s'ouvre dans StarCapture prête à être montée.
order: 10
icon: film
---

StarCapture peut filmer l'écran sans autre logiciel. Une même commande démarre et arrête l'enregistrement ; à l'arrêt, la vidéo s'ouvre dans l'éditeur.

## À quoi ça sert

Faire une démonstration, un tutoriel ou une capture d'un bug, puis la couper et la sous-titrer tout de suite dans le même outil.

## Comment l'utiliser

1. Ouvre l'onglet StarCapture de la barre d'activité et clique sur **Enregistrer l'écran** (ou le bouton d'enregistrement du titre de la vue). La commande **StarCapture : Enregistrer l'écran (démarrer / arrêter)** est aussi dans la palette.
2. Un compteur rouge apparaît dans la barre d'état, à gauche, avec le temps écoulé.
3. Pour arrêter, clique sur ce compteur ou relance la même commande.
4. La vidéo s'ouvre dans StarCapture.

Les fichiers sont rangés dans un dossier `enregistrements/` à la racine du projet ouvert, sous le nom `ecran-AAAAMMJJ-HHMM.mp4` (heure locale). Sans projet ouvert, le dossier est `~/Videos/StarCapture/enregistrements/`.

## Ce que StarCapture capture

ffmpeg filme l'écran avec ce que chaque système fournit : `gdigrab` sous Windows (tout le bureau, souris comprise), `avfoundation` sous macOS (le premier écran, souris comprise) et `x11grab` sous Linux (l'écran indiqué par `DISPLAY`). La vidéo est encodée en H.264 (préréglage rapide, qualité constante 20) pour que la capture ne prenne pas de retard, avec des dimensions paires.

La commande ne capture que l'image : aucune entrée audio n'est demandée à ffmpeg. Pour avoir du son, importe-le séparément dans le montage.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `starcapture.recordFps` | `30` | Images par seconde de l'enregistrement, de 5 à 60. |
| `starcapture.ffmpegPath` | vide | Chemin de ffmpeg si StarCapture ne le trouve pas. |

## Limites

- L'enregistrement a besoin de ffmpeg (voir [Présentation](/docs/starcapture/presentation)).
- Sous macOS, le système demande l'autorisation d'enregistrer l'écran la première fois. Le périphérique d'écran utilisé est le numéro 1, qui correspond au premier écran sur un Mac équipé d'une seule caméra.
- Si ffmpeg s'arrête de lui-même (la capture n'a pas pu démarrer, par exemple), un message d'erreur donne le code de sortie et la dernière ligne du journal.
- Une vidéo de moins de 2 Ko est considérée comme vide et signalée en erreur.

## Voir aussi

- [Présentation](/docs/starcapture/presentation)
- [Monter](/docs/starcapture/montage)
- [Texte et sous-titres](/docs/starcapture/texte-et-sous-titres)
