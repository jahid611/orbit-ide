---
title: Recettes
description: Des consignes prêtes à l'emploi, envoyées à l'agent en un clic, avec le fichier ou la sélection déjà renseignés.
order: 15
icon: book-open
---

Une recette est une consigne enregistrée : revue de code, écriture de tests, chasse aux bugs, préparation d'une mise en production. Tu la choisis dans une liste, Orbit remplit les variables (le fichier ouvert, ta sélection…) et l'envoie à l'agent.

## À quoi ça sert

À ne pas retaper les mêmes demandes, et à les partager : les recettes d'un projet peuvent être commitées pour toute l'équipe.

## Comment l'utiliser

1. Ouvre la vue **Recettes** de la barre latérale d'Orbit, ou lance `Ctrl+Alt+J` pour choisir dans une liste.
2. Clique sur une recette. Si elle a besoin d'un fichier ou d'une sélection, ouvre-le d'abord dans l'éditeur.
3. Orbit l'envoie au terminal d'agent courant. S'il n'y en a pas, il démarre un agent dont la recette est le premier message.

Pour créer une recette : bouton « Nouvelle recette… » de la vue (nom, puis consigne), ou sélectionne du texte dans l'éditeur, clic droit, **Enregistrer la sélection comme recette**. Tu choisis où l'enregistrer. Les recettes fournies sont en lecture seule : « Modifier » en propose une copie dans les tiennes.

## Les trois groupes

| Groupe | Fichier | Usage |
|---|---|---|
| Projet | `.orbit/recipes.json` | Partagé avec l'équipe |
| Mes recettes | `~/.orbit/recipes.json` | Pour toi, dans tous les projets |
| Orbit | fournies | Lecture seule |

Le fichier est un JSON `{ "recipes": [ … ] }` (un tableau simple est aussi accepté). Chaque recette a un `name` et un `prompt` obligatoires, et peut avoir un `id`, une `description` et une `icon` (nom d'icône sans `$( )`). Une recette sans nom ou sans consigne est ignorée, et la vue le signale.

## Variables

| Variable | Remplacée par |
|---|---|
| `{{fichier}}` | Chemin du fichier ouvert dans l'éditeur, relatif au projet |
| `{{selection}}` | Le texte sélectionné |
| `{{dossier}}` | Le dossier du projet |
| `{{question: Intitulé}}` | La réponse que tu tapes dans une boîte de saisie à l'envoi |

Si une variable ne peut pas être remplie (pas de fichier ouvert, sélection vide, pas de dossier), Orbit te le dit et n'envoie rien. Une valeur qui contient elle-même `{{…}}` n'est jamais développée une seconde fois.

Exemple : `Traduis @{{fichier}} en anglais sans toucher au code`.

## Les 12 recettes fournies

- **Ajouter un composant d'interface** : un composant adapté au style du projet.
- **Revue de code du diff courant** : relit les changements non commités, classés par gravité.
- **Écrire les tests du fichier ouvert** : avec le framework déjà en place.
- **Expliquer le fichier à un débutant** : le rôle du fichier, sans jargon.
- **Chasser les bugs d'un fichier** : cherche les vrais bugs et les prouve.
- **Refactoriser sans changer le comportement** : code plus lisible, comportement identique.
- **Documenter : README à jour** : aligne le README sur ce que fait le projet.
- **Préparer une mise en production** : liste de contrôle vérifiée point par point.
- **Audit de sécurité** : failles exploitables, avec le correctif.
- **Optimiser les performances** : mesure d'abord, corrige ensuite.
- **Rendre une page responsive** : adapte la page active du téléphone au grand écran.
- **Corriger les erreurs de compilation** : build et typage au vert, sans masquer les erreurs.
- **Résumer ce qui a changé aujourd'hui** : les commits et les changements en cours du jour.

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Choisir une recette | `Ctrl+Alt+J` | `⌥⌘J` |

## Limites

- Les recettes fournies ne se suppriment pas.
- Un fichier de recettes dont le JSON est invalide n'est jamais réécrit par Orbit : corrige-le à la main (le bouton « Ouvrir le fichier » t'y mène).
- Le magasin de compétences peut ajouter des paquets de recettes à `~/.orbit/recipes.json` (voir [Magasin de compétences](/docs/outils/magasin)).

## Voir aussi

- [Magasin de compétences](/docs/outils/magasin)
- [Commit intelligent](/docs/boucle/commit-intelligent)
- [Terminaux d'agents](/docs/agents/terminaux)
