---
title: Vue vivante
description: Affiche ton interface à côté du code, choisis un élément et demande un changement à l'agent ou saute à son code.
order: 3
icon: monitor-smartphone
---

La vue vivante affiche l'interface que tu construis (un serveur de développement ou de simples pages HTML) dans un onglet à côté du code. Tu cliques un élément de la page : Orbit sait de quel fichier et de quelle ligne il vient, et peut envoyer la demande à l'agent ou ouvrir le code.

![Vue vivante](/captures/vivante.png)

## À quoi ça sert

Au lieu de décrire « le bouton en haut à droite de la carte tarifs », tu le montres. L'agent reçoit l'élément, son composant, le fichier et la ligne, et le sélecteur CSS. Dès qu'il modifie le code, la vue se met à jour toute seule.

## Comment l'utiliser

1. Lance ton serveur de développement (par exemple `npm run dev`), puis ouvre la vue vivante avec `Ctrl+Alt+V`. Le bouton existe aussi dans la barre du terminal, de la vue discussion et en haut d'un fichier `html`, `jsx`, `tsx`, `vue`, `svelte`, `astro` ou `css`.
2. Choisis ce que tu veux voir : un serveur détecté, une page HTML du projet, ou **Autre adresse…**.
3. Clique **Sélectionner** (ou touche `S`), puis un élément de la page.
4. Un panneau s'ouvre avec la balise, le composant et l'emplacement dans le code. Écris ce que tu veux changer (ou clique une suggestion comme « Plus grand » ou « Centrer ») et envoie avec **Envoyer à Claude** (`Ctrl+Entrée`). **Aller au code** ouvre le fichier sur la ligne, qui s'allume un instant.

Si aucun terminal d'agent n'est ouvert, un agent démarre avec ton message pour première consigne. Si l'agent attend une autorisation, Orbit te demande d'y répondre d'abord.

## Serveurs et pages

- Orbit cherche des serveurs sur `localhost`, aux ports `5173`, `5174`, `3000`, `3001`, `4321`, `4200`, `8080`, `8000`, `5000`, `8888`, `4000`, `3333`, `1234` et `8081`.
- Les pages HTML du projet sont servies par Orbit et rechargées à chaque enregistrement, en gardant la position de défilement.
- La page passe par un petit relais local d'Orbit (`127.0.0.1`) qui y ajoute l'inspecteur : ton application n'est pas modifiée.

## Retrouver le code d'un élément

| Source | Précision |
|---|---|
| Pages HTML du projet | exacte (chaque balise porte sa position) |
| React (y compris React 19) | exacte |
| Svelte | exacte |
| Vue | Orbit connaît le composant et cherche la ligne : l'emplacement est marqué « probable » |
| Autre cas | recherche du texte de l'élément dans le code, marquée « probable » |

## Appareils

Les boutons **Ordinateur**, **Tablette** et **Mobile** changent la taille de l'écran. Pour les deux derniers, une liste propose le modèle, dessiné en CSS d'après son matériel (taille d'écran exacte, arrondis, encoche ou poinçon, boutons), et un bouton fait pivoter l'appareil. Les 14 modèles :

- iPhone 16, 16 Pro, 16 Pro Max, iPhone SE ;
- Galaxy S25, S25 Ultra, A56 ; Pixel 9 Pro ;
- iPad Pro 13″, iPad Air 11″, iPad mini, iPad 10,9″ ;
- Galaxy Tab S10+ et S10 Ultra.

Le cadre est réduit pour tenir dans l'onglet, jamais agrandi, et les barres de défilement sont masquées comme sur un vrai appareil. Orbit se souvient du modèle choisi pour chaque type.

## Vue en grand

Le bouton d'agrandissement (ou la touche `F`) fait flotter le même cadre, sans le recharger, au centre sur un fond flouté, avec la zone d'éditeur maximisée. `Échap`, le bouton de fermeture ou un clic à côté la referment. `Échap` recule d'un cran à la fois : d'abord la sélection, puis le panneau de l'élément, puis la vue en grand.

## Erreurs de la page

L'inspecteur capte les erreurs que la page produit : exceptions, promesses rejetées, `console.error`, requêtes en échec (réponse en erreur ou échec réseau) et ressources introuvables, une fois chacune. Un compteur rouge apparaît dans la barre. Il ouvre la liste (les 30 dernières), et **Faire corriger par Claude** envoie tout à l'agent avec le fichier, la ligne et le début de la pile d'appels. **Effacer** vide la liste.

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Ouvrir la vue vivante | `Ctrl+Alt+V` | `⌥⌘V` |
| Envoyer la demande (champ de l'élément) | `Ctrl+Entrée` | `⌘⏎` |

Dans la vue : `S` active ou coupe la sélection, `F` ouvre ou ferme la vue en grand, `Échap` revient d'un cran.

## Avec ChatGPT

Rien ne change dans la vue elle-même. Le message part au terminal de l'agent courant, quel qu'il soit, et les textes de la page parlent de ChatGPT à la place de Claude.

## Limites

- La vue sert au développement local : un site en `https` ou sur une autre machine n'est pas pris en charge.
- En mode Sélectionner, les clics ne déclenchent plus les boutons de la page. Repasse en navigation (`Échap`) pour les utiliser.
- Quand l'emplacement est deviné, il est marqué « probable » : vérifie-le avant de t'y fier.

## Voir aussi

- [Relecture visuelle](/docs/boucle/relecture-visuelle)
- [Problèmes vers l'agent](/docs/boucle/problemes)
- [Suivre l'agent](/docs/agents/suivre-l-agent)
