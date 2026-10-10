---
title: CSS libre
description: Injecte tes propres règles CSS dans toute l'interface d'Orbit ; elles s'appliquent en direct.
order: 4
icon: terminal
---

Orbit est un éditeur à base de technologies web : son interface est du HTML stylé par du CSS. Le réglage `orbit.ui.customCss` te permet d'ajouter tes règles, qui s'appliquent immédiatement à toute la fenêtre, sans redémarrer.

## À quoi ça sert

Pour un détail que les réglages du [Studio](/docs/personnaliser/studio) ne couvrent pas : la couleur de fond d'une barre, le poids de la police d'un onglet actif, la taille d'un bouton.

## Comment l'utiliser

1. Ouvre le Studio (`Ctrl+Alt+,`, `⌥⌘,`) et va à la section « CSS libre ».
2. Écris tes règles dans la zone de texte.
3. Quitte le champ, ou appuie sur `Ctrl+Entrée` (`⌘⏎`) : le CSS est appliqué.

Tu peux aussi modifier `orbit.ui.customCss` directement dans les paramètres.

### Exemples

```css
.part.sidebar { background: #0b0b14 !important; }
.monaco-workbench .tab.active { font-weight: 600; }
```

## Comment ça s'applique

Orbit regroupe ses propres règles d'interface (panneaux flottants, arrondis, verre dépoli, fond d'écran) dans une feuille de style, et ajoute ton CSS à la fin. Tes règles sont donc lues après les siennes. Comme plusieurs de ses règles utilisent `!important`, il faut souvent l'ajouter aux tiennes pour qu'elles l'emportent, comme dans le premier exemple.

> **Astuce** Pour trouver le sélecteur d'un élément, ouvre les outils de développement de la fenêtre avec la commande « Developer: Toggle Developer Tools » et inspecte l'élément.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.ui.customCss` | vide | CSS brut ajouté à l'interface et appliqué en direct. |

## Limites

> **Attention** Une règle trop large peut rendre l'interface inutilisable (par exemple un `display: none` sur un conteneur général). Pour revenir en arrière, vide le champ « CSS libre » du Studio, ou le réglage `orbit.ui.customCss` dans les paramètres.

- Le CSS touche toute la fenêtre d'Orbit et n'est pas vérifié avant d'être appliqué.
## Voir aussi

- [Studio](/docs/personnaliser/studio)
- [Thèmes et fond d'écran](/docs/personnaliser/themes)
- [Dépannage](/docs/demarrer/depannage)
