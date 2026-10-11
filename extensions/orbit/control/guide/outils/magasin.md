---
title: Magasin de compétences
description: Ajoute en un clic des connecteurs (GitHub, Figma, Supabase…) et des paquets de recettes, ou installe ceux que d'autres ont publiés.
order: 8
icon: download
---

Le magasin réunit ce qui donne de nouvelles capacités à l'agent : des **connecteurs** (des serveurs MCP publiés par les outils eux-mêmes) et des **recettes** (des demandes toutes prêtes). Tu les ajoutes depuis une page, sans écrire de ligne de commande.

## D'où viennent les accès

Orbit n'a pas de serveur à lui et ne détient aucun jeton. Un connecteur est ajouté à **ton outil d'agent** (Claude Code ou Codex), puis tu te connectes dans ton navigateur, avec ton propre compte chez l'outil concerné. L'état de chaque connecteur est lu dans la liste de ton outil d'agent (`mcp list`). Les adresses sont celles que chaque éditeur documente. Les logos viennent de `cdn.simpleicons.org` (l'initiale sert de secours).

## Comment l'utiliser

1. Ouvre le magasin par la commande `orbit.store.show`, ou par la liste « Outils du projet » (`Ctrl+Alt+K`).
2. Pour un connecteur, clique pour l'ajouter. Orbit lance `mcp add` en portée utilisateur (le connecteur vaut pour tous tes projets), puis `mcp login` : la page de connexion de l'outil s'ouvre, tu valides, et la carte passe à « connecté ». Tout se fait en arrière-plan, sans terminal. Un connecteur déjà présent mais non connecté (venu d'une extension ou ajouté plus tôt) n'a besoin que de la connexion.
3. Pour retirer un connecteur, utilise « Retirer » : Orbit le déconnecte et le supprime de l'outil d'agent, après confirmation. Ton compte chez l'outil n'est pas touché. Un connecteur qui vient de ton compte claude.ai ou d'une extension se retire là où il a été ajouté.

La connexion se fait dans un terminal d'Orbit nommé « Connexion · » suivi du nom du service, parce que l'outil d'agent ne se connecte que depuis un terminal. Tu valides dans le navigateur ; si le terminal te le demande, colle-lui l'adresse de la page sur laquelle tu arrives. Le terminal se range tout seul une fois la connexion faite. La page Figma et le studio Higgsfield passent par le même chemin.

## Les connecteurs

| Connecteur | Catégorie | Sert à |
|---|---|---|
| GitHub | Code | Issues, pull requests, revues, recherche dans tes dépôts |
| Figma | Design | Lire des maquettes (voir [Figma vers code](/docs/outils/figma)) |
| Supabase | Données | Tables, requêtes SQL, migrations, journaux |
| Stripe | Paiement | Produits, prix, clients, liens de paiement, documentation |
| Vercel | Mise en ligne | Projets, déploiements, journaux de construction |
| Sentry | Qualité | Les erreurs de ton application, avec leur pile |
| Linear | Organisation | Tickets, projets et cycles |
| Notion | Organisation | Recherche, lecture et écriture dans pages et bases |
| Context7 | Documentation | La documentation à jour des bibliothèques |
| Playwright | Qualité | Un navigateur piloté par l'agent (programme lancé sur ta machine avec `npx`) |
| Higgsfield | Création | Images, vidéos, 3D et sons (voir [Higgsfield](/docs/outils/higgsfield)) |
| Cloudflare | Mise en ligne | La documentation Cloudflare |
| Hugging Face | IA | Modèles, jeux de données et espaces du Hub |
| Canva | Design | Créer et retrouver des visuels |
| Jira et Confluence | Organisation | Tickets et pages de ton équipe |

Tous sont des serveurs hébergés où tu te connectes depuis le navigateur, sauf Playwright, un programme qui tourne chez toi.

## Les paquets de recettes

Quatre paquets sont fournis. Les ajouter copie leurs recettes dans `~/.orbit/recipes.json`, où tu peux les modifier ; une recette dont le nom existe déjà n'est pas dupliquée. Elles apparaissent dans « Mes recettes » (voir [Recettes](/docs/agents/recettes)).

| Paquet | Recettes |
|---|---|
| Qualité du code | Revue sévère, Tests manquants, Code mort, Simplifier |
| Interface | Adapter au téléphone, Accessibilité, États manquants, Finition |
| Sécurité | Audit de sécurité, Secrets oubliés, Entrées de l'utilisateur |
| Livraison | Prêt à publier ?, Notes de version, Performance |

## La communauté

La page cherche sur GitHub les dépôts portant le sujet `orbit-ide-skill` (les plus étoilés d'abord, trente au plus). Un tel dépôt contient un fichier `.orbit/skill.json` avec des `recipes` et des `connectors`. Avant toute installation, une fenêtre te montre les recettes et les connecteurs (avec leur adresse). C'est le contenu d'un autre utilisateur : une recette est un texte envoyé à ton agent et un connecteur lui donne des outils. N'installe que ce en quoi tu as confiance. Seuls les connecteurs à adresse `https://` sont acceptés.

Pour publier le tien, crée un dépôt GitHub avec ce sujet et ce fichier.

## Avec ChatGPT

Les connecteurs sont ajoutés avec `codex mcp add` (et `--url` pour les serveurs hébergés) au lieu de la commande de Claude Code, et l'état est lu dans la liste de Codex. Les recettes sont les mêmes. Ce parcours n'a pas été essayé avec ChatGPT.

## Limites

- Aucune installation réelle n'a été rejouée de bout en bout : les adresses sont celles documentées par chaque éditeur, mais la fonction est récente et peu éprouvée.
- La recherche GitHub est limitée en nombre de requêtes : si elle échoue, la page invite à réessayer dans une minute.

## Voir aussi

- [Recettes](/docs/agents/recettes)
- [Figma vers code](/docs/outils/figma)
- [Communauté](/docs/outils/communaute)
