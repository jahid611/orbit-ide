---
title: Studio
description: Une page unique pour régler les thèmes, l'accent, le fond d'écran, la disposition, l'éditeur, les terminaux et l'agent, avec aperçu immédiat.
order: 1
icon: settings
---

Le Studio rassemble sur une seule page les réglages d'apparence d'Orbit et les préférences de l'agent. Chaque changement s'applique tout de suite, sans redémarrer. Les valeurs sont enregistrées dans tes réglages utilisateur, donc valables pour tous tes projets.

## Comment l'utiliser

1. Ouvre le Studio avec `Ctrl+Alt+,` (`⌥⌘,`), ou avec la commande « Open Customization Studio » (`orbit.openStudio`).
2. Parcours les sections, de haut en bas.
3. Modifie un réglage : l'interface change en direct.

## Les sections

| Section | Ce qu'on y règle |
|---|---|
| Thème | Le thème de couleurs, le fond d'écran (Cosmos, Aucun, ou ta propre image). Voir [Thèmes et fond d'écran](/docs/personnaliser/themes). |
| Couleur d'accent | Une couleur appliquée aux boutons, au focus, aux onglets actifs, aux liens, aux pastilles et au curseur. |
| Disposition | Quatre dispositions complètes en un clic, à affiner ensuite. |
| Interface | Panneaux flottants, espace entre panneaux, arrondi, zoom global, police et taille du texte de l'interface, onglets en pilule, interface épurée, verre dépoli, animations, barre d'activité, explorateur, barre d'état, centre de commande, fil d'Ariane, onglets, thème d'icônes. |
| Éditeur | Police du code, taille, interligne, ligatures, curseur et son animation, défilement fluide, minimap, en-têtes collants, retour à la ligne, numéros de ligne, espaces visibles. |
| Terminaux | Position des terminaux, liste des onglets, police, taille, interligne, curseur. |
| Claude (ou ChatGPT) | Lancer l'agent à l'ouverture, modèle des nouveaux terminaux, mode de permission, langue des réponses, consignes ajoutées à chaque session, options supplémentaires, facturation, accès aux règles du projet (`CLAUDE.md`). |
| CSS libre | Une zone de texte pour des règles CSS appliquées à toute l'interface. Voir [CSS libre](/docs/personnaliser/css-libre). |
| Profil | Copier et importer sa configuration, ouvrir les raccourcis clavier. |

### Les dispositions

| Disposition | Description |
|---|---|
| Cursor | Explorateur à gauche, agent à droite, barre d'activité en haut. |
| Antigravity | Panneaux flottants arrondis, interface épurée, l'agent au centre. |
| Zen | Le code et rien d'autre : barre d'activité et barre d'état masquées. |
| Classique | La disposition de VS Code d'origine. |

Une disposition modifie plusieurs réglages à la fois (panneaux flottants, arrondi, onglets, barres affichées). Tu peux ensuite en ajuster un seul.

### Le profil

« Copier mon profil » place tes réglages du Studio au format JSON dans le presse-papiers ; « Importer depuis le presse-papiers » les applique, sur cette machine ou une autre. Un presse-papiers qui ne contient pas un profil valide est refusé avec un message.

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Ouvrir le Studio | `Ctrl+Alt+,` | `⌥⌘,` |

## Réglages

Les réglages d'interface du Studio sont les réglages `orbit.ui.*`, modifiables aussi dans les paramètres.

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.ui.floatingPanels` | `true` | Barres latérales, panneau et éditeur en cartes arrondies séparées par un espace. |
| `orbit.ui.panelGap` | `4` | Espace en pixels entre les panneaux flottants (0 à 16). |
| `orbit.ui.cornerRadius` | `10` | Arrondi en pixels des panneaux, champs, boutons et widgets (0 à 24). |
| `orbit.ui.fontFamily` | vide | Police de toute l'interface, éditeur exclu ; vide, la police du système. |
| `orbit.ui.fontSize` | `0` | Taille du texte de l'interface en pixels (0 à 20) ; `0` garde la taille par défaut. |
| `orbit.ui.compactTabs` | `true` | Onglets d'éditeur plus fins, en pilule. |
| `orbit.ui.minimalChrome` | `false` | Masque bordures et séparateurs pour une interface épurée. |
| `orbit.ui.glass` | `true` | Flou derrière les panneaux, menus et sélecteurs, comme un verre dépoli. |
| `orbit.ui.animations` | `true` | Animation des survols et de l'arrivée des menus, sélecteurs et notifications. |
| `orbit.ui.wallpaper` | `cosmos` | Fond d'écran : `cosmos`, `none`, ou le chemin absolu d'une image. |
| `orbit.ui.splashScreen` | `true` | Écran de chargement animé au lancement de la fenêtre. |
| `orbit.ui.customCss` | vide | CSS appliqué en direct à toute l'interface. |

## Limites

- Le fond d'écran ne se voit qu'avec un thème translucide comme Orbit Cosmos.
- Le verre dépoli sollicite la carte graphique : coupe `orbit.ui.glass` si l'interface devient moins fluide.
- Le profil exporté ne contient que les réglages que le Studio sait modifier, et la personnalisation des couleurs d'accent.

## Voir aussi

- [Thèmes et fond d'écran](/docs/personnaliser/themes)
- [Icônes](/docs/personnaliser/icones)
- [CSS libre](/docs/personnaliser/css-libre)
- [Premier lancement](/docs/demarrer/premier-lancement)
