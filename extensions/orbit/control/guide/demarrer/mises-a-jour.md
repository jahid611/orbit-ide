---
title: Mises à jour
description: Orbit cherche lui-même les nouvelles versions sur GitHub ; sous Windows il peut les installer à la fermeture, ailleurs il ouvre la page de téléchargement.
order: 6
icon: download
---

Orbit n'a pas de serveur de mise à jour. Il regarde la dernière version publiée sur la page des versions de son dépôt GitHub, la compare à la sienne, et te prévient si une plus récente existe.

## Comment ça marche

Orbit vérifie 45 secondes après son démarrage, puis toutes les 6 heures. Quand une version plus récente existe, un message l'annonce une seule fois par version : « Orbit X est disponible (tu as la Y) ». Les boutons dépendent du système.

| Système | Boutons |
|---|---|
| Windows | **Mettre à jour**, **Voir les nouveautés**, **Plus tard** |
| macOS et Linux | **Télécharger**, **Voir les nouveautés**, **Plus tard** |

- **Voir les nouveautés** ouvre la page de la version. L'annonce pourra se répéter au prochain contrôle.
- **Plus tard** repousse l'annonce jusqu'à la version suivante, ou jusqu'à ce que tu lances la vérification toi-même.

### Windows : installation à la fermeture

1. **Mettre à jour** télécharge l'installateur (`OrbitSetup-x64-<version>.exe`) avec une barre de progression que tu peux annuler. Un fichier incomplet est refusé.
2. Un message annonce que la nouvelle version s'installera dès qu'Orbit sera fermé, puis qu'Orbit se rouvrira. Les agents en cours s'arrêtent à la fermeture.
3. Un petit programme PowerShell invisible attend que toutes les fenêtres d'Orbit soient fermées, installe sans poser de question, puis rouvre Orbit. Tu peux fermer Orbit tout de suite avec **Fermer Orbit et installer**, ou plus tard à ta convenance.

### macOS et Linux : téléchargement manuel

L'application n'est pas signée, donc elle ne peut pas se remplacer elle-même. **Télécharger** ouvre la page des versions ; tu installes comme la première fois (voir [Installer Orbit](/docs/demarrer/installation)).

## Vérifier à la main

La commande « Rechercher une mise à jour d'Orbit » (`orbit.update.check`) lance la vérification tout de suite et dit chaque résultat : « Orbit est à jour (version X) », la nouveauté trouvée, ou « Impossible de vérifier les mises à jour » avec la raison (par exemple une réponse de GitHub en erreur).

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.update.mode` | `notify` | `notify` : vérifie et annonce. `off` : plus de vérification automatique ; la commande manuelle fonctionne toujours. |

## Limites

- Lancé depuis les sources, Orbit ne vérifie rien : la commande répond que cet Orbit se met à jour avec git.
- La mise à jour automatique sous Windows n'a jamais été exercée de bout en bout tant qu'une deuxième version n'a pas été publiée. Si quelque chose ne se passe pas comme décrit, télécharge l'installateur à la main sur la page des versions.
- Les nouvelles versions restent non signées : l'avertissement de SmartScreen ou de macOS peut réapparaître lors d'un téléchargement manuel.

## Voir aussi

- [Installer Orbit](/docs/demarrer/installation)
- [Dépannage](/docs/demarrer/depannage)
