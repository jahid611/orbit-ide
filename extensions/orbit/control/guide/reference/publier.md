---
title: Publier une version
description: Comment une version d'Orbit est numérotée, fabriquée et proposée aux utilisateurs.
order: 5
icon: package
---

Cette page décrit le chemin d'une version, du numéro dans le code jusqu'à la notification chez l'utilisateur. Elle sert surtout à qui maintient Orbit ou un fork d'Orbit.

## Le numéro de version

La version d'Orbit est le champ `orbitVersion` du fichier `product.json`. Le champ `version` de `package.json` reste celui de Code - OSS, dont Orbit est issu : ce n'est pas la version d'Orbit.

## Fabriquer les installateurs

1. Monte `orbitVersion` dans `product.json` et pousse le changement.
2. Pousse l'étiquette `v<orbitVersion>`, par exemple `v1.0.1`. L'étiquette doit correspondre au numéro, sinon la fabrication s'arrête.
3. L'automatisation `.github/workflows/orbit-release.yml` construit alors :
   - l'installateur Windows `OrbitSetup-x64-<version>.exe` ;
   - l'archive macOS Apple Silicon `Orbit-mac-arm64-<version>.zip`.
4. Les deux fichiers sont attachés à une version GitHub créée en **brouillon**, avec le texte de `.github/orbit-release-notes.md`.
5. Essaie les fichiers, puis publie la version à la main.

> **Attention** Tant que la version est en brouillon, personne ne la voit et Orbit ne la propose pas. C'est voulu : un installateur se vérifie avant d'être proposé à tout le monde.

L'automatisation se lance aussi à la main, depuis l'onglet Actions du dépôt.

## Comment Orbit propose la mise à jour

Orbit n'a pas de serveur de mise à jour. Il lit la dernière version **publiée** sur GitHub, un peu après son démarrage puis toutes les six heures, et la compare à son propre `orbitVersion`. Le détail côté utilisateur est dans [Mises à jour](/docs/demarrer/mises-a-jour).

> **À savoir** Le nom du fichier Windows compte : Orbit cherche un fichier qui commence par `OrbitSetup-x64` et finit par `.exe`.

## Ce qui n'est pas signé

Orbit n'a pas de certificat de signature. Windows affiche donc l'écran SmartScreen à l'installation, et macOS demande d'autoriser l'application au premier lancement. La page [Installer Orbit](/docs/demarrer/installation) explique quoi faire.

## Voir aussi

- [Construire depuis les sources](/docs/reference/construire)
- [Mises à jour](/docs/demarrer/mises-a-jour)
