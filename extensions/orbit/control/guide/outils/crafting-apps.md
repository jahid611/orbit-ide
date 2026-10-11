---
title: Crafting Apps
description: La suite créative libre d'ArtCraft pilotée par l'agent : dessin vectoriel, photo, montage vidéo, animation, mise en page, PDF, son, texte, tableur, présentations, dessin technique.
order: 12
icon: image
---

Les Crafting Apps sont douze logiciels libres du projet ArtCraft. Chacun est l'équivalent d'un logiciel connu et se pilote entièrement par des commandes : l'agent s'en sert sur ta machine, sans abonnement, et les fichiers arrivent dans ton projet. Tu les installes une par une depuis le [magasin](/docs/outils/magasin).

PhotoCraft a sa propre page, avec des suites de commandes vérifiées : [PhotoCraft](/docs/outils/photocraft). Cette page couvre les onze autres.

## Les applications

| Application | Comme | Outils de l'agent | Lancer une commande | Tenue au dossier du projet |
|---|---|---|---|---|
| VectorCraft | Illustrator | `mcp__vectorcraft__*` | `command_run` | oui |
| LightCraft | Lightroom | `mcp__lightcraft__*` | `run_command` | non |
| FilmCraft | Premiere Pro | `mcp__filmcraft__*` | `command_run` | non |
| EffectCraft | After Effects | `mcp__effectcraft__*` | `execute_command` | oui |
| DesignCraft | InDesign | `mcp__designcraft__*` | `execute` | non |
| PdfCraft | Acrobat | `mcp__pdfcraft__*` | l'outil du nom de la commande, ou `tool_call` | oui |
| SoundCraft | Pro Tools | `mcp__soundcraft__*` | `execute` | non |
| WordCraft | Word | `mcp__wordcraft__*` | `execute` | non |
| GridCraft | Excel | `mcp__gridcraft__*` | `execute_command` | non |
| DeckCraft | PowerPoint | `mcp__deckcraft__*` | `run_command` | non |
| CADCraft | AutoCAD | `mcp__cadcraft__*` | `execute` | non |

« Tenue au dossier du projet » : l'application refuse de lire ou d'écrire hors du dossier où l'agent travaille. Celles marquées « non » ne savent pas encore le faire dans leur version actuelle : leurs outils lisent et écrivent là où tu le peux toi-même. L'agent reste tenu par ses propres autorisations.

## Ce que tu peux demander

- **VectorCraft** : « dessine un logo en SVG », « convertis ce fichier AI en SVG », « exporte l'icône en PNG à 512 pixels ».
- **LightCraft** : « développe ces RAW avec plus de lumière et exporte en JPEG 1600 pixels ».
- **FilmCraft** : « monte ces trois clips bout à bout avec un fondu et exporte en H.264 ».
- **EffectCraft** : « anime le logo qui apparaît en fondu et rends cinq secondes ».
- **DesignCraft** : « mets ce texte en page sur une affiche A4 et exporte le PDF ».
- **PdfCraft** : « assemble ces deux PDF », « extrais le texte de la page 3 », « tourne les pages paysage ».
- **SoundCraft** : « importe ces deux pistes, baisse la musique sous la voix, exporte le mixage ».
- **WordCraft** : « rédige le compte rendu dans un fichier Word avec des titres ».
- **GridCraft** : « ouvre ce CSV, ajoute une colonne de total et un graphique ».
- **DeckCraft** : « fais une présentation de cinq diapositives sur ce projet ».
- **CADCraft** : « dessine le plan de cette pièce, 4 m sur 3 m, et exporte en DXF ».

## Pour l'agent : comment s'en servir

