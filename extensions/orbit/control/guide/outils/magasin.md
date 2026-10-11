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
| Les Crafting Apps (PhotoCraft, VectorCraft, FilmCraft… douze applications) | Création | La suite créative libre d'ArtCraft, pilotée par l'agent sur ta machine (voir plus bas) |
| Cloudflare | Mise en ligne | La documentation Cloudflare |
| Hugging Face | IA | Modèles, jeux de données et espaces du Hub |
| Canva | Design | Créer et retrouver des visuels |
| Jira et Confluence | Organisation | Tickets et pages de ton équipe |

Tous sont des serveurs hébergés où tu te connectes depuis le navigateur, sauf Playwright et les Crafting Apps, des programmes qui tournent chez toi.

## Où le trouver, et où va ce que tu installes

Le magasin s'ouvre par le bouton **Magasin** de la barre du bas, par `Ctrl+Alt+B` (`⌥⌘B` sur macOS), ou par « Outils du projet ».

Chaque service y porte son vrai logo, dans ses couleurs.

Ce que tu installes rejoint **Outils du projet** (le bouton outils de la barre du terminal, ou `Ctrl+Alt+K`) :

- un service qui a sa page dans Orbit (Figma, Supabase, Stripe, Vercel, Higgsfield) y est déjà, et **sa page s'ouvre toute seule** dès qu'il est installé et connecté ;
- une Crafting App s'y ajoute dans « Création », sous sa propre icône, et **s'ouvre dans Orbit dès la fin de l'installation** ; un clic l'y rouvre ensuite ;
- les autres services installés (Canva, GitHub, Notion, Linear, Sentry…) apparaissent dans un bloc « Installés » ; un clic ouvre leur site. Cette liste est celle vue la dernière fois que le magasin a interrogé ton assistant : elle se met à jour quelques secondes après l'ouverture d'Orbit et à chaque ouverture du magasin.

## Les Crafting Apps : la suite créative pilotée par l'agent

Les Crafting Apps sont douze logiciels libres du projet ArtCraft, chacun l'équivalent d'un logiciel connu, et chacun entièrement pilotable par des commandes. Une fois l'un d'eux installé, tu demandes à l'agent « recadre cette photo en carré », « dessine le logo en SVG », « monte ces trois clips », « assemble ces deux PDF » : il le fait sur ta machine, sans abonnement, et le fichier arrive dans ton projet.

| Application | Comme | Pour quoi |
|---|---|---|
| PhotoCraft | Photoshop | Retouche d'images, calques, détourage, fichiers PSD (voir [PhotoCraft](/docs/outils/photocraft)) |
| VectorCraft | Illustrator | Logos, icônes, illustrations ; SVG, PDF, AI, EPS |
| LightCraft | Lightroom | Développement photo, fichiers RAW, export en série |
| FilmCraft | Premiere Pro | Montage vidéo, export H.264, HEVC, ProRes |
| EffectCraft | After Effects | Animation, images clés, effets, rendu |
| DesignCraft | InDesign | Mise en page, documents à plusieurs pages, PDF |
| PdfCraft | Acrobat | Lire, assembler, découper, modifier des PDF |
| SoundCraft | Pro Tools | Sessions multipistes, mixage, export |
| WordCraft | Word | Documents texte, fichiers Word |
| GridCraft | Excel | Tableurs, formules, graphiques |
| DeckCraft | PowerPoint | Présentations |
| CADCraft | AutoCAD | Plans en 2D, fichiers DXF et DWG |

Le détail de chacune, pour toi comme pour l'agent, est dans [Crafting Apps](/docs/outils/crafting-apps).

- **Installation** : le bouton **Installer** de sa carte. Orbit télécharge la dernière version officielle depuis le dépôt du projet sur GitHub (de 15 à 100 Mo selon l'application), vérifie son empreinte et, sous Windows, sa signature, puis la range dans `~/.orbit/tools/<application>`. Rien n'est installé si une vérification échoue. Orbit ne contient aucune de ces applications et n'en est pas l'éditeur.
- **Pour qui** : les agents ouverts **après** l'installation. Orbit te propose de relancer ceux qui étaient déjà ouverts.
- **Ce qu'elle peut toucher** : PhotoCraft, VectorCraft, EffectCraft et PdfCraft sont tenues au dossier du projet où l'agent travaille. Les autres ne savent pas encore se limiter à un dossier : leurs outils lisent et écrivent là où tu le peux toi-même. La fenêtre d'installation te le dit.
- **N'installe que celles dont tu te sers** : chaque application installée ajoute ses outils à tous tes agents, donc deux petits programmes de plus par agent ouvert.
- **Retirer** : la croix de sa carte supprime la copie installée par Orbit. Ferme d'abord l'application si elle est ouverte.

### Une application dans Orbit, en direct

Chaque application installée (sauf PdfCraft, dont Orbit affiche déjà les fichiers) a sa ligne dans **Outils du projet** et s'ouvre **dans un onglet d'Orbit**. C'est la vraie application, sa vraie fenêtre, tenue exactement sur l'onglet : tu t'en sers à pleine vitesse, avec tous les gestes, comme si elle était ouverte à côté.

- **Tes agents agissent dessus sous tes yeux.** Dis à l'agent « ouvre le logo dans PhotoCraft et détoure-le » : tu vois l'image s'ouvrir, les menus et les calques changer. Tu peux reprendre la main à tout moment, dans la même fenêtre.
- **Elle ne bouge pas de son onglet.** Tu déplaces Orbit, tu le redimensionnes, tu changes la largeur des panneaux : elle suit et prend la nouvelle taille de l'onglet. Tu changes d'onglet ou tu réduis Orbit : elle s'efface, et revient avec l'onglet.
- **Ce qu'Orbit affiche par-dessus passe devant.** Une liste, la palette de commandes, un menu, une notification : l'application leur laisse la place à cet endroit précis, et tu cliques dessus normalement.
- **Ouvrir un fichier** propose les fichiers du projet que l'application sait ouvrir (PhotoCraft, VectorCraft, GridCraft, DeckCraft, CADCraft ; pour les autres, passe par leur menu Fichier ou demande à l'agent).
- **Sa propre fenêtre** sort l'application sur ton écran ; **Le ramener dans Orbit** la remet dans l'onglet. Tes agents continuent d'agir dessus dans les deux cas.
- **Rien n'est perdu.** Fermer l'onglet, recharger ou quitter Orbit ne ferme jamais l'application : elle revient devant toi, à l'écran, pour que tu enregistres ce que tu veux garder. Si tu la fermes toi-même, l'onglet le dit et propose de la rouvrir.

À savoir :

- Cette vue n'existe que sous Windows pour l'instant. Sur macOS et Linux, les agents ont les outils sans fenêtre.
- Après un rechargement d'Orbit, seule l'application de l'onglet affiché est reprise tout de suite ; les autres reviennent en fenêtres ordinaires et reprennent leur place quand tu affiches leur onglet.
- L'application s'efface une fraction de seconde après un changement d'onglet fait par un agent pendant que tu ne touches à rien (Orbit regarde alors la page une fois par seconde).
- Essayé sur un écran à 100 %. Les écrans à mise à l'échelle différente et les installations à plusieurs écrans ne l'ont pas été.

Toutes sont en alpha : leur éditeur dit lui-même qu'elles ne remplacent pas encore les logiciels qu'elles imitent. Des commandes peuvent manquer ou échouer ; l'agent a pour consigne de le dire et de passer par un autre moyen.

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
