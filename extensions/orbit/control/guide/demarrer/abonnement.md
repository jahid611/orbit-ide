---
title: Abonnement et facturation
description: Orbit utilise ton abonnement Claude ou ChatGPT, retire les clés d'API de l'environnement des terminaux et affiche ta consommation en direct.
order: 4
icon: key-round
---

Orbit ne te facture rien et n'a pas de clé d'API à lui. Les agents tournent avec la connexion que ton outil (Claude Code ou Codex) garde sur ta machine, donc avec ton abonnement. Pour éviter une facturation à l'usage par accident, Orbit retire les clés d'API de l'environnement des terminaux d'agents.

## À quoi ça sert

Une variable `ANTHROPIC_API_KEY` oubliée dans ton shell peut faire passer Claude Code en paiement à l'usage sans que tu le saches. Orbit supprime ces variables de l'environnement de chaque terminal d'agent qu'il lance.

## Ce qu'Orbit retire

Tant que `orbit.claude.billing` vaut `subscription` (sa valeur par défaut), les terminaux d'agents démarrent sans :

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `OPENAI_API_KEY`

Le retrait vaut aussi pour ChatGPT, même si le réglage porte le nom de Claude. Orbit retire de plus `NO_COLOR` et les variables `CLAUDE_CODE_*` héritées du shell qui l'a lancé, qui rendaient l'agent monochrome ou rattaché à une autre session.

> **Attention** Si tu veux vraiment utiliser une clé d'API, passe `orbit.claude.billing` sur `apiKey` : Orbit laisse alors `ANTHROPIC_API_KEY` de l'environnement, et la facturation est celle de l'API, à l'usage. Le Studio expose ce réglage sous « Facturation ».

## La jauge d'utilisation

Un compteur en bas à droite de la fenêtre affiche la consommation de ton abonnement sous la forme « session · semaine », avec le logo de l'IA en cours. Il passe en avertissement à partir de 90 %. Un clic ouvre le détail, aussi accessible par la commande « Utilisation de Claude » (`orbit.usage.show`) et par le bouton de la barre d'outils du panneau.

La carte montre la session en cours (fenêtre de 5 heures), la semaine tous modèles confondus, les limites par modèle et la répartition de la semaine, avec les heures de remise à zéro. Les actions « Actualiser » et « Détail sur claude.ai » y sont proposées. La jauge se rafraîchit toutes les cinq minutes et après le travail d'un agent, sans interroger le service plus d'une fois par 45 secondes.

### Avec Claude

Orbit lit la connexion que Claude Code garde sur ta machine (un fichier dans `~/.claude` sous Windows et Linux, le trousseau sous macOS) et interroge le service d'utilisation d'Anthropic, comme la commande `/usage`. Il ne renouvelle jamais le jeton lui-même.

### Avec ChatGPT

Orbit lit le dernier enregistrement de limites que Codex écrit dans ses journaux de session. Aucun service n'est appelé.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.claude.billing` | `subscription` | `subscription` : abonnement, clés d'API ignorées. `apiKey` : utilise `ANTHROPIC_API_KEY` de l'environnement. |

## Limites

- Si la carte indique « Connexion expirée », ouvre un terminal d'agent pour que Claude Code renouvelle sa connexion, puis actualise. Si elle indique « Connecte-toi d'abord dans un terminal Claude (/login) », connecte-toi dans Claude Code.
- Avec la facturation par clé d'API, les limites d'abonnement ne s'appliquent pas : le compteur disparaît.
- Avec ChatGPT, la jauge n'apparaît qu'après un premier échange avec Codex (« Aucune utilisation connue » avant).
- Le compteur se masque aussi quand il n'a rien à montrer (déconnecté, par exemple).

## Voir aussi

- [Claude ou ChatGPT](/docs/demarrer/choisir-son-ia)
- [Utilisation et jetons](/docs/agents/utilisation)
- [Dépannage](/docs/demarrer/depannage)
