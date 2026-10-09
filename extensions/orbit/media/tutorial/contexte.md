# Donner du code à Claude

## Pointer un passage

**Ctrl+Shift+L** (⇧⌘L) insère dans le prompt du terminal Claude une référence au fichier ouvert, avec les lignes sélectionnées : `@src/app.ts#L12-30`. Claude lit exactement ce passage ; rien n'est envoyé tant que tu n'as pas validé ton message.

## Édition sur place

**Ctrl+K** (⌘K) dans l'éditeur : décris le changement, Claude réécrit la sélection (ou génère au curseur), puis tu choisis :

| | Windows / Linux | Mac |
|---|---|---|
| Accepter | Ctrl+Entrée | ⌘⏎ |
| Rejeter | Ctrl+Retour | ⌘⌫ |

« Diff » montre l'avant/après, « Retoucher » relance avec une précision.

**Pièges**

- L'édition sur place ne voit que la sélection et une quarantaine de lignes autour, sans accès au reste du projet. Pour un changement qui touche plusieurs fichiers, passe par le terminal Claude.
- Ctrl+K remplace, quand l'éditeur a le focus, les raccourcis en deux temps de VS Code qui commencent par Ctrl+K.
- Elle utilise un modèle rapide réglable (`orbit.inlineEdit.model`), indépendant de celui du terminal.
