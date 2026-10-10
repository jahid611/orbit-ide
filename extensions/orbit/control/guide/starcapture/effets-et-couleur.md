---
title: Effets, transitions et couleur
description: Zooms, secousse, vitesse, transitions entre clips, étalonnage et images clés.
order: 5
icon: palette
---

Les effets de StarCapture sont des réglages de clip : on les applique en un clic depuis la bibliothèque, puis on les retouche dans l'inspecteur. Tous sont annulables.

## À quoi ça sert

Donner du rythme et du style à une vidéo : un zoom sur une punchline, une secousse sur un moment fort, une transition entre deux plans, un étalonnage cohérent sur tout le montage.

## Effets

L'onglet **Effets** s'applique au clip vidéo sélectionné, sinon au clip vidéo sous la tête de lecture (la piste la plus haute d'abord). Sans clip, il affiche « Place la tête de lecture sur un clip vidéo ».

| Effet | Ce qu'il fait |
|---|---|
| Zoom punch | Zoom rapide sur le moment de la tête de lecture, puis retour |
| Zoom jump cut | Coupe à la tête de lecture et recadre la suite plus serré (×1,18) |
| Secousse | Coupe à la tête de lecture et secoue la suite |
| Ken Burns | Zoom lent sur tout le clip (×1,15) |
| Accéléré x2 | Double la vitesse ; un second clic revient à la vitesse normale |
| Ralenti x0,5 | Divise la vitesse par deux ; un second clic revient à la normale |
| Miroir | Retourne l'image |
| Flou | Floute l'image (par exemple pour censurer) |

La vitesse se règle aussi dans l'onglet **Vidéo** de l'inspecteur : de ×0,25 à ×8. Le son lié à l'image suit la vitesse.

## Transitions

L'onglet **Transitions** s'applique au début du clip sélectionné (ou du clip sous la tête de lecture). Huit transitions sont proposées :

- Fondu enchaîné, Fondu au noir, Flash blanc ;
- Glisser à gauche, Glisser à droite, Glisser vers le haut ;
- Zoom avant, Zoom arrière.

Le choix **Aucune** retire la transition. Dans l'onglet **Animation** de l'inspecteur, tu changes le type et la durée (0,5 s par défaut). Les fondus d'entrée et de sortie d'un clip se règlent dans le même onglet.

## Couleur

Sous les effets, huit étalonnages : Aucun, Vif, Cinéma, Chaud, Froid, Noir et blanc, Délavé, YouTube. Ils règlent d'un coup la luminosité, le contraste, la saturation, la teinte, la température et la vignette du clip vidéo. L'onglet **Couleur** de l'inspecteur donne chaque curseur :

| Curseur | Plage |
|---|---|
| Luminosité, Contraste, Saturation | −1 à 1 |
| Température | −1 (froid) à 1 (chaud) |
| Teinte | −180° à 180° |
| Vignette | 0 à 1 |
| Flou | 0 à 10 |
| Secousse | 0 à 1 |

L'onglet **Vidéo** de l'inspecteur règle le cadre : ajustement (Entier, Remplir, Étirer), position, échelle, rotation, opacité, miroir, et un recadrage de chaque côté (jusqu'à 45 %).

## Images clés

Position X, position Y, échelle, rotation, opacité et volume ont un losange à côté de leur valeur. Un clic pose une image clé à la tête de lecture (un second clic la retire). Une fois qu'une propriété a des images clés, modifier sa valeur modifie l'image clé de la tête de lecture. Ainsi tu animes un zoom ou un déplacement sans quitter l'inspecteur.

## Limites

- Les effets sont calculés par le processeur à l'export, ce qui pèse sur la durée du rendu (voir [Export](/docs/starcapture/export)).
- Les effets de la bibliothèque agissent sur les clips vidéo ; un clip audio ou texte n'est pas ciblé.

## Voir aussi

- [Monter](/docs/starcapture/montage)
- [Créations](/docs/starcapture/creations) pour enregistrer un réglage et le réutiliser
