---
title: Édition en ligne
description: Sélectionne du code, décris le changement et accepte ou rejette le résultat directement dans l'éditeur.
order: 6
icon: wand-sparkles
---

L'édition en ligne réécrit une sélection (ou génère du code au curseur) à partir d'une phrase, sans quitter le fichier. Le résultat remplace le texte tout de suite ; tu l'acceptes, le rejettes, le compares ou le retouches.

## À quoi ça sert

Pour les petites modifications ciblées : renommer, simplifier une fonction, ajouter un cas, écrire un bloc à l'endroit du curseur. Pas besoin de passer par un terminal d'agent ni d'ouvrir une session.

## Comment l'utiliser

1. Dans un fichier, sélectionne le code à changer. Sans sélection, le résultat est inséré à la position du curseur.
2. Appuie sur `Ctrl+K` (ou clic droit, puis **Edit with Claude (Inline)**). Une zone de saisie s'ouvre : « Que faut-il changer dans la sélection ? » ou, sans sélection, « Décris le code à générer ici… ».
3. Écris ta demande et valide. Pendant que l'IA écrit, les lignes concernées portent la mention « Claude écrit… ».
4. Le nouveau code remplace la sélection, surligné comme une ligne ajoutée, avec quatre actions au-dessus :
   - **Accepter** (`Ctrl+Entrée`) garde le résultat ;
   - **Rejeter** (`Ctrl+Retour arrière`) remet le texte d'origine ;
   - **Diff** ouvre la comparaison avant / après ;
   - **Retoucher** te demande ce qui ne va pas et relance avec ta consigne ajoutée à la première.

Si tu lances une nouvelle édition alors qu'une autre attend, la première est acceptée.

## Ce que l'IA reçoit

Le nom et le langage du fichier, la région sélectionnée, et jusqu'à 40 lignes avant et 40 lignes après pour le contexte. Elle répond par le seul code de la région, sans explication, et Orbit retire les clôtures Markdown éventuelles. La réponse reprend les fins de ligne du document. L'appel se fait sans outils : l'IA ne lit ni n'écrit aucun autre fichier.

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Modifier avec l'IA | `Ctrl+K` | `⌘K` |
| Accepter | `Ctrl+Entrée` | `⌘⏎` |
| Rejeter | `Ctrl+Retour arrière` | `⌘⌫` |

Accepter et Rejeter ne fonctionnent que pendant qu'une édition attend et que l'éditeur a le focus. Tant que l'éditeur a le focus, `Ctrl+K` prend le pas sur les accords VS Code qui commencent par cette touche, comme dans Cursor.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.inlineEdit.model` | `sonnet` | Modèle utilisé pour les éditions en ligne : `opus`, `sonnet`, `haiku` ou `claude-fable-5-1`. Un modèle plus rapide se sent plus vif. |

## Avec ChatGPT

L'appel passe par `codex exec` en lecture seule, sans terminal ni session conservée. Le réglage `orbit.inlineEdit.model` ne s'applique pas : c'est le modèle réglé pour ChatGPT (`orbit.chatgpt.model`) qui est utilisé, s'il y en a un. Chaque appel coûte environ 15 000 jetons de contexte de base. L'édition en ligne n'a pas été testée avec ChatGPT.

## Limites

- L'appel est facturé comme les terminaux, sur ton abonnement, sans clé d'API.
- Le résultat est appliqué directement dans le fichier : pense à l'enregistrer ou à le rejeter.
- Si Claude Code est introuvable, Orbit te dit de l'installer ou de régler `orbit.claude.path`.

## Voir aussi

- [Problèmes vers l'agent](/docs/boucle/problemes)
- [Commit intelligent](/docs/boucle/commit-intelligent)
- [Machine à remonter le temps](/docs/boucle/machine-a-remonter-le-temps)
