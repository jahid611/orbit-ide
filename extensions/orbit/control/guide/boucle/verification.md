---
title: Vérification automatique
description: Orbit lance les contrôles du projet à la fin de chaque tour de l'agent et lui renvoie ceux qui échouent.
order: 1
icon: shield-check
---

Quand l'agent a écrit des fichiers pendant un tour, Orbit lance les contrôles de ton projet (types, lint, et ceux que tu définis) dès que le tour est fini. Si l'un échoue, la sortie de la commande peut retourner à l'agent, qui corrige sans que tu aies à copier quoi que ce soit.

## À quoi ça sert

Tu n'as plus à jouer le contrôleur entre deux tours. Le résultat apparaît dans la barre d'état : **Vérifié**, ou **N contrôles en échec** sur fond rouge. Les contrôles ne tournent qu'après un tour où l'agent a vraiment écrit un fichier.

## Comment l'utiliser

1. Laisse l'agent travailler. À la fin de son tour, Orbit lance les contrôles.
2. Si un contrôle échoue, une notification propose **Renvoyer à Claude** ou **Voir le détail** (la sortie complète est dans le canal « Orbit · Vérification »).
3. Clique l'indicateur de la barre d'état pour régler le comportement, relancer les contrôles ou ouvrir le détail.

Pour lancer les contrôles sans attendre un tour, utilise la commande **Vérifier le projet maintenant (types, lint, tests)** dans la palette. Un échec lancé à la main propose aussi de renvoyer la sortie à l'agent, mais n'envoie jamais rien tout seul.

## Les trois modes

| Mode | Effet |
|---|---|
| `notify` (défaut) | Orbit prévient et te demande avant de renvoyer les échecs à l'agent. |
| `auto` | Orbit renvoie les échecs à l'agent sans demander, deux fois au plus par message que tu envoies. Au-delà, il te demande. |
| `off` | Aucun contrôle automatique. |

Le message renvoyé commence par `[Vérification automatique d'Orbit]`. C'est ce qui le distingue d'un message de toi : un message de toi remet le compteur de renvois à zéro, celui-là non. Il demande à l'agent de corriger la cause (pas le contrôle), de relancer le contrôle lui-même, puis de dire ce qui n'allait pas.

## Quels contrôles sont lancés

Si le fichier `.orbit/checks.json` existe, il remplace toute détection. Sinon Orbit regarde ce que le projet contient :

- un script `typecheck`, `type-check`, `check-types`, `tsc` ou `types` dans `package.json`, sinon `npx tsc --noEmit` si le projet a un `tsconfig.json` et la dépendance `typescript` ;
- le script `lint`, sauf s'il contient `--fix` ou `--write` (un lint qui réécrit les fichiers se battrait avec l'agent) ;
- `cargo check --message-format short` si `Cargo.toml` existe ;
- `go vet ./...` si `go.mod` existe ;
- `ruff check .` si `pyproject.toml` contient une section `[tool.ruff`.

Le gestionnaire de paquets est choisi d'après le fichier de verrouillage (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock` ou `bun.lockb`, sinon `npm`).

Pour choisir toi-même, lance **Choisir les contrôles du projet (.orbit/checks.json)** : Orbit écrit les contrôles détectés dans ce fichier (ou un exemple `npm test` s'il n'en trouve aucun) et l'ouvre. Chaque entrée a un `name`, une `command` et, en option, un `cwd` relatif au projet. C'est aussi là que tu ajoutes tes tests, qui ne sont pas détectés tout seuls.

```json
[
	{ "name": "Types", "command": "npm run typecheck" },
	{ "name": "Tests", "command": "npm test" }
]
```

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.verify.mode` | `notify` | `notify`, `auto` ou `off`, comme ci-dessus. |
| `orbit.verify.timeoutSeconds` | `180` | Durée maximale d'un contrôle avant qu'Orbit l'arrête. Un contrôle arrêté compte comme un échec. |

## Avec ChatGPT

Le principe est le même. Orbit reconnaît les fichiers écrits par l'agent d'après les journaux de session de Codex, qu'il traduit dans la forme des événements de Claude Code.

## Limites

- Un nouveau lancement pour le même projet remplace celui qui tourne encore.
- Seule la fin de la sortie est envoyée à l'agent (6 000 caractères environ, avec le début de la commande en tête).
- Les contrôles tournent sans couleur et avec `CI=1` dans l'environnement.

## Voir aussi

- [Relecture visuelle](/docs/boucle/relecture-visuelle)
- [Problèmes vers l'agent](/docs/boucle/problemes)
- [Mode auto en un clic](/docs/agents/mode-auto)
