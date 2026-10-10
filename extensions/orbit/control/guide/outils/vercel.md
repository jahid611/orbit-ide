---
title: Vercel
description: Mets le projet en ligne en un clic et suis tes déploiements depuis une page qui reprend le tableau de bord de Vercel.
order: 1
icon: rocket
---

La page Vercel publie le projet : elle l'envoie sur GitHub, le relie à Vercel, lance le déploiement en production et le suit ligne à ligne. Elle affiche aussi l'état du projet côté Vercel (déploiement en production, domaines, liste des déploiements, journal de construction), avec l'apparence de l'outil d'origine quel que soit le thème d'Orbit.

## D'où viennent les accès

Orbit n'a pas de serveur à lui et ne demande aucun jeton. Tout passe par les connexions que tu as déjà dans tes propres outils en ligne de commande :

- l'outil `vercel` pour ton compte Vercel (les données du tableau de bord viennent de `vercel api`, en lecture seule) ;
- l'outil `gh` pour ton compte GitHub (dépôt, envoi du code).

Orbit ne voit jamais de jeton. Si l'outil `vercel` n'est pas installé, la page propose de l'installer (`npm install -g vercel`) puis de te connecter (`vercel login`) en arrière-plan : Orbit ouvre l'adresse de connexion dans ton navigateur et affiche le code à valider.

## Comment l'utiliser

1. Ouvre la page par le bouton au logo Vercel de la barre du terminal, ou par la liste « Outils du projet » (commande `orbit.tools`, `Ctrl+Alt+K`).
2. La page vérifie l'outil `vercel`, ton compte (`vercel whoami`), le dépôt git et son distant, `gh auth status` et la présence de `.vercel/project.json`. Ce qui manque est indiqué ; la page avance toute seule dès que tu l'as réglé, où que tu l'aies fait.
3. Clique sur « Publier ». Orbit enchaîne :
   - le dépôt GitHub : s'il n'existe pas, Orbit demande confirmation puis le crée en privé (`gh repo create`) ;
   - l'enregistrement de tout ce qui a changé, avec un message de commit écrit par l'agent (un message fixe sert de repli) ;
   - l'envoi sur GitHub (`git push`) ;
   - à la première fois, `vercel link --yes` puis `vercel git connect --yes`, pour que les envois suivants déploient d'eux-mêmes ;
   - `vercel deploy --yes --prod`, suivi dans le journal de la page.
4. Une notification donne l'adresse en ligne, avec un bouton pour l'ouvrir.

Le bouton « Aperçu » crée un déploiement d'essai sans toucher au site en production. L'historique des adresses publiées depuis Orbit est gardé pour le projet.

### Le tableau de bord

Quand le projet est relié, la page lit Vercel et montre la carte « Déploiement en production » avec une capture du site, les domaines, le statut, la source et la liste des déploiements. La capture est prise une fois par déploiement par Edge ou Chrome, déjà présent sur la machine. Un déploiement en cours est relu toutes les 4 secondes, y compris s'il a été lancé ailleurs (un envoi sur GitHub, par exemple).

## Si le déploiement échoue

Le journal indique l'étape en cause. Le bouton « Faire corriger » envoie la fin du journal à l'agent, qui cherche la cause dans le projet (script de construction, dépendances, variables d'environnement, configuration Vercel). Le message n'est tapé que dans un terminal où l'agent tourne encore ; sinon un agent neuf démarre avec ce message.

## Git sans identité

Si aucune identité git n'est réglée sur la machine, le commit est signé avec ton compte GitHub connecté, avec son adresse privée `<id>+<identifiant>@users.noreply.github.com`, pour ce commit seulement. Rien n'est écrit dans ta configuration git.

## Se déconnecter

Le bouton de déconnexion lance `vercel logout` après confirmation. Tes sites restent en ligne.

## Avec ChatGPT

Rien ne change dans le parcours : le message de commit et la correction d'un échec sont confiés à ChatGPT au lieu de Claude. Ce chemin n'a pas été essayé de bout en bout avec ChatGPT.

## Limites

- La publication réelle n'a jamais été menée au-delà de l'étape du commit lors des essais. L'affichage et les vérifications sont testés ; le parcours complet (dépôt, lien, déploiement) reste peu éprouvé.
- Les parcours d'installation et de connexion en arrière-plan n'ont pas été rejoués sur une machine sans compte déjà connecté.
- Un site publié depuis Orbit passe par GitHub : sans `gh` connecté, la publication s'arrête à la première étape.

## Voir aussi

- [Variables d'environnement](/docs/outils/variables-d-environnement)
- [Supabase](/docs/outils/supabase)
- [Magasin de compétences](/docs/outils/magasin)
