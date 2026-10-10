---
title: Figma vers code
description: Colle le lien d'un cadre Figma, l'agent lit la maquette et construit l'écran avec la pile du projet.
order: 4
icon: palette
---

Cette page transforme une maquette Figma en code. Tu colles le lien d'un cadre, tu choisis ce que tu veux construire, et Orbit envoie à l'agent une consigne complète : lire la maquette, écrire le code avec ce que le projet utilise déjà, puis comparer le résultat à la maquette dans la vue vivante.

## D'où viennent les accès

Orbit ne lit jamais ton compte Figma lui-même et ne garde aucun jeton Figma. C'est l'agent qui lit la maquette, avec le **connecteur Figma** de son propre outil (Claude Code ou Codex). Tu te connectes à Figma une fois, dans ton navigateur, avec ton compte. Orbit n'a pas de serveur à lui.

Si le connecteur manque, la page propose de le relier : Orbit l'ajoute à l'agent (adresse `https://mcp.figma.com/mcp`, publiée par Figma) et lance la connexion, que tu valides dans le navigateur. C'est le même connecteur que celui du [Magasin de compétences](/docs/outils/magasin).

## Comment l'utiliser

1. Ouvre la page par la commande `orbit.figma.show`, ou par la liste « Outils du projet » (`Ctrl+Alt+K`).
2. Dans Figma, sélectionne le cadre voulu et copie son lien avec « Copy link to selection ».
3. Colle le lien dans la page. Sont acceptés les liens `figma.com` de type `design`, `file`, `proto`, `board` ou `make`.
4. Choisis ce que l'agent doit construire : un écran complet, une section ou un composant. Une case permet d'adapter le résultat au téléphone et au grand écran, puisque la maquette ne montre qu'une taille. Un champ libre accepte des précisions.
5. Envoie. La consigne part vers le terminal où l'agent tourne encore ; sinon un agent neuf démarre avec ce message.

La page affiche la pile détectée dans `package.json` (par exemple Next.js, React, Tailwind CSS, TypeScript, shadcn/ui, Motion). L'agent doit réutiliser les composants, les couleurs et les espacements déjà présents avant d'en créer de nouveaux. Sans `package.json`, la page reconnaît un projet HTML et CSS si elle trouve un `index.html`.

## Ce que l'agent reçoit

La consigne demande, dans l'ordre :

1. de lire la maquette avec les outils Figma (contexte du design, variables, capture de la sélection), section par section si le cadre est grand ;
2. d'écrire le code avec la pile du projet ;
3. de respecter la maquette (tailles, espacements, polices, couleurs, arrondis, ombres) et de récupérer les images et icônes depuis Figma, sans substituts ;
4. de rendre le résultat propre sur téléphone et grand écran, si la case est cochée ;
5. d'ouvrir le résultat dans la [vue vivante](/docs/boucle/vue-vivante), de le comparer à la capture de la maquette et de corriger les écarts.

La page garde l'historique des derniers liens envoyés pour les rouvrir.

## Avec ChatGPT

Le connecteur est ajouté avec `codex mcp add` au lieu de la commande de Claude Code, et la connexion passe par la commande de connexion de Codex. Ce parcours n'a pas été essayé avec ChatGPT.

## Limites

- Cette fonction est récente et peu éprouvée : elle n'a pas été essayée avec un vrai compte Figma.
- La qualité du résultat dépend de ce que le connecteur Figma permet de lire (droits sur le fichier, taille du cadre) ; un grand cadre est traité par morceaux.
- Orbit n'envoie que la consigne : il ne vérifie pas lui-même la ressemblance avec la maquette, c'est l'agent qui compare.

## Voir aussi

- [Magasin de compétences](/docs/outils/magasin)
- [Vue vivante](/docs/boucle/vue-vivante)
- [Relecture visuelle](/docs/boucle/relecture-visuelle)
