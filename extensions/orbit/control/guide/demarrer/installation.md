---
title: Installer Orbit
description: Télécharge Orbit pour Windows ou macOS, passe l'avertissement des applications non signées, ou construis-le depuis les sources sous Linux.
order: 1
icon: download
---

Orbit se télécharge depuis la page des versions de son dépôt GitHub. Il ne faut rien d'autre qu'un agent de code déjà installé et connecté : Claude Code, ou Codex pour ChatGPT. Les installateurs ne sont pas signés par un certificat, ce qui déclenche un avertissement du système au premier lancement.

## Avant de commencer

Orbit n'embarque pas l'agent : il lance le programme que tu as déjà sur ta machine, avec ton propre abonnement.

- **Claude** : Claude Code installé (`npm install -g @anthropic-ai/claude-code`), puis connecté en tapant `claude` une fois dans un terminal.
- **ChatGPT** : Codex installé (`npm install -g @openai/codex`), puis connecté avec `codex login`.

Un seul des deux suffit. Tu choisiras lequel Orbit utilise au [premier lancement](/docs/demarrer/premier-lancement).

## Télécharger

Va sur [https://github.com/jahid611/orbit-ide/releases/latest](https://github.com/jahid611/orbit-ide/releases/latest) et prends le fichier de ton système.

| Système | Fichier |
|---|---|
| Windows 10 / 11 (x64) | `OrbitSetup-x64-<version>.exe` |
| macOS (Apple Silicon) | `Orbit-mac-arm64-<version>.zip` |
| Linux | depuis les sources |

## Windows

1. Lance `OrbitSetup-x64-<version>.exe`.
2. Windows affiche l'écran « Windows a protégé votre ordinateur » (SmartScreen), parce que l'installateur n'est pas signé. Clique sur **Informations complémentaires**, puis sur **Exécuter quand même**.
3. Suis l'assistant d'installation, puis ouvre Orbit.

## macOS

1. Décompresse `Orbit-mac-arm64-<version>.zip` et glisse `Orbit.app` dans le dossier Applications.
2. Au premier lancement, macOS refuse d'ouvrir l'application non signée. Ouvre **Réglages Système › Confidentialité et sécurité** et clique sur **Ouvrir quand même**.
3. Autre méthode, depuis un terminal : `xattr -dr com.apple.quarantine /Applications/Orbit.app`, puis relance Orbit.

> **À savoir** Seule la version Apple Silicon est publiée pour macOS.

## Linux

Il n'y a pas de paquet pour Linux : Orbit se construit depuis les sources. Les étapes et les prérequis sont dans [Construire Orbit](/docs/reference/construire).

## Vérifier que ça marche

Ouvre Orbit : un écran de chargement animé s'affiche, puis la fenêtre apparaît et une question te demande avec quelle IA travailler. Si l'agent n'est pas trouvé, consulte le [dépannage](/docs/demarrer/depannage).

## Limites

- Les installateurs ne sont pas signés : l'avertissement de SmartScreen ou de macOS est normal et revient à chaque nouvelle version téléchargée à la main.
- Orbit n'est publié que pour Windows x64 et macOS Apple Silicon.

## Voir aussi

- [Premier lancement](/docs/demarrer/premier-lancement)
- [Mises à jour](/docs/demarrer/mises-a-jour)
- [Dépannage](/docs/demarrer/depannage)
