---
title: Thèmes et fond d'écran
description: Six thèmes de couleurs, une couleur d'accent au choix et un fond d'écran spatial ou ta propre image.
order: 2
icon: palette
---

Orbit livre six thèmes de couleurs. Le thème par défaut, Cosmos, est translucide et laisse voir un fond d'écran spatial derrière l'interface.

## Les six thèmes

| Thème | Type | Fond de l'éditeur | Accent |
|---|---|---|---|
| Orbit Cosmos (défaut) | sombre, translucide | `#0a0918cc` | violet `#8b7bff` |
| Orbit Midnight | sombre | `#0d0e1a` | violet `#8b7bff` |
| Orbit Aurora | sombre | `#0a1416` | vert d'eau `#2dd4bf` |
| Orbit Ember | sombre | `#17110e` | orange `#fb923c` |
| Orbit Void | sombre | `#000000` | rouge `#f43f5e` |
| Orbit Paper | clair | `#fbfaf7` | violet `#6d5dfc` |

Cosmos définit les seize couleurs de terminal de façon logique (le rouge est rouge, le vert est vert) pour que les applications gardent leurs couleurs exactes dans les terminaux.

## Changer de thème

- Dans le [Studio](/docs/personnaliser/studio), section « Thème » : choisis une vignette.
- Ou avec la palette de commandes : « Preferences: Color Theme » (`workbench.action.selectTheme`). Le réglage est `workbench.colorTheme`.

Le sélecteur propose aussi les thèmes de tes extensions.

## Couleur d'accent

Dans le Studio, la section « Couleur d'accent » remplace la couleur principale du thème : boutons, bordure de focus, barre de progression, liens, pastilles, onglet actif, curseur. Le retrait de l'accent rend ses couleurs au thème. Cette personnalisation s'écrit dans `workbench.colorCustomizations`.

## Fond d'écran

Le réglage `orbit.ui.wallpaper` choisit l'image peinte derrière toute l'interface :

| Valeur | Résultat |
|---|---|
| `cosmos` | La scène spatiale d'Orbit (défaut). |
| `none` | Aucun fond d'écran. |
| un chemin absolu | Ta propre image, par exemple `/chemin/vers/image.jpg`. |

Dans le Studio, les boutons « Cosmos » et « Aucun » et le champ « Ou ta propre image » règlent la même chose. Orbit pose un voile à la couleur du thème sur l'image pour que les espaces entre panneaux ne soient jamais trop clairs.

> **Astuce** Pour qu'une image personnelle se voie, garde un thème translucide comme Cosmos : les autres thèmes ont un fond opaque qui la recouvre.

## Écran de chargement

Un écran de chargement animé s'affiche au lancement de la fenêtre. Le réglage `orbit.ui.splashScreen` le désactive.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `workbench.colorTheme` | `Orbit Cosmos` | Le thème de couleurs. |
| `orbit.ui.wallpaper` | `cosmos` | `cosmos`, `none` ou le chemin absolu d'une image. |
| `orbit.ui.glass` | `true` | Flou derrière panneaux et menus. |
| `orbit.ui.splashScreen` | `true` | Écran de chargement animé. |

## Limites

- Le fond d'écran ne se voit qu'avec un thème translucide ; seul Cosmos l'est parmi les six.
- Le verre dépoli (`orbit.ui.glass`) sollicite la carte graphique : désactive-le sur un matériel lent.
- Le chemin d'une image personnelle doit être absolu.

## Voir aussi

- [Studio](/docs/personnaliser/studio)
- [Icônes](/docs/personnaliser/icones)
- [CSS libre](/docs/personnaliser/css-libre)
