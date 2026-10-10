---
title: Partir d'un dépôt GitHub ou GitLab
description: Choisis un de tes dépôts, Orbit le récupère et lance l'agent dedans.
order: 5.5
icon: git-fork
---

Tu peux commencer un projet à partir d'un dépôt qui existe déjà : un des tiens sur GitHub ou sur GitLab, celui de quelqu'un d'autre, ou n'importe quelle adresse git. Orbit le clone dans ton dossier de projets, l'ouvre et y lance l'agent.

## Comment l'utiliser

1. Ouvre la liste « Changer de projet » (le nom du projet en bas de la fenêtre) et choisis **Partir d'un dépôt GitHub ou GitLab…**. La commande s'appelle aussi « Nouveau projet depuis un dépôt GitHub ou GitLab » dans la palette.
2. Choisis d'où vient le projet. Orbit regarde d'abord à quoi tu es déjà connecté :
   - **GitHub** ou **GitLab**, avec le nom de ton compte, si tu es connecté ;
   - **Se connecter à…** si l'outil est là mais pas ta connexion ;
   - **outil à installer** si l'outil du service manque sur ta machine ;
   - **Coller l'adresse d'un dépôt…** pour tout le reste.
3. Choisis le dépôt. La liste montre tes 100 dépôts les plus récemment modifiés, privés compris, avec ceux de tes organisations. Tape pour filtrer.
4. Orbit récupère le dépôt dans ton dossier de projets (`~/Orbit` par défaut), puis l'ouvre. Si la fenêtre montre déjà un projet, il te demande s'il faut l'ouvrir en plus ou à la place.

> **Astuce** Le dépôt que tu veux n'est pas dans la liste ? Tape `propriétaire/nom`, ou colle son adresse complète dans le champ de recherche : une ligne « Cloner … » apparaît en tête.

## Se connecter

La connexion se fait dans ton navigateur, sans terminal. Orbit affiche un code, le copie dans ton presse-papiers et ouvre la page du service : tu colles le code, tu valides, et tes dépôts s'affichent dans Orbit.

Pour GitLab, Orbit te demande d'abord l'adresse de ton GitLab. Laisse `gitlab.com`, ou mets celle du serveur de ton entreprise.

## D'où viennent les accès

Orbit ne garde aucun jeton. La liste des dépôts et le clonage passent par l'outil officiel de chaque service : `gh` pour GitHub, `glab` pour GitLab. C'est dans cet outil que tu es connecté, et c'est lui qui parle au service.

Si l'outil manque, Orbit propose de l'installer : avec `winget` sous Windows, avec Homebrew sous macOS. Sous Linux, il t'envoie vers la page d'installation.

Une adresse collée est clonée par `git` lui-même, avec les accès que git a déjà sur ta machine.

## Si le dossier existe déjà

Quand un dossier du même nom est déjà dans ton dossier de projets, Orbit te laisse choisir : **Ouvrir celui qui existe**, ou **Cloner à côté**, qui fait une nouvelle copie dans un dossier voisin (`nom-2`).

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.claude.projectsFolder` | `~/Orbit` | Le dossier où les dépôts sont récupérés |
| `orbit.project.openIn` | `ask` | Ouvrir un autre projet dans une nouvelle fenêtre, à la place du projet en cours, ou demander à chaque fois |

## Limites

- La liste montre les 100 dépôts les plus récents de ton compte. Pour un dépôt plus ancien, tape son nom complet.
- Le parcours GitLab (installation de l'outil, connexion, liste) est récent et n'a pas encore été éprouvé sur un vrai compte.
- Un dépôt privé collé par son adresse ne se clone que si git a déjà tes accès. Sinon, connecte-toi au service et choisis le dépôt dans la liste.

## Voir aussi

- [Ouvrir et créer un projet](/docs/demarrer/projets)
- [Communauté](/docs/outils/communaute)
- [Terminaux d'agents](/docs/agents/terminaux)
