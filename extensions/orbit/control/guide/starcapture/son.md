---
title: Son
description: Volume d'écoute, son d'une vidéo, musique de fond qui baisse sous la voix et normalisation à l'export.
order: 7
icon: music
---

Dans StarCapture, le son d'une vidéo importée est un clip à part, lié à l'image. Cette page explique où régler quoi : le volume d'écoute du lecteur, le volume d'un clip, la musique et la normalisation finale.

## À quoi ça sert

- Écouter le montage plus ou moins fort sans toucher au résultat.
- Baisser ou couper le son d'une vidéo, ajouter un fondu.
- Faire baisser la musique quand quelqu'un parle.
- Sortir une vidéo dont le volume est homogène.

## Le volume d'écoute

Dans la barre de lecture, sous l'image, un haut-parleur et un curseur règlent le volume d'écoute (aussi en plein écran). C'est un réglage du lecteur, gardé d'un montage à l'autre, **jamais exporté** : il ne change rien au son de la vidéo finale. Un clic sur le haut-parleur coupe ou rétablit l'écoute.

## Le son d'une vidéo

Sélectionne le clip vidéo (ou la vidéo et son son ensemble) et ouvre l'onglet **Audio** de l'inspecteur. Il règle le clip de son lié à l'image :

- **Volume** de 0 à 2, affiché en dB (1 = 0 dB, 2 = environ +6 dB) ;
- **Fondu d'entrée** et **Fondu de sortie**, en secondes ;
- **Couper le son** / **Rétablir le son**, **0 dB** et **En fond** (volume à 0,15) ;
- **Détacher** : retire le lien entre l'image et le son. Le son devient un clip à part, que tu déplaces, coupes et supprimes sans l'image.

Une fois détaché, ou si la vidéo n'a pas de son, l'inspecteur le dit : le son se règle alors sur son propre clip, dans les pistes audio.

Pour un clip de son ou de musique, l'onglet **Audio** propose le volume (avec image clé), **Musique de fond**, **0 dB** et **Couper**.

## Les pistes audio

Sur chaque piste audio, un bouton coupe le son de toute la piste. Une musique importée va sur une piste audio libre, jamais sur la voix. Les clips son montrent leur forme d'onde et leur niveau en dB quand il n'est pas à 0.

## Musique sous la voix

Dans l'onglet **Sous-titres** de la bibliothèque, **Musique sous la voix** applique l'opération `duck` : la musique baisse toute seule quand on parle, d'après la transcription de la voix. Le niveau par défaut est 0,2. Il faut une musique sur une piste audio et une voix transcrite (la transcription se lance si elle manque). Sans musique, StarCapture te le dit.

## Normalisation à l'export

À l'export, le son est mélangé piste par piste, avec un fondu de 8 ms sur chaque coupe pour éviter les claquements, puis **normalisé à −14 LUFS**, le niveau visé par YouTube, TikTok et Instagram, avec une limite à 0,97 contre l'écrêtage. Cette normalisation est toujours active.

## Limites

- Le volume d'un clip s'arrête à 2 (environ +6 dB).
- Le réglage du son d'une vidéo depuis l'onglet **Audio** est récent : s'il ne répond pas comme prévu, sélectionne le clip de son sur sa piste audio, il porte les mêmes réglages.

## Voir aussi

- [Monter](/docs/starcapture/montage)
- [Export](/docs/starcapture/export)
- [Texte et sous-titres](/docs/starcapture/texte-et-sous-titres)
