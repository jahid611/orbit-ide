---
title: L'agent et Unity
description: Les quinze outils du serveur MCP orbit-unity, avec lesquels l'agent voit le jeu, construit la scène et lit la console.
order: 6
icon: bot
---

Dans un projet Unity, les terminaux d'agent reçoivent un serveur MCP nommé `orbit-unity`. Il donne à l'agent des yeux (captures de la caméra du jeu ou de la vue Scène) et des mains (créer des objets, changer des valeurs, recompiler, lancer le jeu) dans l'éditeur ouvert.

## À quoi ça sert

Demande un gameplay complet (« un joueur qui saute », « des ennemis qui patrouillent ») : l'agent écrit les scripts C#, les branche dans la scène, puis vérifie le résultat à l'image et dans la console.

## Comment ça marche

- Orbit ne branche le serveur que si le dossier est un projet Unity (il contient `Assets` et `ProjectSettings/ProjectVersion.txt`). La configuration est écrite dans `~/.orbit/mcp/` et passée à l'agent au lancement.
- Le serveur tourne avec le programme d'Orbit lui-même : aucune installation de Node n'est nécessaire.
- Il parle au pont d'Orbit (`Packages/com.orbit.bridge`), dont l'adresse et le jeton sont lus dans `Library/OrbitBridge.json`. Si Unity est fermé ou en train de recompiler, l'outil répond que Unity n'est pas ouvert ou ne répond pas et qu'il faut réessayer dans quelques secondes (un appel attend 30 secondes au plus).
- Le fichier `CLAUDE.md` des projets créés par NovaGame rappelle ces règles à l'agent : scripts dans `Assets/Scripts`, entrées par Input System, `unity_refresh` après un script, `unity_console` pour vérifier, `unity_screenshot` pour regarder.

## Les outils

| Outil | Ce qu'il fait |
|---|---|
| `unity_state` | État de l'éditeur : scène ouverte, lecture en cours, compilation, objet sélectionné. |
| `unity_hierarchy` | Arbre complet des objets des scènes ouvertes (identifiant, nom, actif, type, enfants). |
| `unity_find` | Cherche des objets par nom (sous-chaîne, sans tenir compte de la casse) et renvoie leur identifiant et leur chemin. |
| `unity_inspect` | Composants d'un objet avec toutes leurs propriétés sérialisées, et le fichier C# de chaque script. |
| `unity_set_property` | Change une propriété sérialisée : nombre, booléen, texte, vecteur `"x,y,z"`, couleur `"r,g,b,a"` (0 à 1), angles `"x,y,z"` pour une rotation, index pour une énumération. L'indice de composant `-1` vise l'objet lui-même (`m_Name`, `m_IsActive`). |
| `unity_create_object` | Crée un objet : Cube, Sphere, Capsule, Cylinder, Plane, Quad ou Empty, avec une position locale et un parent facultatifs. |
| `unity_add_component` | Ajoute un composant par nom de type (Rigidbody, BoxCollider, Light, AudioSource, ou un script du projet déjà compilé). |
| `unity_remove_component` | Retire un composant (indice donné par `unity_inspect`). |
| `unity_delete_object` | Supprime un objet de la scène (annulable avec `Ctrl+Z` dans Unity). |
| `unity_screenshot` | Image de la caméra du jeu (`game`) ou de la vue Scène (`scene`), 960 par 540 pixels par défaut, en JPEG. L'agent voit l'image. |
| `unity_play` | Lance le jeu (mode Play). Les scripts sont rechargés : il vaut mieux attendre quelques secondes avant de lire la console. |
| `unity_stop` | Arrête le jeu. Les changements faits pendant la lecture sont perdus. |
| `unity_console` | Messages de la console (logs, avertissements, erreurs avec fichier et ligne), à partir d'un indice, avec une option « erreurs seulement ». |
| `unity_refresh` | Réimporte les fichiers modifiés et recompile les scripts C#. |
| `unity_save_scene` | Enregistre les scènes ouvertes. |

## Autorisations

Les outils `orbit-unity` demandent une autorisation à chaque appel. Choisir « ne plus demander » les autorise pour la session.

## Les demandes du studio

Quand tu envoies une demande depuis le [studio](/docs/novagame/studio), elle arrive avec l'objet sélectionné et rappelle à l'agent de vérifier avec `unity_screenshot` et, après un script, d'appeler `unity_refresh` puis de lire `unity_console`. Le bouton **Corriger avec Claude** de la console envoie l'erreur, son fichier, sa ligne et sa pile d'appels, et demande de vérifier ensuite que l'erreur a disparu.

## Avec ChatGPT

Orbit convertit ses fichiers de configuration MCP pour Codex, mais NovaGame n'a pas été vérifié avec ChatGPT : le fonctionnement d'`orbit-unity` avec Codex n'est pas confirmé.

## Limites

- Unity doit être ouvert sur le jeu pour que les outils répondent.
- Un script nouvellement écrit doit être compilé avant `unity_add_component` : appelle `unity_refresh` d'abord.
- `unity_screenshot` montre ce que dessine la caméra : pas d'interface en superposition d'écran.

## Voir aussi

- [Le studio](/docs/novagame/studio)
- [L'agent pilote Orbit](/docs/agents/agent-pilote-orbit)
- [Bac à sable et nouveau jeu](/docs/novagame/bac-a-sable)
