---
title: Higgsfield
description: Génère des images, des vidéos, des modèles 3D et des sons avec ton compte Higgsfield, directement dans les fichiers du projet.
order: 5
icon: sparkles
---

Le studio Higgsfield est une page d'Orbit qui compose ta demande (type de création, format, quantité, style, image de référence) et la confie à l'agent. L'agent génère avec les outils Higgsfield, télécharge les résultats dans le projet et la galerie de la page les affiche à mesure que les fichiers arrivent. Ce qui est généré est tout de suite un fichier du projet, prêt à servir dans le code, un montage ou un jeu.

## D'où viennent les accès

Orbit n'appelle jamais Higgsfield lui-même : il n'y a ni clé à gérer ni serveur d'Orbit. Le studio passe par le **connecteur Higgsfield** que ton outil d'agent possède déjà (la ligne « Higgsfield … Connected » de `claude mcp list`, y compris celui qui vient de ton compte claude.ai). Sinon, le bouton de connexion de la page ajoute le serveur (`claude mcp add --transport http higgsfield https://mcp.higgsfield.ai/mcp`) puis ouvre la page de connexion de Higgsfield, que tu valides dans le navigateur avec ton compte. La page vérifie la connexion toutes les quelques secondes et avance toute seule.

## Comment l'utiliser

1. Ouvre le studio avec `Ctrl+Alt+H` (`⌥⌘H` sur macOS), avec le bouton Higgsfield de la barre du terminal, ou par la liste « Outils du projet » (`Ctrl+Alt+K`).
2. Choisis le type : image, vidéo, modèle 3D ou audio (voix, musique, bruitage).
3. Écris ta demande, règle le format (sauf pour l'audio et la 3D), la quantité (de 1 à 4), éventuellement un style et une image de référence prise dans le projet.
4. Envoie. La page affiche une carte d'attente par création ; elle se remplace par le fichier quand il arrive, avec une animation.

La consigne envoyée à l'agent lui demande de choisir le modèle le mieux adapté, de lancer la génération, d'attendre la fin, de télécharger chaque résultat dans le dossier du studio, de tenir à jour `higgsfield.json` (prompt, modèle, type, date) et de répondre en une phrase. Si les crédits manquent, il le dit avec le solde, sans rien lancer.

### Depuis l'explorateur

Un clic droit sur une image `.png`, `.jpg`, `.jpeg` ou `.webp` propose « Animer avec Higgsfield » et « Créer des variantes avec Higgsfield » : le studio s'ouvre avec cette image en référence.

### Actions sur un fichier de la galerie

Faire utiliser le fichier par l'agent, insérer son chemin dans le fichier ouvert, copier le chemin, l'animer, en créer des variantes, l'ouvrir ou l'ouvrir dans StarCapture.

### Le solde

Le solde de crédits s'affiche dans l'en-tête. Orbit le demande par un appel court de l'agent, sans interface, limité à l'outil `balance` ; il est relancé au plus une fois par minute et après chaque fichier arrivé.

## Si tu demandes du Higgsfield dans le terminal

La consigne système d'Orbit dit à l'agent de passer par ce studio : il ouvre la vue, génère, range les fichiers dans le dossier du projet et les ajoute à `higgsfield.json`.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.higgsfield.folder` | `assets/higgsfield` | Dossier du projet où arrivent les fichiers générés. |
| `orbit.higgsfield.enabled` | `true` | Désactivé (par le bouton de déconnexion du studio), le studio est fermé et les agents lancés ensuite n'ont plus les outils Higgsfield, même si le compte reste relié à claude.ai. |
| `orbit.higgsfield.simulateDisconnected` | `false` | Mode test : le studio fait comme si le compte n'était pas relié, pour essayer le parcours de connexion d'un nouvel utilisateur. |

## Se déconnecter

Pour un serveur ajouté par Orbit, le bouton de déconnexion le déconnecte vraiment. Si Higgsfield vient de ton compte claude.ai, Orbit ne peut pas le retirer de là : il le coupe seulement dans Orbit (réglage `orbit.higgsfield.enabled`). Pour le retirer partout, c'est dans les réglages des connecteurs de claude.ai. Les agents déjà ouverts gardent les outils jusqu'à leur fermeture. Tes créations déjà dans le projet restent.

## Avec ChatGPT

Le serveur est ajouté avec `codex mcp add higgsfield --url …` et la connexion se fait avec la commande de connexion de Codex. Le solde est alors demandé à Codex par un court appel en lecture seule.

## Limites

- La génération réelle est récente et peu éprouvée : elle n'a pas été essayée avec un compte disposant de crédits (le compte d'essai n'en avait presque plus).
- Les parcours de connexion n'ont pas été rejoués sur une machine sans compte déjà connecté.
- La connexion Higgsfield n'a pas été testée avec ChatGPT.
- Les générations consomment les crédits de ton compte Higgsfield.

## Voir aussi

- [Magasin de compétences](/docs/outils/magasin)
- [StarCapture : présentation](/docs/starcapture/presentation)
- [L'agent pilote Orbit](/docs/agents/agent-pilote-orbit)
