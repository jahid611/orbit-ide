---
title: Construire depuis les sources
description: Compiler Orbit toi-même, le lancer en développement et fabriquer l'application.
order: 4
icon: hammer
---

Orbit est un fork de Code - OSS 1.140 : il se construit comme lui. Cette page sert si tu es sous Linux, si tu veux lire ou modifier le code, ou si tu préfères ne pas lancer un installateur non signé.

## Ce qu'il te faut

- **Git**.
- **Node 24.18.0**, la version exacte demandée par le fichier `.nvmrc` du dépôt. Une archive portable suffit : pas besoin de remplacer le Node du système.
- **Python 3**.
- Un compilateur C++ : les Xcode Command Line Tools sur macOS ; sur Windows, Visual Studio Build Tools 2022 avec la charge « C++ » **et** le composant « Bibliothèques MSVC avec atténuation Spectre ». Sans ce composant, les modules natifs ne compilent pas.
- **Claude Code** ou **Codex** installé et connecté, pour avoir un agent dans les terminaux.

Compte une vingtaine de minutes et environ 2 Go pour l'installation des dépendances.

## Lancer Orbit en développement

```bash
git clone https://github.com/jahid611/orbit-ide.git
cd orbit-ide
nvm install 24.18.0 && nvm use 24.18.0
npm ci
npm run compile
./scripts/code.sh ~/un-projet
```

Sous Windows, la dernière ligne devient `.\scripts\code.bat C:\un-projet`.

> **À savoir** Lancé depuis ses sources, Orbit ne cherche pas de mise à jour : il se met à jour avec `git pull`.

## Après une modification

| Ce que tu as changé | Ce qu'il faut relancer |
|---|---|
| L'extension Orbit (`extensions/orbit`) | `npm run gulp compile-extension:orbit`, puis « Developer: Restart Extension Host » |
| StarCapture ou NovaGame | `npm run gulp compile-extension:starcapture` ou `compile-extension:novagame` |
| Le cœur (`src/`) | `npm run compile`, puis ferme et rouvre complètement la fenêtre |

> **Attention** Après un changement du cœur, un simple rechargement de la fenêtre garde parfois l'ancien code en mémoire. Ferme la fenêtre et relance Orbit.

## Fabriquer l'application

```bash
# macOS Apple Silicon : produit ../VSCode-darwin-arm64/Orbit.app
NODE_OPTIONS=--max-old-space-size=8192 npm run gulp vscode-darwin-arm64-min

# Windows x64 : produit ..\VSCode-win32-x64\Orbit.exe
npm run gulp vscode-win32-x64-min
```

Sous Windows, la toute dernière étape cherche à signer les exécutables et échoue sans certificat : l'application est complète avant elle. Sous macOS, signe l'application « ad hoc » pour qu'elle se lance sur Apple Silicon :

```bash
codesign --force --deep -s - ../VSCode-darwin-arm64/Orbit.app
```

La construction demande plusieurs minutes et beaucoup de mémoire (environ 8 Go) : ferme ce qui est lourd avant de la lancer.

## Où est le code d'Orbit

| Dossier | Contenu |
|---|---|
| `extensions/orbit` | Presque tout Orbit : terminaux d'agents, vues, pages, outils |
| `extensions/starcapture` | L'éditeur vidéo |
| `extensions/novagame` | L'atelier de jeux Unity |
| `src/vs/workbench/contrib/orbit` | Les réglages d'interface, le fond d'écran, l'écran de chargement |
| `ORBIT.md` | Le contexte complet du projet, tenu à jour à chaque changement |

## Voir aussi

- [Publier une version](/docs/reference/publier)
- [Installer Orbit](/docs/demarrer/installation)
- [Licence](/docs/reference/licence)
