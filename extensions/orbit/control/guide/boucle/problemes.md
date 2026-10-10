---
title: Problèmes vers l'agent
description: Envoie une erreur de l'éditeur, tous les problèmes d'un fichier ou de tout le projet à l'agent en un clic.
order: 5
icon: bug
---

Les erreurs et avertissements que l'éditeur souligne (types, lint, compilation) peuvent partir vers ton agent sans copier-coller. Orbit y joint le fichier, la ligne et le code autour, et demande de corriger la cause plutôt que le symptôme.

## À quoi ça sert

Tu vois un souligné rouge ou une liste de problèmes qui s'allonge : un clic suffit pour confier le tout à l'agent, avec assez de contexte pour qu'il n'ait pas à te redemander où regarder.

## Comment l'utiliser

### Une erreur précise

Place le curseur sur un diagnostic (erreur ou avertissement), ouvre l'ampoule des actions rapides et choisis **Corriger avec Claude**. L'agent reçoit :

- le message, le fichier et la ligne, avec la source et le code du diagnostic quand ils existent ;
- le code autour, quatre lignes avant et après ;
- la consigne de corriger la cause et de chercher le même problème ailleurs dans le fichier.

### Tous les problèmes d'un fichier

Clic droit dans le fichier, puis **Faire corriger par Claude les problèmes de ce fichier**.

### Tous les problèmes du projet

Dans le panneau Problèmes, le bouton **Faire corriger par Claude tous les problèmes du projet** envoie ceux de tous les fichiers du projet.

## Ce qui est envoyé

- Seuls les erreurs et les avertissements sont retenus (pas les informations ni les suggestions), et seuls les fichiers du disque.
- Les erreurs passent en premier.
- La liste est limitée à 40 problèmes ; si elle est plus longue, le message dit combien d'autres existent « du même genre ».
- Chaque ligne a la forme `fichier:ligne — message (source code)`.

Le message part dans le terminal de l'agent courant. S'il n'y en a pas, un agent démarre avec ce message pour première consigne.

## Commandes

| Commande | Où |
|---|---|
| **Corriger avec Claude** | actions rapides d'un diagnostic |
| **Faire corriger par Claude les problèmes de ce fichier** | menu contextuel de l'éditeur |
| **Faire corriger par Claude tous les problèmes du projet** | titre du panneau Problèmes |

## Avec ChatGPT

Les mêmes commandes envoient le message à l'agent ChatGPT ; leurs intitulés sont reformulés avec le nom de l'IA choisie.

## Limites

- Sans problème dans le fichier ou le projet, Orbit l'indique et n'envoie rien.
- Pour les erreurs de la page affichée, voir la [vue vivante](/docs/boucle/vue-vivante) : elle a son propre compteur et son bouton.
- Pour les erreurs de compilation de Unity, la console du [studio](/docs/novagame/studio) a son propre bouton **Corriger avec Claude**.

## Voir aussi

- [Vérification automatique](/docs/boucle/verification)
- [Vue vivante](/docs/boucle/vue-vivante)
- [Édition en ligne](/docs/boucle/edition-en-ligne)
