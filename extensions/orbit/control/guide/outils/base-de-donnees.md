---
title: Base de données
description: Explore une base SQLite ou PostgreSQL, modifie ses lignes en sûreté, vois son schéma et demande tes requêtes à l'agent.
order: 7
icon: database
---

La page Base de données ouvre les bases du projet : tableau des données, schéma en cartes reliées par leurs clés étrangères, onglet SQL, et une zone pour demander une requête en langage courant. Toute écriture passe par une confirmation ou une transaction.

![Base de données](/captures/tuto-base.png)

## D'où viennent les accès

Orbit n'a pas de serveur à lui et la page parle directement à ta base :

- **SQLite** : le fichier est lu sur ton disque avec le module SQLite intégré au runtime, sans module natif à installer.
- **PostgreSQL** (y compris Supabase) : par l'adresse de connexion, via la bibliothèque `pg`. Les bases hébergées passent en connexion chiffrée ; une base locale (`localhost`, `127.0.0.1`) non.

Les adresses PostgreSQL sont gardées dans le stockage de secrets d'Orbit, jamais dans un fichier du projet. Aucun jeton n'est demandé.

## Comment l'utiliser

1. Ouvre la page avec `Ctrl+Alt+D` (`⌥⌘D` sur macOS), par le bouton de la barre Discussions, ou par la liste « Outils du projet » (`Ctrl+Alt+K`).
2. Orbit trouve les bases du projet : les fichiers `.db`, `.sqlite`, `.sqlite3` et `.db3` (vérifiés à leur en-tête), et les adresses `postgres://` des fichiers `.env*` dans les variables `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`, `SUPABASE_DB_URL`, `PG_URL` ou `DB_URL`. « Nouvelle connexion » en ajoute d'autres, fichier SQLite ou adresse PostgreSQL.
3. Choisis une table.

### Données

Parcours, tri et filtre (une seule condition, par exemple `ville = 'Paris'`), par pages de 100 lignes. Double-clique une cellule pour la modifier ; ajoute ou supprime des lignes. Tout reste **en attente** jusqu'à « Appliquer », puis passe en **une seule transaction** : si une modification échoue (clé étrangère, valeur unique, colonne obligatoire), rien n'est modifié et Orbit explique pourquoi. Une table sans clé primaire est en lecture seule dans la grille.

### Schéma

Les tables en cartes déplaçables, reliées par leurs clés étrangères. Double-clique une table pour voir ses données.

![Schéma des tables](/captures/tuto-schema.png)

### SQL

Écris et exécute tes requêtes. Toute requête qui modifie la base ou sa structure demande une confirmation avant exécution.

### Demander une requête à l'agent

Le champ du bas accepte des demandes comme « les 10 clients qui commandent le plus » ou « génère 20 lignes de test ». Orbit envoie à l'agent le dialecte et le **schéma** (noms de tables et de colonnes, types, clés), pas le contenu des tables. L'agent répond par une requête et une explication, sans outil ; tu la relis, puis tu l'exécutes. Une requête qui écrit est marquée comme telle.

### Confier à l'agent

Pour les gros chantiers (migrations, scripts de remplissage, refonte du schéma), « Confier à Claude » envoie la demande dans un terminal d'agent, avec le schéma et l'emplacement de la base, en lui demandant de te montrer les requêtes qui modifient des données ou la structure avant de les exécuter.

## Avec ChatGPT

La requête proposée est demandée à Codex en lecture seule (`codex exec`), ce qui coûte environ 15 000 jetons de contexte de base par appel. Le reste de la page est identique.

## Limites

- Le filtre et l'onglet SQL exécutent ce que tu écris : sur une base de production, travaille plutôt sur une copie.
- Pour une base PostgreSQL trouvée dans un `.env`, le message de « Confier à l'agent » lui indique de lire l'adresse dans ce fichier. Si la protection des fichiers `.env` est active (voir [Variables d'environnement](/docs/outils/variables-d-environnement)), il n'a pas le droit de le faire : indique-lui le nom de la variable ou règle-le autrement.
- Seuls les 1 000 premiers résultats d'une requête sont affichés.
- La liste des tables PostgreSQL laisse de côté les schémas internes (ceux de Supabase comme `auth`, `storage` ou `realtime`, et les schémas système).

## Voir aussi

- [Supabase](/docs/outils/supabase)
- [Variables d'environnement](/docs/outils/variables-d-environnement)
- [Communauté](/docs/outils/communaute)