1. **Lis la carte des commandes avant la première action** : `guide page="<application>/commandes"` (par exemple `vectorcraft/commandes`). Elle est tirée du programme installé sur cette machine : toutes ses commandes, par famille. Les paramètres d'une famille sont dans `<application>/commandes-<famille>`, ce que le logiciel ne sait pas encore faire dans `<application>/limites`. Ne devine jamais un identifiant de commande.
2. **Regarde la liste des outils de l'application.** Chacune a quelques outils directs (ouvrir, enregistrer, exporter, inspecter le document, rendre une image) et un outil qui lance n'importe quelle commande par son identifiant : son nom est dans le tableau ci-dessus. LightCraft et PdfCraft ne listent qu'un jeu réduit d'outils ; tout le reste passe par `run_command` (LightCraft) ou `tool_search` puis `tool_call` (PdfCraft).
3. **Travaille dans le dossier du projet**, avec des chemins complets pour les applications qui ne sont pas tenues à ce dossier, et n'écris jamais par-dessus un original sans qu'on te l'ait demandé.
4. **Regarde le résultat** avant de dire que c'est fait : chaque application a un outil de rendu ou de capture (`render_preview`, `render_page`, `render_slide`, `render`, `screenshot`).
5. **Dis ce qui échoue.** Ces logiciels sont en alpha : quand une commande manque ou échoue, dis-le et passe par un autre moyen.

### Sans fenêtre ou en direct

Chaque application (sauf PdfCraft) donne deux jeux d'outils :

| Outils | Ce qu'ils font |
|---|---|
| `mcp__<application>__*` | Toujours disponibles. Travaillent sur les fichiers, sans fenêtre, dans une session propre à ta discussion. |
| `mcp__<application>_live__*` | Les mêmes commandes, envoyées à l'application affichée dans Orbit, que l'utilisateur regarde. Ne répondent que si sa page est ouverte. |

Quand l'utilisateur veut te voir travailler, ou te demande d'agir sur ce qu'il a à l'écran, ouvre la page (`run_command` avec `orbit.craft.show.<application>`, par exemple `orbit.craft.show.vectorcraft`) et sers-toi des outils `_live`. Cette commande prend aussi un fichier du projet en argument pour PhotoCraft, VectorCraft, GridCraft, DeckCraft et CADCraft. N'ouvre jamais une seconde fenêtre de l'application à côté.

Quand les outils `_live` répondent qu'ils ne peuvent pas se connecter, la page est fermée : ouvre-la, ou travaille sans fenêtre. Attention, ce sont deux sessions distinctes : un document ouvert sans fenêtre n'est pas celui de la fenêtre, et l'inverse.

## L'application dans Orbit

La ligne de l'application dans **Outils du projet** l'ouvre dans un onglet d'Orbit : sa vraie fenêtre, tenue sur l'onglet, à pleine vitesse. Elle suit Orbit quand tu le déplaces ou le redimensionnes, s'efface quand tu changes d'onglet, et laisse passer devant elle ce qu'Orbit affiche par-dessus (listes, menus, notifications). Fermer l'onglet ou quitter Orbit ne la ferme jamais : elle revient devant toi. Le détail est dans [Magasin](/docs/outils/magasin).

## Limites

- Vérifié le 11 octobre 2026 sous Windows, pour chaque application : téléchargement et empreinte, signature, outils sans fenêtre, outils en direct, affichage dans Orbit. Essayé par de vraies actions : ouvrir un SVG dans VectorCraft, ouvrir un CSV dans GridCraft et y écrire une cellule par les outils en direct, écrire du texte dans WordCraft par les outils en direct. Les autres n'ont pas été essayées au-delà de la liste de leurs outils.
- La vue dans Orbit n'existe que sous Windows. macOS et Linux : outils sans fenêtre, non essayés.
- PdfCraft n'a pas de vue dans Orbit ; Orbit affiche lui-même les PDF (voir [Lecteurs](/docs/outils/lecteurs)).
- Chaque application installée ajoute ses outils à tous les agents : n'installe que celles dont tu te sers.
- Toutes sont en alpha.

## Voir aussi

- [PhotoCraft](/docs/outils/photocraft)
- [Magasin de compétences](/docs/outils/magasin)
- [Lecteurs de documents](/docs/outils/lecteurs)
