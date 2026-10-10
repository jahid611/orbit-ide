---
title: Installer Unity
description: NovaGame détecte Unity, guide l'installation d'Unity Hub et de l'éditeur s'ils manquent, puis reprend ce que tu avais demandé.
order: 2
icon: download
---

NovaGame a besoin de l'éditeur Unity. S'il est déjà sur ta machine, il le trouve tout seul. Sinon, la première action qui en a besoin (bac à sable, nouveau jeu, lancer Unity) démarre une installation guidée, puis reprend là où tu en étais dès que l'éditeur apparaît.

## À quoi ça sert

Tu n'as pas à savoir où Unity s'installe ni à relancer ta demande : NovaGame surveille l'installation et continue seul.

## Comment l'utiliser

1. Clique une action de l'onglet NovaGame, par exemple **Ouvrir le bac à sable**. Si aucun éditeur n'est trouvé, une fenêtre « NovaGame a besoin de Unity » s'ouvre. Tu peux aussi la déclencher avec **Installer et configurer Unity**.
2. Choisis une réponse :
   - **Installer Unity Hub** (Unity Hub est absent) : NovaGame l'installe, puis l'ouvre ;
   - **Ouvrir Unity Hub** (le Hub est là mais sans éditeur) ;
   - **J'ai déjà Unity…** : désigne toi-même l'exécutable de l'éditeur (`Unity.exe` sous Windows) ; il est enregistré dans `novagame.unityPath`.
3. Dans le Hub, ouvre **Installs**, **Install Editor**, et prends la version recommandée (LTS).
4. NovaGame vérifie toutes les quatre secondes (pendant une heure au plus). Dès que l'éditeur existe, il le retient, affiche « Unity … détecté : NovaGame est configuré » et relance ta demande d'origine.

## Comment Unity Hub est installé

| Système | Méthode |
|---|---|
| Windows | `winget install -e --id Unity.UnityHub` dans un terminal PowerShell visible, que tu peux suivre. |
| macOS | `brew install --cask unity-hub`, avec la page de téléchargement de Unity en repli. |
| Linux | La page de téléchargement d'Unity s'ouvre dans ton navigateur. |

## Comment l'éditeur est trouvé

NovaGame cherche, du plus récent au plus ancien :

- le chemin du réglage `novagame.unityPath` ;
- le dossier d'installation secondaire d'Unity Hub (`secondaryInstallPath.json`) ;
- les dossiers habituels d'Unity Hub : `Unity/Hub/Editor` dans `Program Files`, `Program Files (x86)` ou `AppData\Local\Programs` sous Windows, `/Applications/Unity/Hub/Editor` sous macOS, `~/Unity/Hub/Editor` sous Linux ;
- les éditeurs ajoutés au Hub avec « Locate » (`editors-v2.json`).

Ce qui est trouvé est gardé en mémoire : pas de nouvelle détection tant que l'éditeur est au même endroit. L'état se lit dans le groupe **Configuration** de l'onglet : Unity (avec sa version), Unity Hub, bac à sable, pont Orbit et éditeur ouvert ou non.

## Version du projet et version installée

Quand tu lances Unity sur un jeu fait avec une autre version que celles installées, NovaGame te prévient. Ouvrir le jeu avec une autre version **convertit le projet** : fais une copie avant si le jeu compte. Si Unity Hub est présent, tu peux aussi choisir d'installer la bonne version.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `novagame.unityPath` | vide | Chemin de l'éditeur Unity (`Unity.exe`). Vide : NovaGame le trouve seul (Unity Hub, installations classiques). |

## Limites

- Les licences et les comptes Unity restent ceux d'Unity : c'est Unity Hub qui te les demande.
- Si tu fermes la fenêtre sans choisir, la demande d'origine est abandonnée.
- L'installation guidée n'ouvre Unity Hub que si tu le demandes ; NovaGame ne choisit pas la version de l'éditeur à ta place.

## Voir aussi

- [Présentation](/docs/novagame/presentation)
- [Bac à sable et nouveau jeu](/docs/novagame/bac-a-sable)
- [Le studio](/docs/novagame/studio)
