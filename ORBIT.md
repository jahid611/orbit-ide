# Orbit — contexte complet du projet

> Fichier de reprise : tout ce qu'il faut savoir pour continuer Orbit sur une autre machine (humain ou Claude Code).
> Dernière mise à jour : 2 octobre 2026.

## 1. Le produit en une phrase

**Orbit est un fork de VS Code (Code - OSS 1.140.0) construit autour de Claude Code qui tourne dans de vrais terminaux intégrés**, avec une identité visuelle spatiale (planète violette, lune menthe), un écran de chargement animé et une personnalisation poussée.

Ce n'est **pas** « un Cursor de plus » : l'IA n'est pas un chat greffé, c'est le vrai CLI `claude` dans des terminaux qu'on organise (onglets, splits, grille d'agents, worktrees), avec un IDE qui *sait* ce que fait chaque agent (statut en direct via les hooks de Claude Code).

## 2. Préférences et décisions de l'utilisateur (à respecter)

- **Tout en terminaux.** L'utilisateur a explicitement rejeté un chat webview séparé : « je veux que ce soit un clone du terminal… ça fonctionne que en terminaux exactement comme ici ».
  - Exception validée : la **« vue discussion »** est un *habillage* du MÊME terminal (même process `claude`, même session) — elle lit le transcript et renvoie la saisie dans le terminal. Bascule ⌥⌘T.
