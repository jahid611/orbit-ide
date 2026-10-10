---
title: Export
description: Rends ton montage en MP4, ProRes ou WebM, avec l'encodeur de la carte graphique quand il existe.
order: 9
icon: download
---

L'export transforme le projet en fichier vidéo avec ffmpeg. Il garde la progression visible dans une notification, peut être annulé, et ne touche jamais à tes vidéos d'origine.

## Comment l'utiliser

1. Clique sur **Exporter** en haut de l'éditeur, ou utilise `Ctrl+E` (`⌘E` sur macOS). La commande **Exporter la vidéo…** est aussi dans la palette quand un montage est ouvert.
2. Choisis un préréglage dans la liste.
3. Suis la progression : pourcentage, temps restant estimé et étape en cours. Le bouton d'annulation de la notification arrête le rendu.
4. À la fin, un message donne la durée du rendu et propose **Afficher** (le fichier dans l'explorateur du système) ou **Lire**.

Un montage vide ne s'exporte pas : la timeline doit contenir au moins un clip.

## Préréglages

| Préréglage | Détail | Conteneur |
|---|---|---|
| Taille du projet | H.264, qualité maximale | MP4 |
| 1080p | YouTube, H.264 | MP4 |
| 4K | YouTube 2160p, H.264 | MP4 |
| 720p | Léger, H.264 | MP4 |
| ProRes 422 HQ | Master pour l'étalonnage ou un autre logiciel | MOV |
| WebM | VP9 + Opus, pour le web | WebM |

Pour les préréglages 1080p, 4K et 720p, la hauteur est imposée et la largeur suit la forme du projet. **Taille du projet** garde la définition réglée dans [Format du projet](/docs/starcapture/format).

## Où va le fichier

Par défaut, dans un dossier `exports` à côté du projet, sous le nom `<nom du montage>-AAAAMMJJ-HHMM.mp4`. Le réglage `starcapture.exportFolder` change le dossier. Pendant le rendu, le fichier s'écrit sous un nom caché (`.<nom>.rendu.mp4`) puis il est renommé à la fin : un fichier à moitié écrit n'apparaît jamais sous son vrai nom.

## Ce qui est fait pour toi

- **Encodeur matériel.** Avec `starcapture.hardwareEncoding` à `true` (le défaut), StarCapture teste l'encodeur de la carte graphique : NVENC, QuickSync ou AMF sous Windows et Linux, VideoToolbox sous macOS. Il l'utilise s'il le trouve, sinon il encode avec libx264 sur le processeur. Cela ne s'applique qu'aux MP4.
- **Rendu par parties.** Un film de 12 secondes ou plus en MP4 est découpé en parties d'environ 8 secondes, coupées de préférence là où un clip vidéo commence et jamais au milieu d'une transition. Les parties sont rendues quelques-unes à la fois (au plus un quart des cœurs, 3 au maximum), puis jointes sans réencodage. Le son est rendu une seule fois, en entier. ffmpeg tourne en priorité basse pour que la machine reste utilisable.
- **Textes gravés.** Tous les textes et sous-titres sont dessinés par libass dans un script unique, avec contour, ombre, encadré, karaoké et animations.
- **Son.** Un fondu de 8 ms sur chaque coupe, puis normalisation à −14 LUFS (voir [Son](/docs/starcapture/son)). Audio AAC à 320 kb/s pour le MP4, Opus à 192 kb/s pour le WebM, PCM pour le MOV.
- **Décodage ciblé.** Chaque source n'est lue qu'aux endroits utilisés : un montage de courts passages tirés de longues vidéos n'a pas à décoder ces vidéos en entier.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `starcapture.exportFolder` | vide | Dossier des exports. Vide : `exports` à côté du projet. |
| `starcapture.hardwareEncoding` | `true` | Encode avec la carte graphique quand elle est disponible. |
| `starcapture.ffmpegPath` | vide | Chemin de ffmpeg si StarCapture ne le trouve pas. |

## Avec l'agent

L'outil `sc_export` accepte un préréglage (`master`, `1080p`, `4k`, `720p`, `prores`, `webm`), un chemin de sortie et une plage `range=[début, fin]` pour n'exporter qu'une partie du montage. Voir [Monter avec l'agent](/docs/starcapture/agent).

## Limites

- Un seul export à la fois par montage.
- Les effets restent calculés par le processeur : même avec un encodeur matériel, un montage chargé en effets prend du temps.
- ProRes, WebM et les films de moins de 12 secondes sont rendus en un seul bloc ; un léger retard d'image peut apparaître à chaque clip dans ce mode.

## Voir aussi

- [Format du projet](/docs/starcapture/format)
- [Son](/docs/starcapture/son)
- [Monter avec l'agent](/docs/starcapture/agent)
