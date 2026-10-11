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

Le message dit aussi à l'agent sur quel affichage tu étais : ordinateur (avec la largeur de la page), ou le téléphone ou la tablette choisi, avec sa taille et son orientation. Il règle donc ta demande pour cet affichage sans toucher aux autres, sauf si tu le lui demandes.

### Un vrai téléphone pour la page

Choisir un appareil ne fait pas que rétrécir le cadre : la page est rechargée et se comporte comme sur cet appareil, à la manière du mode appareil des outils de développement d'un navigateur (F12).

- **Identité** : le serveur et la page reçoivent l'identité du téléphone ou de la tablette (`User-Agent` d'un iPhone, d'un Android, d'un iPad). Un site qui sert une version mobile d'après cette identité la sert.
- **Écran** : `screen.width`, `screen.height`, l'orientation et la densité de pixels (`devicePixelRatio`) sont ceux de l'appareil. Pivoter l'appareil les met à jour sans recharger.
- **Tactile** : la page se sait tactile (`ontouchstart`, `navigator.maxTouchPoints`), et les règles `hover` et `pointer` des feuilles de style et de `matchMedia` répondent comme pour un doigt : plus d'effets de survol.
- **Doigt** : le pointeur devient un rond. Un appui envoie aussi les événements `touchstart` et `touchend`, et faire glisser la page la fait défiler comme avec le pouce.

Revenir à l'affichage libre recharge la page en mode ordinateur.

Ce que la simulation ne fait pas : le pincement à deux doigts, le clavier virtuel qui pousse la page, les zones réservées de l'écran (`safe-area-inset`), et le moteur du navigateur, qui reste celui d'Orbit (Chromium) même pour un iPhone. Une page sans balise `viewport` s'affiche à la largeur de l'appareil, alors qu'un vrai téléphone la dézoome.

## Vue en grand

Le bouton d'agrandissement (ou la touche `F`) fait flotter le même cadre, sans le recharger, au centre sur un fond flouté, avec la zone d'éditeur maximisée. `Échap`, le bouton de fermeture ou un clic à côté la referment. `Échap` recule d'un cran à la fois : d'abord la sélection, puis le panneau de l'élément, puis la vue en grand.

## Liste des pages

