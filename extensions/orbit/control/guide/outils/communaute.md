---
title: Communauté
description: Démarre un projet à partir d'un template publié par un autre utilisateur, ou partage le tien sur GitHub sans fuite de secrets.
order: 9
icon: users
---

La communauté d'Orbit est un catalogue de templates : des projets complets que chacun publie, et que tu copies pour démarrer le tien. Il n'y a pas de serveur d'Orbit derrière : un template est un dépôt GitHub public portant le sujet `orbit-ide-template`, et la page cherche simplement dans GitHub.

![La page Communauté](/captures/commu.png)

## D'où viennent les accès

Parcourir et utiliser un template ne demande aucun compte. Partager le tien passe par **ton compte GitHub** et ton outil `gh` : la page te demande de te connecter (`gh auth login`, dans un terminal) si ce n'est pas fait. Orbit ne garde aucun jeton ; il utilise la connexion de `gh` pour les recherches et la publication.

## Découvrir et utiliser un template

1. Ouvre la page par la commande `orbit.community.show` ou par le bouton de la barre Discussions.
2. Cherche par mot-clé ; le filtre « mes templates » (si `gh` est connecté) n'affiche que les tiens. Chaque carte montre la couverture, le titre, la description, l'auteur, le langage et les étoiles ; les plus récemment mis à jour passent en premier (quarante au plus).
3. Clique « Utiliser » et donne un nom. Orbit clone le dépôt sans historique dans ton dossier de projets (`~/Orbit` par défaut, réglage `orbit.claude.projectsFolder`), supprime `.git` et `.orbit` du clone, crée un dépôt git neuf, ouvre le projet et lance l'agent. C'est un projet à toi, sans lien avec l'original.

## Partager un projet

La commande `orbit.community.share` (« Partager ce projet dans la communauté… ») ou l'onglet de partage de la page prépare un brouillon avant toute publication :

- **Inventaire** des fichiers (ceux que git suit ou suivrait ; sinon un parcours qui saute `node_modules`, les dossiers de construction, etc.).
- **Exclusions automatiques**, quoi que dise ton `.gitignore` : fichiers `.env` (remplacés par un `.env.example` qui ne garde que les noms), clés et certificats, clés SSH, fichiers d'identifiants, fichiers dont le nom contient « secret », journaux, fichiers système, bases de données (seule leur structure est partagée, dans `database/*.schema.sql`) et fichiers de plus de 25 Mo.
- **Détection de secrets** : un fichier où un motif ressemble à une clé privée, une clé AWS, Google, Stripe, un jeton GitHub ou Slack, une clé d'API, une adresse avec mot de passe ou un mot de passe écrit en clair est exclu, avec la ligne en cause.
- **Couverture** : `.orbit/cover.png`, une capture de la page d'accueil du projet prise par Edge ou Chrome sans fenêtre (d'après un serveur local prouvé comme servant ce projet, sinon un `index.html`), sinon une carte titre ; tu peux aussi choisir une image.
- `.orbit/template.json` (titre, description) et un `README.md` si le projet n'en a pas.

Tu vois la liste des fichiers inclus et exclus, puis un message de confirmation précise le nom du dépôt public, le nombre de fichiers visibles par tout le monde et les fichiers qui restent chez toi. Après ta confirmation, Orbit crée le dépôt (`gh repo create --public`) et y ajoute le sujet `orbit-ide-template`. Le commit est signé avec l'adresse privée de ton compte GitHub (`<id>+<identifiant>@users.noreply.github.com`) : ton e-mail n'est jamais publié.

> **Attention** Un dépôt public est visible et copiable par tout le monde. La détection de secrets est un filet, pas une garantie : relis la liste avant de publier.

## Avec ChatGPT

Cette fonction ne dépend pas de l'agent : elle utilise GitHub et `git`. L'agent lancé après « Utiliser » est celui que tu as choisi.

## Limites

- La détection de secrets ne lit que les fichiers de moins de 1 Mo ; un fichier plus gros n'est pas analysé.
- Seules des bases SQLite sont traduites en schéma ; les autres formats de base ne sont pas exportés (les fichiers de base sont de toute façon exclus).
- Sans Edge ni Chrome sur la machine, la capture de couverture échoue : choisis alors une image.
- Les recherches GitHub sans connexion sont limitées en nombre : si la page signale une limite, attends une minute ou connecte `gh`.
- Un template vient d'un autre utilisateur : relis-le avant de lancer ce qu'il contient.

## Voir aussi

- [Magasin de compétences](/docs/outils/magasin)
- [Ouvrir et créer un projet](/docs/demarrer/projets)
- [Variables d'environnement](/docs/outils/variables-d-environnement)
