# Cadrer Claude : règles et autorisations

## Règles du projet

`CLAUDE.md`, à la racine, est lu par Claude au début de chaque session : stack, conventions, choses à ne jamais faire. C'est le meilleur endroit pour une consigne durable, plutôt que de la répéter à chaque message.

## Mode d'autorisation (`orbit.claude.permissionMode`)

| Mode | Ce que Claude fait sans demander |
|---|---|
| Par défaut | Rien de sensible : il demande avant de modifier ou d'exécuter |
| Accepter les modifications | Modifie les fichiers ; demande pour les commandes |
| Plan | Explore et propose un plan avant d'agir |
| Auto | Agit seul, avec un contrôle de sécurité automatique |

**Pièges**

- En « Accepter les modifications », Claude crée aussi des dossiers sans demander.
- Le mode se choisit au lancement du terminal ; pour un terminal déjà ouvert, change-le dans Claude Code (Maj+Tab).
- Orbit interdit à Claude l'outil qui publie des pages hébergées : son travail arrive toujours sous forme de vrais fichiers dans ton projet.
