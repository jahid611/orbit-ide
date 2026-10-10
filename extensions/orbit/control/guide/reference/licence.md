---
title: Licence et crédits
description: Orbit est libre, sous licence MIT, et s'appuie sur le travail d'autres projets.
order: 6
icon: scale
---

Orbit est distribué sous licence **MIT**. Tu peux l'utiliser, le lire, le modifier et le redistribuer, y compris dans un cadre commercial, à condition de garder la mention de licence.

## D'où vient Orbit

Orbit est un fork de **Code - OSS** 1.140, le projet libre de Microsoft dont est issu Visual Studio Code. Le code d'origine reste sous sa licence MIT et sous le copyright de Microsoft Corporation ; les ajouts d'Orbit sont publiés sous la même licence.

Orbit n'est affilié ni à Microsoft, ni à Anthropic, ni à OpenAI. « Visual Studio Code », « Claude » et « ChatGPT » sont des marques de leurs propriétaires respectifs.

## Les extensions

Orbit utilise la galerie **Open VSX** pour les extensions, et non la galerie de Microsoft, dont les conditions réservent l'usage à Visual Studio Code.

## Ce qu'Orbit embarque

| Projet | Sert à | Licence |
|---|---|---|
| pdf.js (Mozilla) | Lire les PDF | Apache 2.0 |
| PptxViewJS, JSZip, Chart.js | Lire les présentations | MIT |
| qrcode-generator (Kazuhiko Arase) | Le code à scanner de la page téléphone | MIT |
| Devicon | Les logos des langages dans le thème d'icônes | MIT |
| Simple Icons | Le logo de Claude | CC0 |
| whisper.cpp | La transcription dans StarCapture | MIT |

StarCapture s'appuie aussi sur **ffmpeg**, qu'il trouve sur ta machine : Orbit ne le redistribue pas.

## Tes données et tes comptes

Orbit n'a pas de serveur à lui. L'agent tourne sur ta machine avec ton propre abonnement, et les pages d'outils passent par tes propres comptes. Le détail est dans [Abonnement et facturation](/docs/demarrer/abonnement).

## Voir aussi

- [Construire depuis les sources](/docs/reference/construire)
- [Le code source sur GitHub](https://github.com/jahid611/orbit-ide)
