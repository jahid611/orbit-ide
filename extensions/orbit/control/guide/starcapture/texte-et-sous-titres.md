---
title: Texte et sous-titres
description: Ajoute des textes stylés, transcris la parole sur ta machine et génère des sous-titres karaoké.
order: 4
icon: captions
---

Un texte est un clip comme les autres : il se pose sur une piste de texte, se coupe, se déplace, s'anime. Les sous-titres automatiques sont des textes générés à partir de la transcription de la parole.

## À quoi ça sert

- Mettre un mot-clé à l'écran au moment où il est dit.
- Ajouter un titre, un bandeau de nom, un sous-titre sobre.
- Sous-titrer toute une vidéo, mot par mot, sans rien taper.

## Ajouter un texte

Ouvre l'onglet **Texte** de la bibliothèque et clique sur un style : le texte est ajouté à la tête de lecture.

| Style | Aspect |
|---|---|
| Mot choc | Arial Black, blanc, gros contour noir, majuscules, animation pop |
| Énorme jaune | Impact, jaune, très gros contour, majuscules, animation rebond |
| Sous-titre karaoké | Arial Black, blanc, mot surligné en jaune, majuscules, en bas de l'image |
| Titre | Arial Black, blanc, ombre portée, animation pop |
| Sous-titre sobre | Segoe UI, semi-gras, léger contour, sans animation |
| Bandeau nom | Segoe UI, texte blanc sur fond violet, animation montée |
| Minimal | Segoe UI fin, animation fondu |
| Machine à écrire | Consolas, couleur menthe, les lettres apparaissent une à une |

Sélectionne le clip pour régler son texte dans l'onglet **Texte** de l'inspecteur : contenu, police, taille, graisse, couleur, contour, ombre, fond (case **Encadré**), couleur de surlignage karaoké, alignement, majuscules et animation (Aucune, Pop, Rebond, Fondu, Montée, Machine à écrire). Le texte se déplace et se redimensionne aussi directement sur l'image.

Les polices proposées sont : Arial Black, Impact, Segoe UI, Segoe UI Black, Bahnschrift, Arial, Verdana, Georgia, Consolas, Comic Sans MS et Trebuchet MS.

Les tailles, contours et ombres sont comptés en pixels du cadre : si tu changes le format du projet, ils suivent (voir [Format du projet](/docs/starcapture/format)).

## Transcrire la parole

Dans l'onglet **Sous-titres** de la bibliothèque, choisis le média puis clique sur **Transcrire la parole**. La transcription se fait sur ta machine avec whisper.cpp, aucun fichier n'est envoyé ailleurs. Elle donne chaque mot avec son instant, et elle est gardée dans le projet : un clic sur un mot de la transcription déplace la tête de lecture à cet endroit.

Le modèle se choisit avec le réglage `starcapture.transcriptionModel` (`base` est rapide, `small` est le défaut, `medium` est le plus juste) ; il est téléchargé une fois. La langue est le français par défaut ; l'agent peut en demander une autre (voir [Monter avec l'agent](/docs/starcapture/agent)).

## Sous-titres automatiques

**Sous-titres automatiques** (dans l'onglet **Sous-titres** ou sur la barre de la timeline) lance la transcription si elle manque, puis crée des textes de style karaoké :

- 1 à 3 mots par sous-titre, jamais à cheval sur une pause ou une fin de phrase ;
- chaque mot passe à la couleur de surlignage au moment où il est prononcé ;
- un sous-titre se prolonge jusqu'au suivant quand l'écart est inférieur à 0,3 s, pour éviter le clignotement ;
- relancer la commande remplace les sous-titres automatiques précédents.

Les sous-titres sont gravés dans l'image à l'export avec leur contour, leur ombre, leur encadré, le karaoké et les animations pop, rebond, montée et machine à écrire.

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `starcapture.transcriptionModel` | `small` | Modèle de transcription : `base`, `small` ou `medium`. |

## Limites

- Whisper se télécharge une fois sous Windows ; sous macOS et Linux, whisper.cpp doit déjà être installé (`brew install whisper-cpp` sur macOS). S'il ne démarre pas, la transcription se fait dans la page, sur le processeur, plus lentement.
- Une transcription de 30 secondes de parole prend environ 5 secondes sur un processeur courant.
- Les sous-titres ne remplacent pas ceux que tu as écrits à la main : seuls les textes issus du karaoké automatique sont refaits.

## Voir aussi

- [Effets, transitions et couleur](/docs/starcapture/effets-et-couleur)
- [Créations](/docs/starcapture/creations)
- [Export](/docs/starcapture/export)
