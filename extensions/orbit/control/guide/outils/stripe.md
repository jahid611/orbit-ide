---
title: Stripe
description: Consulte ton compte Stripe, crée un produit avec son prix et son lien de paiement, et fais brancher le paiement par l'agent.
order: 3
icon: credit-card
---

La page Stripe sert à préparer les paiements d'un projet. Elle montre le solde, le catalogue et les paiements récents de ton compte, crée un produit, son prix et un lien de paiement en une seule fois, et donne à l'agent ce qu'il faut pour brancher le paiement dans le code.

## D'où viennent les accès

Orbit n'a pas de serveur à lui. Il appelle l'API de Stripe directement, avec une **clé secrète** que tu colles une fois dans la page. Elle est gardée dans le stockage de secrets d'Orbit (le trousseau du système) et écrite dans `.env.local` pour le code serveur du projet. L'agent ne la voit pas : il reçoit seulement des identifiants et des noms de variables.

Le bouton de la page ouvre la page des clés d'API de ton tableau de bord Stripe en mode test. Une clé de test commence par `sk_test_`, une clé réelle par `sk_live_` ; les clés restreintes (`rk_test_`, `rk_live_`) sont aussi acceptées. Tu peux joindre ta clé publiable (`pk_…`) : elle est écrite avec le préfixe de ton framework.

## Comment l'utiliser

1. Ouvre la page par la commande `orbit.stripe.show`, ou par la liste « Outils du projet » (`Ctrl+Alt+K`).
2. Colle ta clé secrète. Orbit vérifie qu'elle est acceptée en lisant le solde, puis écrit `STRIPE_SECRET_KEY` dans `.env.local` (et la clé publiable si tu l'as donnée). Le fichier est ajouté au `.gitignore` s'il ne l'était pas.
3. La page affiche le compte, le solde disponible et en attente, les produits actifs avec leur prix et leur lien de paiement, et les paiements récents.
4. Pour vendre quelque chose, renseigne un nom, un prix (au moins 0,50), une devise (EUR, USD, GBP, CHF ou CAD) et, si tu veux, un abonnement mensuel ou annuel. Orbit crée le produit, son prix et un lien de paiement, puis copie le lien dans le presse-papiers. Un lien peut aussi être créé pour un prix existant.

## Brancher le paiement

Le bouton « Brancher le paiement » envoie à l'agent le mode (essai ou réel), les noms des variables, la liste des produits avec leurs identifiants de produit et de prix, et une consigne. Par défaut, celle-ci demande Stripe Checkout : une route serveur qui crée la session de paiement, le bouton qui y mène, les pages de succès et d'annulation, et le webhook qui confirme le paiement avec vérification de la signature. Tu peux la remplacer par ta propre demande. En mode essai, la consigne rappelle la carte de test `4242 4242 4242 4242`.

## Clé réelle

Une clé réelle est acceptée, mais tout ce qu'elle créerait est visible par tes vrais clients et peut encaisser de vrais paiements. Orbit demande donc une confirmation avant chaque création. Pour un projet en construction, une clé de test est ce qu'il te faut.

## Se déconnecter

Le bouton de déconnexion retire la clé d'Orbit. Celle écrite dans `.env.local` reste, pour que ton projet continue de fonctionner.

## Avec ChatGPT

Le fonctionnement de la page ne change pas : c'est Orbit qui parle à Stripe. Seule la consigne de branchement part vers ChatGPT. Sa clé dans `.env.local` n'est protégée que par la consigne (voir [Variables d'environnement](/docs/outils/variables-d-environnement)).

## Limites

- Cette fonction est récente et peu éprouvée : elle n'a pas été essayée avec un vrai compte Stripe.
- La page crée des produits, des prix et des liens de paiement ; elle ne gère ni les remboursements ni les clients.
- Le connecteur Stripe du [Magasin de compétences](/docs/outils/magasin) est une autre voie, indépendante de cette page.

## Voir aussi

- [Variables d'environnement](/docs/outils/variables-d-environnement)
- [Supabase](/docs/outils/supabase)
- [Vercel](/docs/outils/vercel)
