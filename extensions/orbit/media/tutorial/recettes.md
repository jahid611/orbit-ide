# Recettes, commit et équipe

## Recettes

Des consignes prêtes à l'emploi, envoyées à Claude en un clic : revue de code, écrire les tests, chasser les bugs, préparer une mise en production…

- Vue **Recettes** dans la barre latérale d'Orbit, ou **Ctrl+Alt+J** (⌥⌘J).
- Trois groupes : celles du **projet** (`.orbit/recipes.json`, à partager avec ton équipe), **les tiennes** (`~/.orbit/recipes.json`) et celles d'**Orbit**.
- Variables : `{{fichier}}`, `{{selection}}`, `{{dossier}}`, et `{{question: Intitulé}}` qui te pose la question à l'envoi.
- Sélectionne du texte, clic droit, **Enregistrer la sélection comme recette**.

## Commit intelligent

Dans le Contrôle de source, le bouton au logo Claude rédige le message de commit d'après tes changements, dans le style des commits du dépôt. Tu relis, tu valides. Le message ne mentionne jamais d'IA.

## Chef d'équipe

**Ctrl+Alt+C** (⌥⌘C) ouvre un Claude à qui tu parles seul : il crée les agents, leur donne un nom, un rôle et une consigne, suit leur travail et te fait le point. La vue **Équipe** montre chaque agent, son état et les jetons qu'il a consommés.

Le bouton éclair de la barre du terminal passe **tous les Claude en mode auto** d'un clic.

## Coller une capture

Capture d'écran (Win+Maj+S), puis **Ctrl+V** dans un terminal Claude : l'image est jointe au message. Dans la vue discussion, elle apparaît en vignette.
