---
title: Statut et notifications
description: L'onglet de chaque agent indique s'il travaille, attend ton accord ou a terminé, et Orbit te prévient quand tu regardes ailleurs.
order: 4
icon: bell
---

Orbit sait ce que fait chaque agent. Son onglet change d'état en direct, et quand un agent a besoin de toi ou a fini, tu es prévenu sans avoir à surveiller le terminal.

## À quoi ça sert

- Lancer plusieurs agents et ne revenir vers eux que quand c'est utile.
- Voir d'un coup d'œil lequel travaille, lequel attend et lequel a terminé.

## Les quatre états

| État | Signification |
|---|---|
| Travaille | l'agent exécute un tour ; l'outil en cours est indiqué au survol |
| Attend ton autorisation | l'agent demande l'accord pour une action |
| A terminé | le tour est fini |
| Prêt | l'agent est lancé et n'a encore rien reçu |

L'état apparaît sur l'onglet du terminal et au survol (l'outil en cours, ou le message de la demande d'autorisation). Les mêmes états se retrouvent dans la liste des [discussions](/docs/agents/discussions), la vue Équipe (voir [Chef d'équipe](/docs/agents/chef-d-equipe)) et la [vue Orbite](/docs/agents/vue-orbite).

## Les notifications

Quand un agent passe à « attend ton autorisation » ou « a terminé », Orbit te prévient, sauf si tu regardes déjà son terminal dans une fenêtre active :

- Une notification dans l'éditeur annonce « <agent> attend ton autorisation » ou « <agent> a terminé », avec un bouton **Voir** qui amène au terminal.
- Si la fenêtre d'Orbit n'est pas au premier plan, une notification du système s'y ajoute : un toast sous Windows, une notification avec son sous macOS.

Les notifications de l'éditeur restent dix secondes puis sont rangées dans le centre de notifications.

> **Astuce** Pour être prévenu loin de ton ordinateur, relie ton téléphone : voir [Orbit sur ton téléphone](/docs/agents/telephone).

## Comment ça marche

Pour Claude Code, Orbit lance chaque agent avec un fichier de configuration (`~/.orbit/claude-settings.json`) qui déclare des crochets. À chaque événement (début de session, message envoyé, outil utilisé, demande d'autorisation, fin de tour, fin de session), un petit script (`~/.orbit/hook.sh`) écrit une ligne dans `~/.orbit/agent-events/`. Orbit lit ce dossier et met l'onglet à jour. Rien n'est à installer ni à valider de ton côté.

## Avec ChatGPT

Codex a des crochets, mais ils demandent une validation manuelle (`/hooks`) et ne se déclenchent pas sans elle. Orbit n'en dépend donc pas : il lit les journaux de session de Codex (`~/.codex/sessions/`) à mesure qu'ils grandissent et en tire les mêmes états. Rien n'est installé dans Codex et rien n'est à approuver.

Les demandes d'autorisation ne sont pas encore reconnues avec certitude avec ChatGPT : l'état « attend ton autorisation » peut donc manquer.

## Limites

- Les notifications du système n'existent que sous Windows et macOS. Sous Linux, seule la notification de l'éditeur s'affiche.
- Sous Windows, le toast apparaît sous l'identité de PowerShell tant qu'Orbit n'est pas installé avec son raccourci.
- Un agent lancé dans une autre fenêtre d'Orbit est signalé par cette fenêtre, pas par la tienne.

## Voir aussi

- [Terminaux d'agents](/docs/agents/terminaux)
- [Vue Orbite](/docs/agents/vue-orbite)
- [Orbit sur ton téléphone](/docs/agents/telephone)
