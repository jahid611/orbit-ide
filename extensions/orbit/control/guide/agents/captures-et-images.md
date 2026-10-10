---
title: Coller une capture
description: Colle une capture d'écran ou des images dans le terminal de l'agent avec Ctrl+V.
order: 17
icon: image
---

Un terminal ne sait coller que du texte. Dans un terminal d'agent d'Orbit, `Ctrl+V` colle aussi une capture d'écran ou des images copiées : l'agent les reçoit comme des images jointes.

## À quoi ça sert

Montrer un bug visuel, une maquette ou un message d'erreur à l'agent sans enregistrer de fichier à la main.

## Comment l'utiliser

1. Fais une capture d'écran (par exemple `Win+Maj+S` sous Windows) ou copie des fichiers image dans l'explorateur de ton système.
2. Dans un terminal d'agent d'Orbit, appuie sur `Ctrl+V` (ou `Ctrl+Maj+V`).
3. Une confirmation brève apparaît dans la barre d'état (« Capture collée » ou « N images collées »). Claude Code joint l'image à ton message sous la forme `[Image #1]`.
4. Écris ta question et envoie.

Si le presse-papiers contient du texte, c'est le texte qui est collé, comme d'habitude. Dans un terminal qui n'est pas un terminal d'agent, `Ctrl+V` se comporte normalement.

## Dans la vue discussion

Colle ou dépose une image dans la zone de saisie : elle apparaît en vignette et tu peux la retirer avant l'envoi. Voir [Vue discussion](/docs/agents/vue-discussion).

## Où vont les images

Orbit enregistre l'image dans `~/.orbit/pastes`, puis colle son chemin dans le terminal comme un glisser-déposer. Les captures sont gardées 7 jours, assez pour que l'agent y revienne, puis supprimées.

Sous Windows, Orbit lit le presse-papiers avec PowerShell, et accepte aussi des fichiers image copiés (png, jpg, gif, webp, bmp). Sous macOS il passe par `osascript`, sous Linux par `wl-paste` ou `xclip` (l'un des deux doit être installé).

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Coller (texte ou image) | `Ctrl+V`, `Ctrl+Maj+V` | aucun raccourci Orbit |

La commande « Coller (texte, capture d'écran ou images) dans le terminal Claude » (`orbit.claude.paste`) existe aussi dans la palette de commandes.

## Limites

- Le raccourci n'est déclaré que pour Windows et Linux.
- Si le presse-papiers contient à la fois du texte et une image, le texte gagne.
- L'envoi d'images à l'agent ChatGPT n'est pas décrit dans les sources d'Orbit.

## Voir aussi

- [Terminaux d'agents](/docs/agents/terminaux)
- [Vue discussion](/docs/agents/vue-discussion)
- [Relecture visuelle](/docs/boucle/relecture-visuelle)
