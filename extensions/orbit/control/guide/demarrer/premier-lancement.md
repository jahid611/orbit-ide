---
title: Premier lancement
description: Ce qui se passe à la première ouverture d'Orbit : choix de l'IA, circuit de découverte, tutoriel intégré et premier terminal d'agent.
order: 2
icon: rocket
---

À la première ouverture, Orbit te pose une question, te fait visiter ses fonctions sur la vraie interface, puis lance un agent dans un terminal. Tout se rejoue ensuite quand tu veux, depuis la palette de commandes (`Ctrl+Maj+P`, `⇧⌘P` sur macOS).

## Les étapes

1. **Le choix de l'IA.** Quelques secondes après l'ouverture, une liste te demande « Avec quelle IA veux-tu travailler dans Orbit ? » : Claude (Claude Code) ou ChatGPT (Codex). La question n'est posée qu'une fois. Voir [Claude ou ChatGPT](/docs/demarrer/choisir-son-ia).
2. **Le circuit de découverte.** Une fois l'IA choisie, un circuit démarre tout seul, une seule fois.
3. **Le premier agent.** Quand tu ouvres un projet, Orbit lance un terminal avec l'agent dedans (réglage `orbit.claude.autoStart`, activé par défaut).

## Le circuit de découverte

Le circuit compte 36 étapes, rangées en chapitres : Bienvenue, Les agents, Suivre le travail, Coder plus vite, Déléguer, Construire, Créer, Chez toi, C'est parti. Chaque étape ouvre la vraie fonction et l'explique sur une carte flottante, avec un anneau autour de l'élément concerné et son raccourci quand il en a un.

- La carte se déplace en la tirant par le haut.
- **Suivant** et **Précédent** avancent et reculent ; **Quitter le circuit** l'arrête, et **Terminer** apparaît à la dernière étape.
- Les étapes se contentent d'afficher : aucune ne lance de travail. Les pages qu'une étape a ouvertes sont refermées à l'étape suivante.
- Pour le refaire, ouvre la palette et tape « circuit » : la commande s'appelle « Circuit de découverte : visiter toutes les fonctions d'Orbit » (`orbit.tour.start`).

## Le tutoriel intégré

Le tutoriel « Découvrir Orbit » est un parcours en étapes, chacune avec une page d'explication, un bouton d'essai et des captures. Il traite les fonctions importantes et leurs pièges : terminaux, vue discussion, modèle, abonnement, agents en parallèle, vue Orbite, chef d'orchestre, machine à remonter le temps, vue vivante, base de données, Unity, vérification, recettes, StarCapture, contexte, discussions, règles du projet et personnalisation.

Ouvre-le avec la commande « Tutoriel : découvrir Orbit » (`orbit.tutorial`), ou depuis la page d'accueil.

## Ton premier terminal d'agent

- **Avec un dossier ouvert**, le terminal de l'agent s'ouvre dans le panneau de droite. L'onglet indique si l'agent travaille, attend ta réponse ou a fini.
- **Sans dossier**, `Ctrl+Alt+N` (`⌥⌘N`) demande où l'agent doit travailler : Projet rapide, Nouveau projet, Ouvrir un dossier, ou Sans dossier (déconseillé, car l'explorateur reste vide). Voir [Ouvrir et créer un projet](/docs/demarrer/projets).
- Avec Claude, si le projet a déjà des discussions, la dernière est reprise à l'ouverture au lieu d'en commencer une neuve (réglage `orbit.claude.resumeOnOpen`).

## Raccourcis

| Action | Windows / Linux | macOS |
|---|---|---|
| Aller au terminal de l'agent | `Ctrl+L` | `⌘L` |
| Nouveau terminal d'agent | `Ctrl+Alt+N` | `⌥⌘N` |
| Ouvrir le Studio | `Ctrl+Alt+,` | `⌥⌘,` |

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.assistant` | `claude` | L'IA utilisée : `claude` ou `chatgpt`. |
| `orbit.claude.autoStart` | `true` | Ouvre un terminal avec l'agent à l'ouverture d'un projet. |
| `orbit.claude.resumeOnOpen` | `true` | Reprend la dernière discussion du projet à l'ouverture. |

## Limites

- Le circuit ne démarre seul que si la fenêtre d'Orbit sait dessiner la carte flottante ; sinon il se replie sur de simples messages et ne se lance que sur demande.
- La reprise de la dernière discussion à l'ouverture ne concerne que Claude.

## Voir aussi

- [Terminaux d'agents](/docs/agents/terminaux)
- [Discussions du projet](/docs/agents/discussions)
- [Studio](/docs/personnaliser/studio)