La flèche au bout de la barre d'adresse ouvre la liste des pages du site : un clic y va. Orbit la dresse d'après les fichiers du projet (pages HTML d'un dossier, dossiers de routes de Next, Nuxt, Astro et SvelteKit, chemins déclarés à un routeur comme React Router ou Vue Router), et y ajoute sous « Visitées » les pages par lesquelles tu es passé depuis l'ouverture de la vue. Une route à paramètre (`/produit/[id]`) n'a pas d'adresse à proposer : elle n'apparaît qu'une fois visitée. Tu peux toujours taper une adresse à la main.

## Rester connecté

Ce que ton application garde dans le navigateur survit à la fermeture de la vue et d'Orbit : la session d'un compte, un panier, un thème. Tu te connectes une fois, tu retrouves ton compte à la prochaine ouverture.

- **Stockage du navigateur** (`localStorage`, IndexedDB) : chaque application a toujours la même adresse dans la vue, donc le même stockage.
- **Cookies** : Orbit les garde lui-même et les renvoie à ton application à chaque requête, y compris les cookies de session protégés (`HttpOnly`). Ils sont rangés par application dans `~/.orbit/preview/`. Pour repartir de zéro, déconnecte-toi dans ton application, ou supprime ce dossier.

Limite : seuls les cookies de l'application affichée sont gérés. Une API appelée sur une autre adresse (un autre port, un autre domaine) ne reçoit pas de cookie depuis la vue.

## Liens vers un autre site

La vue n'affiche que ton application. Un lien qui en sort (un autre site, `mailto:`, `tel:`, un lien « nouvel onglet », un `window.open`) s'ouvre dans le navigateur de ton ordinateur, ou dans ton application de messagerie. Un lien qui redonne l'adresse complète de ton application (`http://localhost:3000/contact`) reste dans la vue. Pendant la sélection d'un élément, un clic sur un lien sélectionne le lien au lieu de le suivre.

## Mini fenêtre

Le bouton de mini fenêtre (ou la touche `P`) sort la vue de la zone d'éditeur et la pose dans une petite fenêtre sans barre d'onglets, qui reste au-dessus des autres : tu la déplaces où tu veux, tu la redimensionnes, et tu gardes le site sous les yeux pendant que l'agent travaille dans Orbit. Sa barre ne garde que la navigation, l'adresse et la liste des pages. Le même bouton la ramène dans Orbit. Le passage recharge la page (même adresse).

## Pendant que l'agent travaille

Avec « Suivre Claude », chaque fichier que l'agent écrit s'ouvre dans l'éditeur. Quand une page occupe cet endroit (la vue vivante, une vidéo, un document), le fichier s'ouvre derrière elle : il a son onglet, la page reste devant. En vue en grand, rien ne s'ouvre.

## Dans une autre fenêtre

La vue vivante se déplace comme n'importe quel onglet : glisse-la hors de la fenêtre, ou clic droit sur l'onglet puis « Move into New Window », pour la poser sur un second écran. Le déplacement recharge la page : elle revient à l'adresse où tu étais, mais ce qui était saisi dans un formulaire et non enregistré est perdu, et le choix d'appareil revient à l'affichage libre.

## Erreurs de la page

L'inspecteur capte les erreurs que la page produit : exceptions, promesses rejetées, `console.error`, requêtes en échec (réponse en erreur ou échec réseau) et ressources introuvables, une fois chacune. Un compteur rouge apparaît dans la barre. Il ouvre la liste (les 30 dernières), et **Faire corriger par Claude** envoie tout à l'agent avec le fichier, la ligne et le début de la pile d'appels. **Effacer** vide la liste.

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Ouvrir la vue vivante | `Ctrl+Alt+V` | `⌥⌘V` |
| Envoyer la demande (champ de l'élément) | `Ctrl+Entrée` | `⌘⏎` |

Dans la vue : `S` active ou coupe la sélection, `F` ouvre ou ferme la vue en grand, `P` la mini fenêtre, `Échap` revient d'un cran.

## L'agent teste dans la vue vivante

L'agent se sert de la page affichée comme toi : il la lit, clique, remplit un formulaire, valide, change de page, et relit le résultat. Tu le vois faire dans la vue vivante. Il n'a pas besoin d'ouvrir un navigateur à lui.

Chaque geste se voit : un pointeur marqué « Agent » se déplace jusqu'à l'élément, marque l'appui, et le texte s'écrit lettre par lettre. Ce pointeur est seulement dessiné par-dessus la page : ce n'est pas ta souris, tu gardes la main sur ton ordinateur pendant que l'agent teste.

Un agent ouvert avant une mise à jour d'Orbit garde ses anciens outils : s'il répond qu'il ne peut pas piloter la vue vivante, ferme son terminal et rouvre-le (la discussion reprend), ou ouvre un nouveau chef d'équipe.

- `preview_look` : l'adresse, le titre, le texte visible, les erreurs de la page, et la liste numérotée de tout ce qui s'actionne (liens, boutons, champs, listes de choix). Un champ refusé par le navigateur est signalé avec son message.
- `preview_act` : `click`, `type` (avec `submit` pour valider par Entrée), `press` (une touche), `select` (un choix dans une liste), `scroll`, `go` (un chemin de l'application), `back`, `reload`, `wait`. L'élément visé se donne par son numéro, son texte ou un sélecteur CSS. La réponse est la page telle qu'elle est après l'action, y compris quand l'action a mené à une autre page.
- `preview_screenshot` : une image de l'adresse affichée, pour juger la mise en page. C'est une visite neuve de la même adresse par un navigateur sans fenêtre : sans connexion et sans ce qui a été saisi.

Limites : l'agent n'agit que sur ce qui tourne sur ta machine (serveur local, page du projet) ; une page d'un vrai site ouverte ici est seulement lue. Il ne dépose pas de fichier dans un champ fichier, ne glisse-dépose pas, et n'entre pas dans les cadres d'un autre site inclus dans la page (paiement, vidéo). Une fenêtre `alert` ou `confirm` ouverte par la page le bloque tant que tu ne l'as pas fermée.

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
