---
title: Sur ton téléphone
description: Reçois une notification sur ton téléphone quand un agent attend ton accord ou quand un long travail est fini.
order: 16
icon: smartphone
---

Orbit peut te prévenir sur ton téléphone quand tu es loin de l'écran : un agent attend ton accord, un long travail est terminé, la file de nuit est finie. Il passe par ntfy, une application gratuite, sans compte.

![Page de liaison du téléphone](/captures/phone.png)

## À quoi ça sert

À laisser tourner des agents sans surveiller l'écran. Seules de courtes lignes d'état quittent ta machine (projet, agent, ce qu'il attend) : jamais ton code.

## Comment l'utiliser

1. Lance la commande « Orbit sur ton téléphone : relier et régler les notifications ». La page s'ouvre et crée un sujet privé, qui s'enregistre dans `orbit.phone.topic`.
2. **Installe l'application ntfy** sur ton téléphone (iOS ou Android).
3. **Scanne le code** avec l'appareil photo : le lien s'ouvre dans ntfy, appuie sur « S'abonner ».
4. Envoie la notification de test, puis confirme avec « Je l'ai reçue ».
5. Règle ce qui doit faire vibrer ta poche, avec trois cases.

## Ce qui notifie

| Événement | Condition | Réglage |
|---|---|---|
| Un agent attend ton accord | Toujours, une fois par tour | `orbit.phone.waiting` |
| Un agent a terminé | Seulement si le tour a duré plus de 90 secondes et qu'Orbit n'est pas au premier plan | `orbit.phone.done` |
| La file de nuit est finie | Avec le nombre de tâches réussies et en échec | `orbit.phone.queue` |

Orbit n'envoie qu'une notification par état et par tour, jamais un flux.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.phone.topic` | vide | Sujet ntfy privé. Vide : les notifications sont désactivées. Se règle sur la page. |
| `orbit.phone.waiting` | `true` | Prévenir quand un agent attend ton accord. |
| `orbit.phone.done` | `true` | Prévenir quand un long travail est terminé. |
| `orbit.phone.queue` | `true` | Prévenir à la fin de la file de nuit. |

## Changer de téléphone, ou couper

La page propose de renouveler le lien (un nouveau sujet : l'ancien ne reçoit plus rien, utile si le lien a fuité ou pour un autre téléphone) et de désactiver les notifications, ce qui vide `orbit.phone.topic`.

> **Attention** Le lien est privé mais sans mot de passe : qui le connaît peut lire tes notifications. Ne le partage pas.

## Limites

- Les notifications passent par le service ntfy.sh : il faut une connexion internet.
- Un ordinateur ne peut ni détecter les téléphones proches ni leur envoyer un lien : le code à scanner est le chemin direct.
- L'affichage de la page est vérifié ; la réception sur un vrai téléphone n'a pas été testée.

## Voir aussi

- [Statut et notifications](/docs/agents/statut-et-notifications)
- [File de nuit](/docs/agents/file-de-nuit)
