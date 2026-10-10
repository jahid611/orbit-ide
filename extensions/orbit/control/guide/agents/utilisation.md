---
title: Utilisation et jetons
description: Suis la consommation de ton abonnement et les jetons de chaque agent.
order: 18
icon: gauge
---

Orbit affiche l'état de ton abonnement comme la commande `/usage` de l'agent : la session en cours, la semaine, les limites par modèle. Il montre aussi les jetons consommés par chaque agent.

![Carte d'utilisation](/captures/tuto-utilisation.png)

## À quoi ça sert

Savoir où tu en es avant de lancer un gros travail (une grille d'agents, une file de nuit), et repérer l'agent qui consomme le plus.

## Comment l'utiliser

Le compteur de la barre d'état, en bas à droite, affiche « session · semaine » en pourcentages. Survole-le pour le détail, clique pour ouvrir la carte. La carte s'ouvre aussi avec le bouton d'utilisation de la barre d'outils du panneau (en vue terminal comme en vue discussion) ou avec la commande « Utilisation de Claude ».

La carte montre :

- la **session en cours** (la fenêtre de 5 heures) ;
- la **semaine**, tous modèles confondus ;
- les limites **par modèle**, quand il y en a ;
- la **répartition de la semaine** ;
- l'heure de remise à zéro de chaque limite.

Une barre passe au rouge à partir de 90 %, et le compteur de la barre d'état prend la couleur d'alerte. Les boutons « Actualiser » et « Détail sur claude.ai » sont dans la carte. Orbit actualise les chiffres toutes les 5 minutes et après le travail d'un agent, sans interroger le service plus d'une fois toutes les 45 secondes.

## Jetons par agent

Dans la vue **Équipe**, chaque agent affiche les jetons qu'il a écrits. Au survol : jetons écrits, taille du contexte et nombre de réponses. Orbit les lit dans la conversation de l'agent, chaque réponse n'étant comptée qu'une fois.

## Comment ça marche

Orbit lit la connexion que Claude Code garde sur ta machine pour interroger le service d'usage de l'abonnement. Il ne la renouvelle jamais lui-même.

> **À savoir** Si la carte indique « Connexion expirée », ouvre un terminal d'agent pour la renouveler, puis actualise.

## Avec ChatGPT

La jauge est lue dans le dernier enregistrement de limites des journaux de Codex (pourcentage, fenêtre, remise à zéro, type d'abonnement) : aucun service n'est appelé. Sans journal, la carte demande de lancer ChatGPT une première fois dans un terminal. Les jetons par agent sont lus dans les mêmes journaux.

## Réglages

La facturation se règle avec `orbit.claude.billing` (`subscription` par défaut, ou `apiKey`). Avec une facturation par clé d'API, les limites d'abonnement ne s'appliquent pas : le compteur disparaît.

## Limites

- Le compteur est masqué tant qu'aucune donnée n'est disponible (déconnecté, clé d'API).
- La lecture de la connexion dépend de Claude Code : fichier `.credentials.json` de son dossier de configuration, ou trousseau sous macOS.

## Voir aussi

- [Abonnement et facturation](/docs/demarrer/abonnement)
- [Chef d'équipe](/docs/agents/chef-d-equipe)
- [File de nuit](/docs/agents/file-de-nuit)
