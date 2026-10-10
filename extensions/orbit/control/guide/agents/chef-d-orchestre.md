---
title: Chef d'orchestre
description: Découpe une grosse tâche en sous-tâches indépendantes, lance un agent par sous-tâche, puis fusionne leur travail.
order: 10
icon: workflow
---

Donne une grosse tâche : Orbit demande à l'agent, en lecture seule, de la découper en 2 à 4 sous-tâches qui touchent des fichiers différents. Tu valides le plan, puis un agent par sous-tâche travaille dans sa propre branche git et son propre dossier. Quand ils ont fini, tu fusionnes leur travail dans ton projet.

![Chef d'orchestre](/captures/tuto-orchestre.png)

## À quoi ça sert

- Paralléliser une demande qui se découpe naturellement (une page, son API, ses tests).
- Éviter les collisions : chaque agent écrit dans un dossier isolé (voir [Worktrees](/docs/agents/worktrees)).

## Comment l'utiliser

1. Lance « Chef d'orchestre : découper une tâche entre plusieurs agents… » depuis la palette, le sélecteur d'agents (`Ctrl+Alt+A`), le bouton de la vue Discussions ou celui de la [vue Orbite](/docs/agents/vue-orbite).
2. Décris la tâche. Le découpage prend quelques instants (4 minutes au plus) et peut être annulé.
3. Orbit montre le plan : titre, branche et consigne de chaque sous-tâche. Décoche ce que tu ne veux pas lancer, puis valide.
4. Pour chaque sous-tâche, Orbit crée un worktree dans `.orbit/worktrees/` sur une branche `orbit/<nom>-<date>`, écrit la consigne dans `.orbit/task.md` et lance un agent qui commence par la lire. La vue Orbite s'ouvre.
5. Quand tous les agents ont terminé, une notification propose **Fusionner leur travail** ou **Voir la carte**.

### Fusionner

« Chef d'orchestre : fusionner le travail des agents… » liste les branches `orbit/…` encore ouvertes, même après un redémarrage d'Orbit. Pour chaque branche cochée, Orbit commite les fichiers de l'agent (en laissant de côté les caches : `node_modules`, `dist`, `build`, `.next`, `coverage`, `__pycache__`, `.venv` et autres), puis fait un `merge --no-ff` dans ton projet. Il propose ensuite de supprimer les dossiers de travail et les branches.

## Conditions et pièges

- Le projet doit être un dépôt git avec au moins un commit.
- Avant de fusionner, commite ou mets de côté tes propres modifications : Orbit refuse sinon, pour ne pas les mélanger.
- Git doit connaître ton identité (`git config --global user.name` et `user.email`) : les commits de fusion sont à ton nom, Orbit n'en invente jamais.
- Les agents sont lancés en mode « accepter les modifications » (ou ton mode de permission s'il est réglé) : ils écrivent librement dans leur dossier, mais te demandent avant toute commande.
- Si deux agents ont quand même touché le même fichier, la fusion de la seconde branche s'arrête et est annulée : elle reste à traiter à la main et son dossier est conservé.
- `.orbit/` est ajouté aux exclusions de git : consignes et worktrees ne finissent pas dans l'historique.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.claude.model` | vide | Modèle des agents. Le découpage utilise `sonnet` quand il est vide. |
| `orbit.claude.permissionMode` | vide | Mode de permission des agents (`acceptEdits` quand il est vide). |

## Avec ChatGPT

Le découpage passe par Codex en lecture seule. Cette voie n'a pas été essayée avec ChatGPT.

## Limites

- Entre 2 et 4 sous-tâches ; si la tâche ne se découpe pas, le plan n'en contient qu'une.
- Plusieurs agents consomment plusieurs fois ton abonnement : garde un œil sur la jauge (voir [Utilisation et jetons](/docs/agents/utilisation)).
- Ce chef d'orchestre suit un plan que tu valides. Pour un agent qui crée et pilote les autres lui-même, voir [Chef d'équipe](/docs/agents/chef-d-equipe).

## Voir aussi

- [Worktrees](/docs/agents/worktrees)
- [Chef d'équipe](/docs/agents/chef-d-equipe)
- [Vue Orbite](/docs/agents/vue-orbite)
