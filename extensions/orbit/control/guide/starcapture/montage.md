---
title: Monter
description: La timeline, les pistes, la coupe, le déplacement, la suppression et les coupes automatiques.
order: 3
icon: scissors
---

Le montage se fait sur la timeline : des pistes superposées, des clips posés dessus, une tête de lecture. Chaque geste est une modification annulable, et l'agent utilise exactement les mêmes opérations que toi.

## À quoi ça sert

Une vidéo que tu importes donne deux clips liés : l'image sur une piste vidéo et le son sur une piste audio. Les couper ou les déplacer agit sur les deux ensemble. Un projet neuf contient une piste **Textes**, deux pistes vidéo (**Vidéo 1**, **Vidéo 2**), une piste **Audio 1** et une piste **Musique**.

Les pistes se lisent de haut en bas : la première piste vidéo est dessinée au-dessus des autres, et les pistes de texte passent au-dessus de tout.

Poser un clip **écrase** ce qu'il recouvre sur sa piste (montage par écrasement). Le mode décalage change ça (voir plus bas).

## Comment l'utiliser

### Ajouter des médias

- Glisse un média de la bibliothèque sur la timeline, ou double-clique dessus pour le poser à la tête de lecture.
- Glisse des fichiers depuis l'explorateur d'Orbit ou depuis Windows sur la bibliothèque, l'image ou la timeline. Depuis Windows, le contenu est copié dans un dossier `medias/` à côté du montage. Si le dépôt est refusé, essaie en tenant `Maj`.
- Une musique importée va sur une piste audio libre, jamais sur la voix.

### Couper

- `S` coupe à la tête de lecture : les clips sélectionnés, ou tous les clips qui passent dessous.
- `C` active la lame : un clic sur un clip le coupe à l'endroit du clic. `V` revient à la sélection.
- Le magnétisme (`N`) aimante la tête de lecture, les bords des clips, les marqueurs et la zone entrée/sortie.

### Déplacer et rogner

- Glisse un clip pour le déplacer ; un glisser vertical le change de piste (de même nature).
- Glisse la poignée gauche ou droite d'un clip pour le raccourcir.
- Un clic sélectionne le clip et celui qui lui est lié. `Alt` le sélectionne seul ; `Maj` ou `Ctrl` ajoute ou retire un clip de la sélection.
- Un glisser dans le vide dessine un rectangle de sélection (lasso) ; un simple clic dans le vide place la tête de lecture.

### Supprimer

- `Suppr` supprime la sélection et laisse un trou.
- `Maj+Suppr` supprime et recolle : les clips suivants avancent.
- Le bouton de décalage (`R`) fait de ce recollage le comportement par défaut, y compris quand tu raccourcis un clip par la fin.

### Pistes

Le bouton plus ajoute une piste vidéo, audio ou texte. Sur chaque piste, des boutons masquent l'image (pistes vidéo et texte), coupent le son (pistes audio) et verrouillent la piste.

### Repères et zoom

- `M` pose un marqueur.
- `I` et `O` fixent l'entrée et la sortie : la zone est surlignée sur la règle et sert de points d'aimantation. `X` l'efface.
- `+` et `-` zooment, `Maj+Z` affiche tout le montage. `Ctrl` + molette zoome sous le curseur, `Maj` + molette défile horizontalement.
- `Ctrl+C`, `Ctrl+V` et `Ctrl+D` copient, collent à la tête de lecture et dupliquent les clips sélectionnés.

### Coupes automatiques

Dans l'onglet **Sous-titres** de la bibliothèque (ou avec les raccourcis de la timeline) :

- **Couper les silences** retire les blancs de la voix et recolle. Le seuil par défaut est de −38 dB, la durée minimale de 0,5 s, avec 0,12 s gardées autour de la parole.
- **Couper les hésitations** retire les « euh », « heu », « hum », « bah », « ben » repérés dans la transcription.

Ces deux coupes sont de vraies coupes nettes : le son ne claque pas, car l'export applique un fondu de 8 ms à chaque coupe.

## Raccourcis

Tous les raccourcis de l'éditeur sont dans [Raccourcis de StarCapture](/docs/starcapture/raccourcis). La touche `?` affiche un rappel.

## Limites

- Un clip sur une piste verrouillée ne peut pas être sélectionné ni déplacé.
- La transcription est nécessaire pour couper les hésitations ; elle se lance toute seule la première fois (voir [Texte et sous-titres](/docs/starcapture/texte-et-sous-titres)).

## Voir aussi

- [L'interface](/docs/starcapture/interface)
- [Effets, transitions et couleur](/docs/starcapture/effets-et-couleur)
- [Son](/docs/starcapture/son)
