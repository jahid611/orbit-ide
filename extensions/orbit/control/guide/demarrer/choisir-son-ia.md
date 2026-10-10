---
title: Claude ou ChatGPT
description: Orbit travaille avec Claude Code ou avec ChatGPT (Codex), une seule IA à la fois ; on change en un clic.
order: 3
icon: users
---

Orbit est construit autour d'un agent de code en ligne de commande. Tu choisis lequel : Claude (Claude Code) ou ChatGPT (Codex). Une seule IA est active à la fois, jamais les deux mélangées, et tout Orbit suit ce choix : terminaux, logo, modèles, jauge d'utilisation et textes.

## À quoi ça sert

Tu travailles avec l'abonnement que tu as déjà. Orbit lance le vrai programme de l'agent (`claude` ou `codex`) dans ses terminaux et ne facture rien lui-même.

## Comment l'utiliser

1. Au premier lancement, la liste « Avec quelle IA veux-tu travailler dans Orbit ? » te propose les deux. Choisis-en une.
2. Pour changer plus tard, clique sur le bouton de la barre d'état (les deux logos avec une double flèche) ou sur son équivalent dans la barre du terminal. Il passe directement à l'autre IA.
3. Pour revoir la liste, lance la commande « Choisir l'IA avec laquelle travailler » (`orbit.assistant.choose`).

## Ce qui change selon l'IA

| | Claude | ChatGPT |
|---|---|---|
| Programme lancé | `claude` (réglage `orbit.claude.path`) | `codex` (réglage `orbit.chatgpt.path`) |
| Installation | `npm install -g @anthropic-ai/claude-code`, puis `claude` | `npm install -g @openai/codex`, puis `codex login` |
| Modèles proposés | Opus, Sonnet, Haiku, Fable 5.1 | GPT-6 Astra, GPT Reserve (rapide), GPT-5.6 Sol |
| Mode « plan » | Plan | Lecture seule |
| Abonnement | Claude | ChatGPT |

Les modèles et les arguments sont réglés par IA : `orbit.claude.model` et `orbit.claude.extraArgs` d'un côté, `orbit.chatgpt.model` et `orbit.chatgpt.extraArgs` de l'autre. Le Studio affiche ceux de l'IA en cours.

## Ce qui se passe quand on change

- Les terminaux de l'autre IA sont fermés, la fenêtre se recharge et un agent neuf démarre avec la nouvelle IA.
- Si des agents travaillent encore, une confirmation te prévient que le changement les interrompt ; tu peux annuler.

## Raccourcis

Le changement d'IA n'a pas de raccourci clavier ; il passe par le bouton de la barre d'état ou la palette de commandes (« Changer d'IA en un clic », `orbit.assistant.toggle`).

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.assistant` | `claude` | L'IA avec laquelle Orbit travaille : `claude` ou `chatgpt`. |
| `orbit.chatgpt.path` | `codex` | Programme Codex lancé avec ChatGPT. |
| `orbit.chatgpt.model` | vide | Modèle des nouveaux terminaux ; vide, celui de Codex. |
| `orbit.chatgpt.extraArgs` | vide | Arguments ajoutés à la ligne de commande de Codex. |

## Avec ChatGPT

Orbit suit Codex en lisant ses journaux de session pour afficher l'état des agents (en cours, en attente, terminé), les discussions et la jauge. La jauge est lue dans les enregistrements de limites que Codex écrit lui-même : aucun service n'est appelé.

## Limites

- Les demandes d'accord de Codex ne sont pas encore reconnues avec certitude dans le suivi d'état.
- Le bouton « tout en mode auto » n'est pas adapté à ChatGPT, et le solde Higgsfield en direct non plus (il se demande dans le terminal).
- Les pages de StarCapture et de NovaGame parlent encore de Claude dans leurs textes.
- Non testés avec ChatGPT : chef d'équipe, édition en ligne, commit intelligent, chef d'orchestre, connexion Higgsfield. Les discussions ChatGPT sont vérifiées sur de vrais journaux, mais pas vues à l'écran avec un Codex en marche.
- Les appels sans terminal (édition en ligne, commit intelligent, requêtes de base de données) coûtent environ 15 000 jetons de contexte de base avec ChatGPT.

## Voir aussi

- [Abonnement et facturation](/docs/demarrer/abonnement)
- [Premier lancement](/docs/demarrer/premier-lancement)
- [Terminaux d'agents](/docs/agents/terminaux)
