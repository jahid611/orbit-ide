---
title: PhotoCraft
description: Retoucher les images du projet avec l'agent, sur ta machine : recadrer, redimensionner, détourer, ajouter du texte, exporter, travailler des fichiers PSD.
order: 11
icon: image
---

PhotoCraft est un logiciel libre de retouche d'images, du projet ArtCraft, que l'agent pilote par des commandes. Tu lui demandes « recadre cette photo en carré » ou « passe le logo en blanc sur fond transparent » : il le fait sur ta machine, sans abonnement, et le fichier arrive dans ton projet.

## À quoi ça sert

- Préparer les images d'un site : redimensionner, recadrer, convertir en WebP ou en JPEG léger.
- Détourer un sujet, poser un texte, régler la lumière ou les couleurs.
- Ouvrir et enregistrer des fichiers PSD avec leurs calques.

## Comment l'utiliser

1. Installe-le depuis le [Magasin](/docs/outils/magasin) (carte PhotoCraft, bouton **Installer**).
2. Ouvre un **nouvel** agent : les agents déjà ouverts n'ont pas ses outils.
3. Demande ta retouche en donnant le fichier : « redimensionne `public/hero.png` à 1600 px de large et exporte-le en WebP ».

Pour regarder l'agent travailler, ouvre « PhotoCraft » dans **Outils du projet** : l'application s'affiche dans un onglet d'Orbit et l'agent agit dessus (voir le [Magasin](/docs/outils/magasin)).

## Ce que l'agent a en main

Deux jeux d'outils, les mêmes commandes dans les deux :

| Outils | Quand |
|---|---|
| `mcp__photocraft__*` | Toujours disponibles. Travaillent sur les fichiers, sans fenêtre. |
| `mcp__photocraft_live__*` | Agissent sur le PhotoCraft affiché dans Orbit. Ne répondent que si sa page est ouverte ; sinon ils disent qu'ils ne peuvent pas se connecter. |

Les outils eux-mêmes :

| Outil | Rôle |
|---|---|
| `doc_open` | Ouvrir une image (`path`). |
| `doc_new` | Nouveau document (`width`, `height`, `background`). |
| `doc_inspect` | L'état du document : calques (avec leur `id`), sélection, historique. |
| `command_list` | Chercher une commande et ses paramètres (`filter`, par exemple `blur`, `crop`, `type.`). |
| `command_run` | Lancer une commande (`id`, `params`). |
| `command_batch` | Plusieurs commandes d'un coup (`steps`). |
| `render_preview` | Voir le résultat (image, `max_side` jusqu'à 2048). |
| `doc_export` | Écrire le résultat dans un autre format (`path`, `quality`). |
| `doc_save` | Enregistrer le document (`.psd` ou `.pcraft` gardent les calques). |

## Règles pour l'agent

- **Les chemins sont relatifs au dossier du projet**, avec des `/`. PhotoCraft refuse de lire ou d'écrire ailleurs.
- **Ne jamais écraser l'original** sauf demande explicite : exporter sous un autre nom.
- **Chercher avant d'inventer** : `command_list` avec un filtre donne l'identifiant exact et la forme des paramètres. Il y a plus de 500 commandes ; leurs noms suivent les menus de Photoshop (`image.imageSize`, `filter.blur.gaussianBlur`, `layer.newAdjustmentLayer.curves`).
- **Le calque actif compte.** Une commande de pixels (filtre, réglage, détourage) échoue si le calque actif est un calque de texte ou de réglage. Lire les `id` avec `doc_inspect`, puis viser le calque avec le paramètre `layer`, ou le choisir par `layer.select {"layer": id}`.
- **Regarder avant de conclure** : `render_preview` après la retouche.
- **Dire quand ça échoue.** PhotoCraft est en alpha : une commande peut manquer ou être inactive. Le message d'erreur dit pourquoi. Dans ce cas, le dire et passer par un autre moyen.

## Recettes vérifiées

Chaque suite ci-dessous a été jouée telle quelle (PhotoCraft 0.7.0).

**Redimensionner et convertir en WebP**

```
doc_open     {"path": "public/hero.png"}
command_run  {"id": "image.imageSize", "params": {"width": 1600}}
doc_export   {"path": "public/hero.webp", "quality": 80}
```

Une seule dimension suffit : l'autre suit les proportions.

**Recadrer**

```
command_run  {"id": "image.crop", "params": {"x": 0, "y": 0, "width": 800, "height": 800}}
doc_export   {"path": "public/hero-carre.jpg", "quality": 85}
```

`image.canvasSize` agrandit ou réduit la zone sans toucher à l'image ; `image.trim` retire les bords transparents.

**Détourer le sujet (fond transparent)**

```
command_run  {"id": "layer.removeBackground", "params": {}}
doc_export   {"path": "public/sujet.png"}
```

La commande pose un masque autour du sujet détecté. Exporter en PNG ou en WebP pour garder la transparence, jamais en JPEG. Le résultat dépend de l'image : toujours le regarder.

**Noir et blanc, lumière, contraste**

```
command_batch {"steps": [
  {"id": "image.adjustments.desaturate"},
  {"id": "image.adjustments.brightnessContrast", "params": {"contrast": 30}}
]}
```

Les mêmes réglages existent en calques de réglage, qui ne modifient pas les pixels : `layer.newAdjustmentLayer.curves`, `.levels`, `.hueSaturation`, `.blackWhite`…

**Ajouter un texte**

```
command_run  {"id": "type.create", "params": {"x": 40, "y": 120, "text": "Bienvenue"}}
```

`x` et `y` placent la ligne de base. `type.setStyle` règle police, taille et couleur ; `type.fonts` liste les polices. Après `type.create`, le calque actif est le texte : revenir au calque de l'image avant un filtre.

**Flou, netteté, retournement**

```
command_run  {"id": "filter.blur.gaussianBlur", "params": {"radius": 6}}
command_run  {"id": "filter.sharpen.smartSharpen", "params": {"amount": 80}}
command_run  {"id": "image.imageRotation.flipCanvasHorizontal"}
```

**Garder un fichier de travail**

```
doc_save     {"path": "design/hero.psd"}
```

## Limites

- PhotoCraft est en alpha : son éditeur dit lui-même qu'il ne remplace pas encore Photoshop au quotidien. Pas de génération d'images par IA (pour ça, voir [Higgsfield](/docs/outils/higgsfield)).
- Chaque outil demande ton accord à l'agent, comme tout outil.
- La vue dans Orbit et la fenêtre de l'application n'existent que sous Windows. Sur macOS et Linux, l'agent garde les outils sans fenêtre (non essayé).
- Orbit ne contient pas PhotoCraft et n'en est pas l'éditeur : il télécharge la version officielle du projet et la vérifie.

## Voir aussi

- [Magasin de compétences](/docs/outils/magasin)
- [Higgsfield](/docs/outils/higgsfield)
- [Captures et images](/docs/agents/captures-et-images)
