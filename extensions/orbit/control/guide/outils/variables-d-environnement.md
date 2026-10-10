---
title: Variables d'environnement
description: Gère les fichiers .env du projet sans que les agents en lisent les valeurs, et synchronise-les avec Vercel.
order: 6
icon: key-round
---

Cette page rassemble les fichiers `.env*` du projet et en masque les valeurs. Tu ajoutes, modifies et supprimes des variables ici, sans toucher aux commentaires ni à l'ordre du fichier. Les agents, eux, ne connaissent que les **noms** des variables : leurs valeurs restent entre toi et la page.

## À quoi ça sert

Un agent qui lit un `.env` met tes clés dans une conversation. Ici, la page est le seul endroit où les valeurs se manipulent, et Orbit demande à l'agent de ne pas les lire. Elle sert aussi de lien avec Vercel : comparer les variables du projet avec celles de Vercel, les envoyer ou les récupérer.

## Comment l'utiliser

1. Ouvre la page par la commande `orbit.env.show`, ou par la liste « Outils du projet » (`Ctrl+Alt+K`).
2. Elle liste les fichiers `.env*` de la racine du projet. Chaque valeur est masquée : la page ne reçoit que sa longueur. « Afficher » révèle une valeur à la fois, « copier » la met dans le presse-papiers.
3. Ajoute, modifie ou supprime une variable (la suppression demande confirmation). Les noms ne contiennent que des lettres, des chiffres et `_`, sans commencer par un chiffre. « Nouveau fichier » propose `.env.local`, `.env`, `.env.production`, `.env.development` ou `.env.example`.
4. Le `.gitignore` est complété tout seul (`.env`, `.env.*` et l'exception `!.env.example`) pour que les valeurs n'arrivent jamais dans git. La page signale quand il manque.
5. « Mettre à jour `.env.example` » y ajoute les noms qui lui manquent, sans valeur. Ce fichier peut être commité et montré à un agent.
6. « Envoyer les noms à l'agent » lui donne la liste des variables de chaque fichier (noms seulement) en lui demandant, s'il en manque une, de te dire laquelle et pourquoi.

## Cachées aux agents

Le réglage `orbit.env.hideFromAgent` (activé par défaut) s'applique aux agents lancés ensuite. Avec Claude Code, Orbit :

- ajoute au fichier de réglages qu'il passe à chaque Claude (`~/.orbit/claude-settings.json`) des interdictions de lecture (`Read`) et de modification (`Edit`) pour `.env`, `.env.local`, `.env.*.local`, `.env.production`, `.env.development`, `.env.staging`, `.env.test` et `.env.preview`. `.env.example` reste lisible ;
- ajoute à la consigne système l'interdiction de lire, afficher ou copier les valeurs de ces fichiers ;
- donne à l'agent deux outils : `env_names` (les noms par fichier, jamais les valeurs) et `env_ask`. Quand l'agent a besoin d'une variable qu'il ne voit pas, il appelle `env_ask` avec le nom et la raison : la page s'ouvre avec sa demande en haut, et tu remplis la valeur toi-même.

Un interrupteur de la page active ou désactive la protection.

### Les limites de cette protection

- Ce sont des **règles de permission et une consigne**, pas un coffre. Un agent peut encore lire un fichier par une commande du shell (par exemple `cat`), car les interdictions portent sur ses outils de lecture et d'édition de fichiers.
- Avec **ChatGPT (Codex)**, il n'y a que la consigne : aucune interdiction de lecture n'est posée.
- Une variable placée dans un fichier dont le nom n'est pas dans la liste ci-dessus n'est pas couverte par l'interdiction.
- Elle ne vaut que pour les agents lancés **après** le changement de réglage.
- Une valeur déjà écrite dans le code, dans l'historique git ou dans une conversation passée n'est pas protégée.

## Avec Vercel

Si le projet est relié à Vercel (`.vercel/project.json`), la page lit les variables du projet Vercel (leurs noms et leurs cibles, via `vercel api`) et les compare aux tiennes.

- **Envoyer** : pour les cibles `production`, `preview` ou `development` que tu choisis, Orbit lance `vercel env add <NOM> <cible> --force`. La valeur passe par l'entrée standard de la commande, jamais dans une ligne de commande.
- **Récupérer** : après confirmation, `vercel env pull .env.local --yes` écrit les variables de développement du projet Vercel dans `.env.local`. Le contenu actuel de ce fichier est remplacé.

Tout passe par ta propre connexion à l'outil `vercel` : Orbit ne détient aucun jeton. Voir [Vercel](/docs/outils/vercel).

## Quand d'autres pages écrivent des clés

Les pages [Supabase](/docs/outils/supabase) et [Stripe](/docs/outils/stripe) écrivent les clés que tu leur confies dans `.env.local` (et complètent le `.gitignore`). Elles donnent ensuite à l'agent les noms de ces variables, jamais leurs valeurs.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.env.hideFromAgent` | `true` | Interdit à l'agent de lire les fichiers `.env` du projet (sauf `.env.example`). Les valeurs se gèrent dans cette page ; l'agent n'en connaît que les noms. |

## Limites

- La page ne lit que les fichiers `.env*` situés à la racine du projet.
- La protection a les limites décrites plus haut ; ne confie pas à un fichier `.env` une valeur qu'aucun agent ne doit jamais pouvoir atteindre.

## Voir aussi

- [Vercel](/docs/outils/vercel)
- [Supabase](/docs/outils/supabase)
- [Stripe](/docs/outils/stripe)
- [L'agent pilote Orbit](/docs/agents/agent-pilote-orbit)
