---
title: Créations
description: Ta bibliothèque personnelle d'effets, de styles de texte et de filigranes, réutilisable dans tous tes montages.
order: 6
icon: star
---

Une création est quelque chose que tu as réglé une fois et que tu veux retrouver : un effet, un style de texte ou une image à poser par-dessus la vidéo. La bibliothèque n'appartient à aucun projet : elle est à toi, et elle sert dans tous tes montages.

## À quoi ça sert

- Garder « ton style » : un zoom avec une couleur et des fondus, un titre aux couleurs de ta chaîne.
- Poser un filigrane ou un logo à la même place sur chaque vidéo.
- Laisser l'agent fabriquer un habillage, puis le réutiliser sans lui redemander.

## Les trois sortes de créations

| Sorte | Ce qu'elle garde | Ce qui se passe à l'application |
|---|---|---|
| Effet | Les réglages d'un clip : échelle, position, rotation, opacité, ajustement, recadrage, couleur, flou, secousse, miroir, vitesse, fondus, images clés, transition d'entrée | Les réglages sont posés sur les clips visés. Jamais l'emplacement dans le temps. |
| Texte | Le style d'un texte et sa place sur l'image | Un texte est ajouté à la tête de lecture, pour 3 secondes par défaut |
| Incrustation | Une image (png, jpg, webp, gif) avec sa position, son échelle et son opacité | L'image est posée sur toute la durée du montage, sur sa propre piste **Habillage** |

La bibliothèque garde sa propre copie de l'image d'une incrustation : elle survit au projet d'où elle vient.

## Comment l'utiliser

### Enregistrer

1. Règle un clip comme tu l'aimes : zoom, couleur, texte stylé, logo posé à la bonne place.
2. Sélectionne-le.
3. Dans l'onglet **Créations** de la bibliothèque, clique sur **Enregistrer la sélection** et donne un nom.

Un nom déjà pris remplace la création du même nom. La sorte est devinée : un clip de texte donne un style de texte, un clip image donne une incrustation, le reste donne un effet.

### Appliquer

Un clic sur la carte applique la création, en une modification annulable.

- Effet : sur la sélection, sinon sur le clip vidéo sous la tête de lecture.
- Texte : à la tête de lecture, avec les mots enregistrés ; tu les changes ensuite dans l'inspecteur.
- Incrustation : sur tout le montage, sur la piste **Habillage**.

### Supprimer

La croix d'une carte retire la création après confirmation. Les montages qui l'utilisent déjà ne changent pas.

## Avec l'agent

L'agent a des outils pour la bibliothèque (`sc_creations`, `sc_creation_save`, `sc_creation_apply`, `sc_creation_delete`). Quand tu lui demandes « mon style » ou « mon logo », il consulte d'abord la bibliothèque. Pour un filigrane sur mesure, il fabrique l'image, l'enregistre en incrustation avec sa place, puis l'applique. Détails dans [Monter avec l'agent](/docs/starcapture/agent).

## Où c'est stocké

La bibliothèque est un fichier `~/.orbit/starcapture/creations.json`, avec les images des incrustations dans `~/.orbit/starcapture/creations/`.

## Limites

- Une incrustation exige une image : un fichier vidéo n'est pas accepté.
- Un effet doit contenir au moins un réglage, sinon l'enregistrement échoue.

## Voir aussi

- [Effets, transitions et couleur](/docs/starcapture/effets-et-couleur)
- [Texte et sous-titres](/docs/starcapture/texte-et-sous-titres)
- [Monter avec l'agent](/docs/starcapture/agent)
