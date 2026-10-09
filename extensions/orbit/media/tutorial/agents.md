# Plusieurs agents en parallèle

| Action | Windows / Linux | Mac |
|---|---|---|
| Organiser les agents | Ctrl+Alt+A | ⌥⌘A |
| Claude en split | Ctrl+Alt+\ | ⌥⌘\ |
| Grille d'agents (2, 3, 4 ou 6) | Ctrl+Alt+G | ⌥⌘G |

Chaque agent a sa **couleur**, que tu retrouves sur son onglet, sur ses fichiers et sur sa planète. Son onglet indique s'il **travaille**, s'il **attend ton autorisation** ou s'il a **terminé**, et Orbit te prévient quand tu regardes ailleurs.

**Le piège principal**

Des agents lancés dans le même dossier modifient les mêmes fichiers : l'un peut écraser le travail de l'autre. Deux réponses :

- **Worktree** : « Claude dans un worktree » crée une branche git et un dossier séparés pour l'agent. C'est la façon sûre de faire travailler deux agents sur la même partie du code.
- **Radar de collision** (étape suivante) : il te prévient si deux agents touchent quand même au même fichier.

« Message à tous » envoie le même texte à chaque agent : pratique pour un « arrête-toi » général, risqué pour une consigne de travail.
