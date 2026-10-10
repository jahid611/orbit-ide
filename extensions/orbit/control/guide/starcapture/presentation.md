---
title: Présentation
description: StarCapture est l'éditeur vidéo intégré à Orbit : montage multipiste, sous-titres, export, à la main ou avec l'agent.
order: 1
icon: film
---

StarCapture est l'éditeur vidéo d'Orbit. Il s'ouvre dans un onglet de l'éditeur, comme un fichier, et sert à monter une vidéo sans quitter le projet : couper, ajouter des textes et des sous-titres, régler le son, exporter. Tu peux tout faire à la main, ou confier le montage à l'agent, qui pilote le même éditeur que toi.

![L'éditeur StarCapture dans Orbit](/captures/starcapture.png)

## À quoi ça sert

- Monter des vidéos de plusieurs minutes avec une timeline à plusieurs pistes (images, sons, textes).
- Générer des sous-titres mot par mot à partir de la parole, avec une transcription faite sur ta machine.
- Retirer automatiquement les silences et les hésitations.
- Exporter en MP4, ProRes ou WebM, en profitant de la carte graphique quand elle sait encoder.
- Demander à l'agent de monter à ta place avec les outils `sc_*` (voir [Monter avec l'agent](/docs/starcapture/agent)).

Ton fichier vidéo n'est jamais modifié. Ouvrir une vidéo crée un projet `<nom de la vidéo>.starcapture` (un fichier JSON) à côté d'elle ; tout le montage vit dans ce projet.

## Comment l'utiliser

1. Ouvre l'onglet StarCapture de la barre d'activité (`Ctrl+Alt+S`, `⌥⌘S` sur macOS), ou clique sur le bouton caméra de la barre du terminal.
2. Choisis **Nouveau montage**, **Ouvrir une vidéo ou un montage…** ou **Importer des vidéos, sons, images…**. Tu peux aussi faire un clic droit sur une vidéo, un son ou une image dans l'explorateur et choisir **Monter dans StarCapture**.
3. Un double-clic sur un média de la bibliothèque le pose sur la timeline, à la tête de lecture.
4. Coupe, ajoute des textes, règle le son (voir [Monter](/docs/starcapture/montage)).
5. Exporte avec `Ctrl+E` (voir [Export](/docs/starcapture/export)).

Un montage ouvert est enregistré tout seul 1,5 seconde après chaque modification. Annuler et rétablir passent par `Ctrl+Z` et `Ctrl+Maj+Z`, sur 300 niveaux.

Les formats ouverts par défaut dans StarCapture sont `mp4`, `mov`, `m4v`, `webm`, `mkv` et `avi`, ainsi que les projets `.starcapture`.

## Prérequis

StarCapture a besoin de ffmpeg et de ffprobe pour analyser, encoder et enregistrer. Il les cherche seul : réglage `starcapture.ffmpegPath`, puis le `PATH`, puis l'installation de winget (Windows) ou de Homebrew (macOS). S'il ne les trouve pas, il te le dit et propose `winget install Gyan.FFmpeg` sous Windows ou `brew install ffmpeg` sous macOS.

La transcription utilise whisper.cpp, téléchargé une seule fois sous Windows. Sous macOS et Linux, il doit être dans le `PATH` (`brew install whisper-cpp` sur macOS).

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `starcapture.ffmpegPath` | vide | Chemin de ffmpeg. Vide : StarCapture le cherche. |
| `starcapture.exportFolder` | vide | Dossier des exports. Vide : dossier `exports` à côté du projet. |
| `starcapture.hardwareEncoding` | `true` | Encode avec la carte graphique quand elle est disponible. |
| `starcapture.transcriptionModel` | `small` | Modèle de transcription : `base`, `small` ou `medium`. |
| `starcapture.recordFps` | `30` | Images par seconde de l'enregistrement d'écran (5 à 60). |

## Limites

- Les pages de StarCapture parlent encore de Claude dans leurs textes, même si tu utilises ChatGPT.
- La transcription de secours (si whisper.cpp ne démarre pas) tourne dans la page, sur le processeur, plus lentement.

## Voir aussi

- [L'interface](/docs/starcapture/interface)
- [Monter](/docs/starcapture/montage)
- [Monter avec l'agent](/docs/starcapture/agent)
- [Raccourcis de StarCapture](/docs/starcapture/raccourcis)
