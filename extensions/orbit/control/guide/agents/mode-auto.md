---
title: Mode auto en un clic
description: Passe tous les agents ouverts en mode auto d'un seul bouton.
order: 13
icon: zap
---

Le bouton éclair passe tous les agents de la fenêtre dans le mode « auto » : ils n'attendent plus ton accord pour chaque action. Tu n'as pas à ouvrir chaque terminal pour changer son mode.

## À quoi ça sert

Quand tu lances une grille de plusieurs agents et que tu veux qu'ils avancent seuls, changer le mode terminal par terminal est long. Le bouton le fait pour tous en une fois.

## Comment l'utiliser

1. Clique sur le bouton éclair : il est dans la barre du terminal, dans celle de la vue discussion et dans la vue Équipe. La commande est « Passer tous les Claude en mode auto ».
2. Orbit affiche un message de bilan : combien de terminaux ont changé de mode, combien l'étaient déjà, lesquels n'ont pas été touchés et pourquoi.

> **Attention** En mode auto, l'agent modifie des fichiers et lance des commandes sans te demander. Garde la [Machine à remonter le temps](/docs/boucle/machine-a-remonter-le-temps) activée pour pouvoir revenir en arrière.

## Comment ça marche avec Claude

Claude Code ne change de mode qu'avec `Maj+Tab`, qui parcourt les modes dans cet ordre : par défaut, accepter les modifications, plan, auto. Orbit connaît le mode de chaque terminal (rapporté par les crochets de l'agent, sinon le mode de lancement) et envoie à chacun le nombre exact de `Maj+Tab` nécessaire pour arriver sur « auto ».

Sont laissés tels quels :

- un terminal qui **attend ton accord** : réponds-lui d'abord ;
- un terminal dont le **mode est inconnu** : envoie-lui un premier message, puis recommence.

## Avec ChatGPT

Dans Codex, `Maj+Tab` fait passer en mode plan. Orbit ne l'utilise donc pas : il ferme chaque terminal inactif et le relance avec `--approve-for-me`, sur la même discussion (`codex resume`). Un terminal qui travaille ou qui attend ton accord n'est pas touché ; un terminal déjà lancé dans ce mode est compté « déjà en mode auto ».

## Réglages

Le mode d'un nouvel agent se choisit avec `orbit.claude.permissionMode` (vide, `acceptEdits`, `plan` ou `auto`). Le bouton éclair ne change pas ce réglage : il agit sur les terminaux déjà ouverts.

## Limites

- Les terminaux ouverts après le clic gardent le mode de leur réglage de lancement.
- Le bouton n'a pas de raccourci clavier.

## Voir aussi

- [Terminaux d'agents](/docs/agents/terminaux)
- [Grille et splits](/docs/agents/grille-et-splits)
- [File de nuit](/docs/agents/file-de-nuit)
