---
title: File de nuit
description: Empile des tâches le soir, laisse l'agent les traiter une par une, retrouve un rapport au réveil.
order: 11
icon: moon
---

La file de nuit enchaîne des tâches sans toi. Chaque tâche est confiée à un agent neuf, l'une après l'autre, et Orbit écrit un rapport : ce que l'agent dit avoir fait, les fichiers qui ont bougé, la durée.

## À quoi ça sert

Tu as plusieurs chantiers indépendants (écrire des tests, migrer un composant, mettre un README à jour) et tu veux les lancer avant de partir. Comme chaque tâche démarre dans un agent neuf, le contexte d'une tâche ne pèse jamais sur la suivante.

## Comment l'utiliser

1. Ouvre la page avec `Ctrl+Alt+Q`, avec le bouton de la barre du terminal, ou avec la commande « File de nuit : enchaîner des tâches et lire le rapport ».
2. Écris une tâche dans la zone de texte. Si tu en colles plusieurs, sépare-les par une ligne vide : une tâche par paragraphe.
3. Choisis le mode des agents : « Mode de mes réglages », « Accepter les modifications » ou « Automatique ». Coche « Arrêter la file au premier échec » si une tâche en échec doit tout stopper.
4. Lance la file. Orbit affiche d'abord une confirmation : nombre de tâches, projet, mode, durée maximale par tâche. Rien ne démarre sans ton accord.
5. Au retour, ouvre le bouton « Rapport » : la page montre chaque tâche, et le rapport est aussi écrit dans `.orbit/rapport-de-nuit.md`.

Les tâches sont enregistrées dans `.orbit/file-de-nuit.json`, dans le projet : la file suit le projet. Tant qu'elle n'a pas démarré, tu peux monter ou descendre une tâche, la retirer. Une tâche en échec peut être remise dans la file.

> **Attention** En mode « Automatique », l'agent modifie des fichiers et lance des commandes sans te demander. Le retour arrière reste possible par la frise du projet (voir [Machine à remonter le temps](/docs/boucle/machine-a-remonter-le-temps)).

## Garde-fous

- **3 minutes sans signe de vie** : la tâche échoue avec une explication. L'agent attend sans doute une réponse dans son terminal (confiance accordée au dossier, connexion au compte). Le terminal reste ouvert.
- **15 minutes bloquée sur un accord** : la tâche est laissée ouverte dans son terminal et la file passe à la suivante.
- **Durée maximale** : une tâche est interrompue (Échap envoyé à l'agent) quand elle dépasse `orbit.queue.taskMinutes`.
- La fin d'une tâche est aussi vérifiée toutes les 5 secondes, sans dépendre des événements de l'agent.

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| File de nuit | `Ctrl+Alt+Q` | `⌥⌘Q` |

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.queue.taskMinutes` | `90` | Durée maximale d'une tâche, en minutes, avant de passer à la suivante. |
| `orbit.phone.queue` | `true` | Envoie une notification sur ton téléphone à la fin de la file (voir [Sur ton téléphone](/docs/agents/telephone)). |

## Avec ChatGPT

La file fonctionne avec l'agent choisi, les tâches sont lancées dans un ChatGPT neuf. La fin d'une tâche est détectée en lisant directement le journal de session de Codex.

## Limites

- Une file interrompue par la fermeture d'Orbit ne reprend pas seule : la tâche en cours est marquée « Interrompue ».
- La liste des fichiers changés vient de git et des écritures vues pendant la tâche. Hors d'un projet git, seules les écritures vues sont listées.
- Les fichiers de `.orbit/` ne sont pas comptés dans le rapport.

## Voir aussi

- [Tableau de tâches](/docs/agents/tableau-de-taches)
- [Mode auto en un clic](/docs/agents/mode-auto)
- [Sur ton téléphone](/docs/agents/telephone)
- [Statut et notifications](/docs/agents/statut-et-notifications)
