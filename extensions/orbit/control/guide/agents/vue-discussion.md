---
title: Vue discussion
description: Affiche la conversation de l'agent comme un chat, sans quitter le terminal qui la fait tourner.
order: 5
icon: message-square
---

La vue discussion est un habillage du terminal de l'agent : elle affiche la conversation sous forme de chat et envoie ce que tu écris dans ce même terminal. Ce n'est pas un second agent. C'est le même processus et la même session, donc tu peux commencer dans une vue et finir dans l'autre.

![Vue discussion](/captures/tuto-discussion.png)

## À quoi ça sert

- Lire une longue réponse, ses blocs de code et les outils utilisés plus confortablement que dans un terminal.
- Répondre aux demandes d'autorisation avec des boutons.
- Garder le terminal complet sous la main pour tout ce qui lui est propre.

## Comment l'utiliser

1. Bascule avec `Ctrl+Alt+T`, ou avec le bouton de la barre du panneau. La vue s'appelle « Discussion » et se trouve dans le panneau.
2. Écris dans la zone de saisie : le texte est envoyé au terminal de l'agent affiché.
3. Choisis l'agent affiché dans la liste en haut de la vue, ou lance-en un nouveau.
4. Pour revenir au terminal, bascule à nouveau.

La vue suit le terminal actif. Elle lit la conversation enregistrée par l'agent et se met à jour à mesure qu'elle grandit. Les appels d'outils sont résumés en une ligne (« Lit un fichier », « Modifie un fichier », une commande) avec leur résultat.

Les boutons **vue**, **modèle** et **utilisation** sont au même endroit dans les deux vues, à droite de la barre, juste avant le menu « … ». Le menu propose aussi de renommer la discussion, de la rechercher et d'ouvrir la grille d'agents.

### Autorisations

Quand l'agent attend ton accord, la vue affiche l'action demandée avec des boutons. Ils envoient des touches au terminal : Entrée pour accepter, `2` puis Entrée pour « toujours », Échap pour refuser. Un bouton d'interruption envoie Échap.

> **Attention** Ces boutons n'ont pas été essayés avec une vraie demande d'autorisation. En cas de doute, repasse en vue terminal pour répondre : c'est lui qui fait foi.

### Images

Colle ou dépose une image dans la zone de saisie : elle est enregistrée et jointe au message sous forme de vignette que tu peux retirer. Voir [Coller une capture](/docs/agents/captures-et-images).

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Basculer vue terminal / vue discussion | `Ctrl+Alt+T` | `⌥⌘T` |
| Rechercher une discussion | `Ctrl+Alt+R` | `⌥⌘R` |

## Avec ChatGPT

La vue lit les journaux de Codex remis dans la forme d'une conversation Claude Code (messages, outils, résultats). Ce chemin a été vérifié sur de vrais journaux, hors d'Orbit, mais pas encore à l'écran avec un Codex en marche.

## Limites

- Les fenêtres propres au terminal (comme `/usage` ou le choix du modèle de Claude Code) n'apparaissent pas dans la discussion : utilise les boutons d'Orbit ou la vue terminal.
- La vue garde les 400 derniers éléments de la conversation.
- Le chat est une lecture de la conversation enregistrée : sans session déjà ouverte dans le terminal, il n'a rien à afficher.

## Voir aussi

- [Terminaux d'agents](/docs/agents/terminaux)
- [Discussions du projet](/docs/agents/discussions)
- [Coller une capture](/docs/agents/captures-et-images)
