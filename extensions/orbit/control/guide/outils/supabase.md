---
title: Supabase
description: Relie un projet Supabase au dossier, vois ses tables, ses comptes et son stockage, et protège les tables en un clic.
order: 2
icon: database
---

La page Supabase donne au projet une base de données, des comptes utilisateurs et du stockage. Elle liste et crée tes projets Supabase, écrit leur adresse et leur clé publique dans `.env.local`, montre les tables et permet de passer des requêtes SQL. Elle prépare aussi une consigne à l'agent pour brancher Supabase dans le code.

## D'où viennent les accès

Orbit n'a pas de serveur à lui. Cette page appelle l'API de gestion de Supabase (`api.supabase.com/v1`) avec un **jeton d'accès personnel** que tu crées toi-même dans ton compte Supabase. Il commence par `sbp_`. Tu le colles une fois dans la page ; il est gardé dans le stockage de secrets d'Orbit (le trousseau du système) et n'est jamais montré à l'agent.

Le bouton de la page ouvre la page des jetons de ton compte Supabase. Le bouton de déconnexion retire le jeton d'Orbit ; tes projets et les clés déjà écrites dans `.env.local` ne sont pas touchés.

## Comment l'utiliser

1. Ouvre la page par la commande `orbit.supabase.show`, ou par la liste « Outils du projet » (`Ctrl+Alt+K`).
2. Colle ton jeton. Orbit vérifie qu'il est accepté avant de le garder.
3. Choisis un projet existant, ou crée-en un (nom, organisation, région parmi huit). La création demande confirmation, car elle compte dans les projets de ton offre. Le mot de passe de la base est généré et rangé dans `.env.local` (`SUPABASE_DB_PASSWORD`). Orbit attend que le projet soit prêt avant de le relier.
4. « Relier » écrit l'adresse du projet et sa clé publique dans `.env.local`, avec le préfixe que ton framework attend pour le navigateur (`NEXT_PUBLIC_`, `VITE_`, `NUXT_PUBLIC_`, `EXPO_PUBLIC_` ou `PUBLIC_`, détecté dans `package.json`). Le fichier est ajouté au `.gitignore` s'il ne l'était pas.

## Ce que la page montre

- les **tables** du schéma public, avec leur nombre de lignes et l'état de la protection RLS (sécurité au niveau des lignes) ;
- le nombre de **comptes** et de **buckets** de stockage ;
- un **éditeur SQL**.

Une table sans RLS est signalée. Le bouton « Protéger » active la RLS après confirmation : sans règle d'accès, plus personne ne peut lire ni écrire la table avec la clé publique. Demande ensuite à l'agent d'écrire les règles dont l'application a besoin.

### Requêtes SQL

Une lecture (`select`, `with`, `explain`, `show`) s'exécute directement. Tout le reste demande une confirmation, car cela modifie la vraie base du projet. Les 200 premières lignes du résultat sont affichées.

### La clé secrète

La clé `service_role` contourne toutes les protections de la base. Orbit ne l'écrit dans `.env.local` que si tu le demandes, après confirmation. Ne l'utilise que côté serveur.

## Brancher Supabase dans le projet

Le bouton « Brancher dans le projet » envoie à l'agent le schéma actuel et les **noms** des variables, jamais une clé. Tu peux ajouter ta propre demande ; sinon la consigne par défaut demande d'installer la bibliothèque cliente, de créer le client à un seul endroit et de montrer comment lire une table. L'agent n'a pas à te donner du SQL à coller : il agit lui-même, par Orbit.

## Ce que l'agent fait lui-même

Orbit garde le jeton ; l'agent ne le voit jamais. Il passe par trois outils :

- `supabase_state` : le projet relié, ses tables, leurs colonnes et leur protection.
- `supabase_sql` : une requête, ou un fichier `.sql` du projet. Une requête qui ne fait que lire répond tout de suite. Une requête qui modifie la base s'affiche d'abord dans une fenêtre d'Orbit : tu lis le SQL et tu cliques « Exécuter », ou tu refuses.
- `supabase_auth_urls` : les adresses de redirection acceptées après une connexion ou un lien de mot de passe oublié. L'agent peut en ajouter, après ton accord.

Orbit ne régénère pas les clés : changer une clé d'API ou un secret reste ton geste, dans le tableau de bord Supabase.

## Avec ChatGPT

Le fonctionnement de la page est le même : l'API de gestion est appelée par Orbit, pas par l'agent. Seule la consigne part vers ChatGPT au lieu de Claude. Les valeurs de `.env.local` ne sont protégées de ChatGPT que par la consigne (voir [Variables d'environnement](/docs/outils/variables-d-environnement)).

## Limites

- Cette fonction est récente et peu éprouvée : elle n'a pas été essayée avec un vrai compte Supabase.
- Il faut un jeton d'accès personnel, pas la clé d'un projet.
- Le connecteur Supabase du [Magasin de compétences](/docs/outils/magasin) est une autre voie, qui donne des outils directement à l'agent ; elle est indépendante de cette page.

## Voir aussi

- [Variables d'environnement](/docs/outils/variables-d-environnement)
- [Base de données](/docs/outils/base-de-donnees)
- [Vercel](/docs/outils/vercel)
