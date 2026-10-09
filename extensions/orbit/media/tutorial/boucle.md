# Orbit vérifie le travail de Claude

Tu n'as plus à faire le contrôleur : Orbit regarde ce que Claude produit et lui renvoie ce qui ne va pas.

## Vérification automatique

À la fin de chaque tour où Claude a modifié des fichiers, Orbit lance les contrôles du projet (types, lint, et ceux que tu choisis). Le résultat s'affiche dans la barre d'état : **Vérifié**, ou **N contrôles en échec** en rouge.

- En cas d'échec, une notification propose **Renvoyer à Claude** : il reçoit la sortie du contrôle et corrige.
- Clique l'indicateur de la barre d'état pour choisir : me demander, renvoyer automatiquement (deux fois au plus par message), ou désactiver.
- Les contrôles sont trouvés seuls (scripts `typecheck` et `lint`, `tsconfig.json`, Cargo, Go). Pour les choisir toi-même : **Choisir les contrôles du projet**, qui crée `.orbit/checks.json`.

## Erreurs de la page, en direct

Dans la **vue vivante**, les erreurs de la page (exceptions, promesses rejetées, `console.error`, requêtes en échec) allument un compteur rouge. Un clic affiche la liste, **Faire corriger par Claude** lui envoie tout, avec le fichier, la ligne et la pile d'appels.

## Problèmes de l'éditeur

Sur une erreur soulignée : l'ampoule propose **Corriger avec Claude**. Clic droit dans un fichier : **Faire corriger par Claude les problèmes de ce fichier**. Le panneau Problèmes a un bouton pour tout le projet.

## Revue des changements

Dans la **Frise du projet**, chaque tour liste ses fichiers avec les lignes ajoutées et retirées. Sur un fichier :

- un clic ouvre le avant / après ;
- **Commenter ce fichier pour Claude** lui envoie ta remarque avec le fichier ;
- **Annuler ce fichier seulement** le remet comme avant ce tour, sans toucher au reste.