- **Facturation = abonnement Claude (Max)**, jamais le paiement à l'usage : Orbit retire `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` de l'environnement des terminaux Claude (réglage `orbit.claude.billing`).
- Claude ne doit pas produire d'**artefacts hébergés** : Orbit lance `claude --disallowedTools Artifact` + une consigne système « crée de vrais fichiers dans le dossier courant ».
- Langue de l'utilisateur : **français**. Interface du fork en anglais (strings VS Code), textes Orbit en français.
- Commits / PR : **aucune mention de Claude** (pas de `Co-Authored-By: Claude`, pas de « Generated with Claude Code »). Auteur : Jahid Sayad.
- Clavier Mac **AZERTY** : ne jamais activer `terminal.integrated.macOptionIsMeta` (casse `@ { [ |`).
- Visuels générés avec **Higgsfield** (logo, fond d'écran) — l'utilisateur aime les rendus « ultra beaux, vendeurs ».

## 3. Installation sur un nouveau PC (macOS arm64)

```bash
git clone https://github.com/jahid611/orbit-ide.git
cd orbit-ide
nvm install 24.18.0 && nvm use 24.18.0     # version exigée par .nvmrc
npm ci                                      # ~10-20 min, ~2 Go
npm run compile                             # ~1 min (tsgo)
./scripts/code.sh ~/un-projet               # lance Orbit en mode dev
```

Pré-requis : Xcode Command Line Tools, Python 3, git, **Claude Code installé et connecté** (`claude` puis `/login`).

### Construire l'application `Orbit.app`

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run gulp vscode-darwin-arm64-min   # ~2 min
# résultat : ../VSCode-darwin-arm64/Orbit.app
mv ../VSCode-darwin-arm64/Orbit.app /Applications/
codesign --force --deep -s - /Applications/Orbit.app    # signature ad-hoc
rm -rf out-vscode-min                                    # artefacts intermédiaires (régénérables)
```

Il faut ~1,5 Go libres pour un build (l'ancienne machine était à ~3-4 Go libres : surveiller le disque).

### Après une modification

- Extension Orbit seule : `npm run gulp compile-extension:orbit` puis « Developer: Restart Extension Host ».
- Cœur (src/) : `npm run compile` puis **redémarrer complètement** la fenêtre (un simple Reload garde parfois l'ancien JS en cache).
- Pour tester sans toucher au profil perso : `./scripts/code.sh ~/projet --user-data-dir ~/.orbit-shot/ud --extensions-dir ~/.orbit-shot/ext --remote-debugging-port=9447` (le chemin du profil doit rester court, sinon le socket IPC échoue ; éviter les ports déjà pris).

## 4. Architecture

### 4.1 Modifications du cœur (fork)

| Fichier | Rôle |
|---|---|
| `product.json` | Branding Orbit (nom, `applicationName: orbit`, dossiers `.orbit`, bundle `com.orbit.ide`), galerie **Open VSX** |
| `resources/darwin/code.icns`, `resources/linux/code.png` | Icône Orbit (logo Higgsfield) |
| `src/vs/workbench/contrib/orbit/browser/orbit.contribution.ts` | **Moteur UI Orbit** : réglages `orbit.ui.*` (panneaux flottants, arrondis, police UI, onglets pilule, interface épurée, CSS libre en direct, fond d'écran), retrait du splash, commandes internes `_orbit.setTerminalStatus` et `_orbit.renameTerminal` |
| `src/vs/workbench/contrib/orbit/browser/media/cosmos.jpg` | Fond d'écran spatial (Higgsfield, upscalé 4K → 2880 px) |
| `src/vs/code/electron-browser/workbench/workbench.html` (+ `-dev`) | **Écran de chargement animé** (CSS inline + logo en data URI) |
| `src/vs/workbench/workbench.common.main.ts` | Import de la contribution Orbit |
| `src/vs/workbench/browser/workbench.contribution.ts` | Défauts : panneau **à droite**, barre latérale secondaire masquée |
| `src/vs/workbench/browser/layout.ts` | Taille par défaut du panneau calculée selon sa position (38 % de largeur à droite) |
| `src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts` | `chat.disableAIFeatures` = true par défaut (Copilot masqué) |
| `src/vs/workbench/contrib/welcomeGettingStarted/...` | Page d'accueil : « New Claude Terminal », « Blank Terminal », sous-titre Orbit |
| `src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts` | `allowTransparency: true` (terminaux translucides sur le fond) |
| `build/gulpfile.extensions.ts`, `build/gulpfile.vscode.ts`, `build/next/resources.ts`, `package.json` | Compilation de l'extension orbit, build sans Copilot, copie de `cosmos.jpg` |
| `extensions/copilot/` | **Supprimée** (1,5 Go, remplacée par Claude Code) |

### 4.2 Extension intégrée `extensions/orbit`

| Fichier | Rôle |
|---|---|
| `src/extension.ts` | Activation, commandes, câblage |
| `src/config.ts` | Réglages `orbit.*`, construction de la ligne de commande `claude` (modèle, mode, consignes, `--settings` hooks, `--disallowedTools Artifact`), environnement (retrait des clés API et des variables `CLAUDE_CODE_*` héritées) |
| `src/claudeTerminals.ts` | Terminaux Claude : création (avec `--session-id` fixé), split, grille 2/3/4/6, worktree git isolé, reprise, diffusion à tous, envoi `@fichier#L1-10`, nouveau projet dans `~/Orbit/`, aperçu auto des fichiers créés, profil de terminal « Claude », barre d'état |
| `src/agentTracker.ts` | Installe `~/.orbit/hook.sh` + `~/.orbit/claude-settings.json` ; lit `~/.orbit/agent-events/<pid du shell>.jsonl` ; statut sur l'onglet (✦ tourne / 🔔 attend / ✓ fini) + notifications macOS |
| `src/chatView.ts` + `media/chat.{js,css}` | Vue discussion (panneau « Discussion ») : lit le transcript `~/.claude/projects/<projet>/<session>.jsonl`, envoie la saisie au terminal (bracketed paste), boutons d'autorisation (Entrée / « 2 » / Échap) |
| `src/sessions.ts` | Barre « Discussions » : liste des sessions du projet (titre `ai-title`), groupées par jour, recherche, renommage (stocké dans globalState + renomme l'onglet), reprise |
| `src/inlineEdit.ts` | ⌘K : édition inline via `claude -p --tools ''`, Accepter (⌘⏎) / Rejeter (⌘⌫) / Diff / Retoucher |
| `src/studio.ts` + `media/studio.{js,css}` | **Studio** (⌥⌘,) : thèmes, accent, fond d'écran, dispositions (Cursor / Antigravity / Zen / Classique), interface, éditeur, terminaux, Claude, CSS libre, export/import de profil |
| `themes/orbit-*.json` | 6 thèmes : **Cosmos** (défaut, translucide), Midnight, Aurora, Ember, Void, Paper |
| `media/markdown.js`, `media/base.css` | Rendu Markdown maison + styles communs des webviews |

### 4.3 Fonctionnement des hooks (statut des agents)

1. Chaque `claude` lancé par Orbit reçoit `--settings ~/.orbit/claude-settings.json`, qui déclare des hooks `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`.
2. Le hook `~/.orbit/hook.sh` remonte l'arbre des processus jusqu'à `claude`, prend le PID de son parent (= le shell du terminal = `Terminal.processId`) et ajoute l'événement JSON dans `~/.orbit/agent-events/<pid>.jsonl`.
3. L'extension surveille ce dossier, met à jour l'état de l'agent, l'onglet (via `_orbit.setTerminalStatus`), la vue discussion et la barre Discussions.

### 4.4 Raccourcis

| Raccourci | Action |
|---|---|
| ⌘L | Aller au terminal Claude (ou en lancer un) |
| ⌥⌘N | Nouveau terminal Claude (propose de créer/ouvrir un projet si aucun dossier) |
| ⌥⌘\ | Claude en split |
| ⌥⌘G | Grille d'agents |
| ⌥⌘A | Sélecteur d'agents (+ worktree, discussions, message à tous) |
| ⌥⌘T | Basculer vue terminal ⇄ vue discussion |
| ⌥⌘R | Rechercher une discussion récente |
| ⇧⌘L | Insérer `@fichier#Lx-y` dans le prompt Claude |
| ⌘K | Édition inline (masque les accords ⌘K X quand l'éditeur a le focus) |
| ⌥⌘, | Studio de personnalisation |

## 5. Identité visuelle (Higgsfield)

- **Logo** : `gpt_image_2_5`, 3 variantes, retenue n°2 (job `ae86d3a2-d616-4963-83e5-7794a3a43dc6`) — planète violette en verre, anneau orbital lumineux incliné, lune menthe, fond indigo. Version détourée : `brand/orbit-icon-1024.png`.
- **Fond d'écran Cosmos** : `gpt_image_2_5` 16:9, retenu n°2 (job `edce5947-763a-4305-a2c7-5be15d327245`), upscalé 4K (job `47c11de5-e23a-460d-94fe-31aa1ee4c8a6`). Planète bas-gauche, lune haut-droite, centre sombre pour la lisibilité.
- Palette : violet `#8b7bff`, menthe `#5eead4`, fond `#0a0918`.
- Écran de chargement : étoiles qui scintillent, planète qui émerge du flou en tournant, halo, deux anneaux orbitaux avec lunes, mot « Orbit » en dégradé, barre de chargement ; reste au moins ~3 s puis fondu (`orbit.ui.splashScreen` pour le couper).

## 6. Historique des décisions

1. Fork de `microsoft/vscode` tag `1.140.0` ; Copilot retiré ; branding Orbit ; galerie Open VSX.
2. Première version avec un **chat webview** piloté par `claude -p --input-format stream-json` → **rejetée** par l'utilisateur (« pas un chat, des terminaux »).
3. Pivot : vrais terminaux `claude`, panneau à droite, grille/splits/worktrees, Studio, thèmes.
4. Logo + splash animé (Higgsfield).
5. Correctifs : projet visible (création dans `~/Orbit/`), aperçu des fichiers créés, outil Artifact interdit.
6. Statut des agents via hooks, vue discussion (habillage du terminal), Discussions récentes, thème Cosmos + fond Higgsfield.

## 7. Pistes suivantes (idées proposées, pas encore faites)

- **Traces en direct** : surligner dans l'explorateur/l'éditeur les fichiers que chaque agent lit/modifie (données déjà dispo via `PreToolUse`).
- **Machine à remonter le temps** : snapshot git à chaque prompt (`UserPromptSubmit`) + frise de retour arrière.
- **Aperçu auto** : détecter `localhost:XXXX` dans un terminal et ouvrir un navigateur intégré qui se recharge.
- **Vue « Orbite »** : carte animée des agents (planètes) avec état, fichiers, coût.
- **Chef d'orchestre** : découper une tâche en N agents sur des worktrees puis fusionner.
- Jauge de l'abonnement (fenêtre 5 h), marché de skills/MCP/plugins, modèles de projets, dictée vocale, pack de langue français.

## 8. Problèmes connus / pièges

- ⌘K en édition inline masque les accords VS Code ⌘K X quand l'éditeur a le focus (comme Cursor).
- Les permissions de Claude dans la vue discussion envoient des touches au TUI (Entrée / « 2 » / Échap) : pas testé avec une vraie demande d'autorisation (la config de l'utilisateur est en « bypass permissions »).
- Un nouveau terminal Claude peut apparaître en double après un rechargement si les terminaux persistants reviennent tard (délai de 2,5 s dans `autoStart`).
- Le mode `acceptEdits` laisse Claude Code créer des dossiers (`mkdir`) sans demander — comportement du CLI.
- `vscode-file://` met parfois en cache l'ancien JS du cœur : redémarrer la fenêtre, pas juste Reload.
- Ne pas mettre de chemin long pour `--user-data-dir` (socket IPC trop long).

## 9. Où sont les données à l'exécution

- `~/.orbit/` : `hook.sh`, `claude-settings.json`, `agent-events/` (créés par l'extension, régénérés automatiquement)
- `~/.orbit-dev/` (dev) / `~/.orbit/` (app) : extensions utilisateur ; profil dans `~/Library/Application Support/Orbit`
- `~/.claude/projects/<chemin-encodé>/<session>.jsonl` : transcripts Claude Code (lus par la vue discussion et la barre Discussions)
- `~/Orbit/` : projets créés via « Nouveau projet »
