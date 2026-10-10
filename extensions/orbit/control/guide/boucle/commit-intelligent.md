---
title: Commit intelligent
description: Un bouton du Contrôle de source rédige le message de commit d'après tes changements et le style de ton historique.
order: 7
icon: git-commit-horizontal
---

Le commit intelligent lit tes changements et écrit le message de commit à ta place, dans la zone de saisie du Contrôle de source. Tu relis, tu corriges si besoin, puis tu valides toi-même : Orbit ne fait jamais le commit.

## À quoi ça sert

Un message juste demande de relire son propre diff. Ici l'IA le fait, en imitant la manière dont tu écris déjà tes messages.

## Comment l'utiliser

1. Ouvre le Contrôle de source. Clique le bouton au logo de l'IA dans le titre de la vue, ou utilise `Ctrl+Alt+M` quand le focus n'est pas dans un terminal. La commande s'appelle **Rédiger le message de commit**.
2. Orbit lit les changements, l'IA rédige, et le message apparaît dans la zone de saisie. Une notification le confirme : « Message de commit rédigé : relis-le avant de valider. »
3. Clique **Régénérer** dans la notification pour obtenir une autre proposition, nettement différente, sur les mêmes changements. Tu peux le répéter.
4. Valide le commit comme d'habitude.

## Ce que l'IA reçoit

- Si des fichiers sont indexés, uniquement ces changements : c'est exactement ce qui sera validé. Sinon, tout l'arbre de travail.
- Le résumé des fichiers modifiés, le diff, et la liste des fichiers nouveaux non suivis (200 au plus).
- Les 15 derniers sujets de commit, pour reprendre la langue, le préfixe (`feat:`, `fix:`, une portée) et la casse que tu utilises déjà.
- Un diff trop long est coupé à 60 000 caractères ; le résumé, lui, reste complet.

Dans un dépôt sans aucun commit, la consigne est d'écrire un message court et simple, dans la langue du réglage `orbit.claude.language` s'il est rempli. L'appel se fait sans outils, comme l'[édition en ligne](/docs/boucle/edition-en-ligne), sur ton abonnement.

## Aucune mention de l'IA

Orbit retire de la réponse toute ligne qui signale une IA : `Co-Authored-By`, « Generated with… », l'adresse `noreply@anthropic.com`, l'émoji robot, ou une formule du genre « écrit par Claude ». Les guillemets et clôtures Markdown autour du message sont aussi enlevés.

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Rédiger le message de commit | `Ctrl+Alt+M` | `⌥⌘M` |

Le raccourci est désactivé quand un terminal a le focus.

## Avec ChatGPT

L'appel passe par `codex exec` en lecture seule, ce qui coûte environ 15 000 jetons de contexte de base par appel. Le commit intelligent n'a pas été testé avec ChatGPT.

## Limites

- Il faut git installé et un dépôt dans le dossier ouvert. Sans dépôt ou sans changement, Orbit le dit et n'écrit rien.
- Une seule génération à la fois par dépôt : un second clic pendant la rédaction est ignoré.
- Le message reste une proposition : relis-le, l'IA ne décrit que ce que le diff montre.

## Voir aussi

- [Machine à remonter le temps](/docs/boucle/machine-a-remonter-le-temps)
- [Vercel](/docs/outils/vercel)
- [Édition en ligne](/docs/boucle/edition-en-ligne)
