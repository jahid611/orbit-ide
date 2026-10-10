---
title: Monter avec l'agent
description: L'agent ouvre, lit, monte, regarde et exporte ton montage avec les outils sc_* de StarCapture.
order: 11
icon: terminal
---

Tu peux confier un montage à l'agent : il pilote le même éditeur que toi, avec les mêmes opérations. Tout ce qu'il fait est une modification annulable, et tu vois le montage bouger en direct.

## À quoi ça sert

- Décrire un résultat (« retire les blancs, ajoute des sous-titres, un zoom sur les blagues ») au lieu de le faire clip par clip.
- Lui faire fabriquer un habillage (un filigrane, un style de texte) et le garder dans tes [Créations](/docs/starcapture/creations).
- Déléguer les tâches répétitives : couper les hésitations, poser des marqueurs, exporter dans plusieurs formats.

## Comment l'utiliser

1. Ouvre un montage dans StarCapture.
2. Clique sur **Monter avec Claude** en haut de l'éditeur, ou tape ta demande dans la zone de l'onglet **Sous-titres** de la bibliothèque puis **Envoyer**.
3. Orbit envoie à l'agent une ligne de contexte (le montage, la position de la tête de lecture, les clips sélectionnés) suivie de ta demande, dans le terminal de l'agent ouvert. S'il n'y en a pas, Orbit en démarre un. Si aucun terminal n'est disponible, le contexte est copié dans le presse-papiers pour que tu le colles toi-même.
4. L'agent utilise les outils `sc_*`. Tu peux aussi lui parler directement dans son terminal : « monte cette vidéo en vertical pour Shorts ».

Si tu sélectionnes des clips avant de demander, l'agent le sait, ce qui permet de dire « fais ça sur ces clips ».

## Les outils

Chaque agent lancé par Orbit reçoit le serveur MCP `starcapture` automatiquement, ainsi qu'une consigne qui lui dit de passer par StarCapture pour toute demande sur une vidéo, de lire le guide d'abord et de vérifier le résultat. L'outil agit sur le montage que tu as regardé en dernier.

| Outil | Rôle |
|---|---|
| `sc_guide` | Le mode d'emploi : modèle de données, toutes les opérations, méthode de monteur. L'agent le lit avant son premier montage. |
| `sc_open` | Ouvre une vidéo ou un projet `.starcapture`. `create` crée un montage vide (`vertical` pour du 1080 × 1920). |
| `sc_state` | État du montage : format, durée, tête de lecture, sélection, médias, pistes, clips, marqueurs. |
| `sc_import` | Importe des fichiers, éventuellement posés à la suite sur la timeline. |
| `sc_edit` | Applique une liste d'opérations comme une seule modification annulable. |
| `sc_transcribe` | Transcrit la parole d'un média, mots horodatés en temps de timeline. |
| `sc_silences` | Trouve les silences ; `apply` les retire et recolle. |
| `sc_frame` | Rend l'image du montage à un instant : l'agent voit ce que verra le spectateur. |
| `sc_seek` | Place la tête de lecture (et lance la lecture si demandé). |
| `sc_undo`, `sc_redo` | Annule et rétablit. |
| `sc_export` | Exporte la vidéo (préréglage, chemin, plage). |
| `sc_creations`, `sc_creation_save`, `sc_creation_apply`, `sc_creation_delete` | Lit, enregistre, applique et supprime les créations. |

### Les opérations de `sc_edit`

`addMedia`, `split`, `remove` (avec `ripple` pour recoller), `removeRanges` (retire des moments de toute la timeline et recolle), `update` (position, cadrage, couleur, images clés, texte, vitesse, volume, fondus, secousse, flou, miroir), `addText`, `transition`, `punchIn`, `duck` (la musique baisse sous la voix), `marker`, `removeMarker`, `track`, `project` (nom, taille, images par seconde, fond), `duplicate` et `removeMedia`.

Les types de transition acceptés sont `crossfade`, `dip-black`, `dip-white`, `slide-left`, `slide-right`, `slide-up`, `zoom-in` et `zoom-out`. Les styles de texte (`preset`) sont `youtube`, `beast`, `caption`, `title`, `subtitle`, `lowerThird`, `minimal` et `typewriter`.

Les exports acceptent les préréglages `master`, `1080p`, `4k`, `720p`, `prores` et `webm`.

## La méthode de monteur

Le guide de l'agent décrit une méthode pour des vidéos rythmées :

1. regarder le montage et transcrire ce qui est dit ;
2. retirer les silences, puis les phrases ratées et les hésitations ;
3. soigner les cinq premières secondes ;
4. donner du dynamisme avec des zooms sur les punchlines et des changements de cadrage ;
5. ajouter des mots-clés à l'écran et des sous-titres karaoké ;
6. poser la musique et la faire baisser sous la voix ;
7. vérifier avec `sc_frame`, puis exporter.

L'agent explique brièvement ce qu'il a changé, et tu peux tout annuler avec `Ctrl+Z`.

## Avec ChatGPT

Orbit convertit ses serveurs MCP au format de ChatGPT (Codex) pour chaque terminal, mais le pilotage de StarCapture par ChatGPT n'a pas été vérifié de bout en bout. Les textes des pages de StarCapture disent encore « Claude », même quand ChatGPT est choisi.

## Limites

- Un agent lancé en dehors d'Orbit ne reçoit ni les outils ni la consigne : le montage doit être piloté depuis un terminal d'agent d'Orbit.
- Il faut une fenêtre Orbit avec StarCapture ouverte ; sans elle, les outils répondent qu'aucune fenêtre n'est disponible.
- `sc_frame` rend une image de 960 pixels de large par défaut, 1280 au plus.

## Voir aussi

- [Terminaux d'agents](/docs/agents/terminaux)
- [Créations](/docs/starcapture/creations)
- [Export](/docs/starcapture/export)
