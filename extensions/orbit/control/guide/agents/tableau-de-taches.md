---
title: Tableau de tâches
description: Un kanban du projet où tes agents prennent des cartes, les traitent et te rendent un compte rendu.
order: 12
icon: kanban
---

Le tableau de tâches est un kanban du projet, enregistré dans `.orbit/taches.json`. Tu déposes des cartes dans « À faire », un agent neuf prend chacune, la traite, et la carte revient dans « À vérifier » avec son compte rendu.

## À quoi ça sert

Pour déléguer sans perdre le fil. Chaque carte est le seul contexte de l'agent qui la traite, ce qui évite qu'une longue conversation mélange plusieurs sujets. Toi seul décides qu'une carte est « Fait ».

## Comment l'utiliser

1. Ouvre le tableau : `Ctrl+Alt+K` (menu « Outils du projet »), puis « Tableau de tâches ». La commande « Tableau de tâches : des cartes que les agents prennent et traitent » l'ouvre aussi.
2. Ajoute une carte avec un titre et un détail. La commande « Ajouter une tâche au tableau » en crée une depuis la palette.
3. Lance une carte avec « Lancer », ou glisse-la sur « En cours ». Un agent neuf démarre, avec la carte pour tout contexte.
4. À la fin de son tour, la carte passe dans « À vérifier » avec le compte rendu de l'agent, et une notification te propose d'ouvrir le tableau.
5. Relis, puis glisse la carte dans « Fait ».

Les colonnes sont : À faire, En cours, À vérifier, Fait. Tu réordonnes et déplaces les cartes par glisser-déposer. Une carte « En cours » dont l'agent est encore ouvert permet de retourner à son terminal.

### Tout lancer

« Tout lancer » enchaîne les cartes de « À faire », avec plusieurs agents à la fois. Le nombre se règle avec `orbit.board.parallel` (entre 1 et 6, 2 par défaut). Le bouton devient « Arrêter d'enchaîner » pendant que ça tourne.

## Les agents utilisent le tableau eux-mêmes

Chaque agent lancé par Orbit dispose de quatre outils du serveur MCP `orbit` : `board_list`, `board_add`, `board_take` et `board_move`. Tu peux donc dire à un agent « traite le tableau » : il prend une carte, fait cette tâche et elle seule, puis la passe en « review » avec un résumé. Il peut aussi ajouter des cartes quand il découvre un travail à faire plus tard (voir [L'agent pilote l'IDE](/docs/agents/agent-pilote-orbit)).

> **À savoir** Un agent ne peut jamais déplacer une carte vers « Fait » : l'outil la place dans « À vérifier » à la place.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.board.parallel` | `2` | Nombre d'agents qui travaillent en même temps avec « Tout lancer ». |

## Limites

- Retirer d'un coup les cartes de la colonne « Fait » demande une confirmation.
- Si le terminal d'une carte est fermé, le bouton d'accès au terminal l'indique au lieu de l'ouvrir.
- Contrairement à la [File de nuit](/docs/agents/file-de-nuit), le tableau n'a pas de rapport écrit ni de durée maximale : tu suis les cartes dans la page.

## Voir aussi

- [File de nuit](/docs/agents/file-de-nuit)
- [Chef d'équipe](/docs/agents/chef-d-equipe)
- [Chef d'orchestre](/docs/agents/chef-d-orchestre)
