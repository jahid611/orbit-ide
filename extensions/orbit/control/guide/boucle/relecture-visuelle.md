---
title: Relecture visuelle
description: Après un changement d'interface, Orbit photographie la page avant et après et les montre à l'agent pour qu'il se relise.
order: 2
icon: scan-eye
---

Quand un agent modifie des fichiers d'interface alors que la page du projet tourne en local, Orbit en garde une capture avant le tour et en prend une seconde à la fin. Les deux images sont envoyées à l'agent, qui les ouvre, les compare à ta demande et corrige ce qui est de travers.

## À quoi ça sert

Un code qui compile ne dit pas si la page est belle. Cette boucle donne des yeux à l'agent : alignements cassés, textes coupés, éléments manquants ou contrastes illisibles ont plus de chances d'être repérés avant que tu regardes toi-même.

## Comment ça se déclenche

1. Au début d'un tour, Orbit photographie la page locale. Si une capture « après » existe déjà pour cette adresse, elle sert de « avant ».
2. Si l'agent écrit un fichier `css`, `scss`, `sass`, `less`, `html`, `jsx`, `tsx`, `vue`, `svelte`, `astro` ou `mdx`, le tour est marqué comme touchant l'interface.
3. À la fin du tour, Orbit attend 1,8 seconde que le serveur de développement recompile, puis prend la capture « après ».
4. Selon le mode, il envoie les deux chemins à l'agent ou te le propose.

Les captures sont prises par Edge ou Chrome déjà installé sur la machine, sans fenêtre visible, et rangées dans `~/.orbit/visual/<identifiant>/` sous les noms `avant.png` et `apres.png`. Le message envoyé à l'agent commence par `[Relecture visuelle d'Orbit]` : il lui demande de comparer avec ta demande puis de corriger, ou de dire que tout est bon sans rien modifier. Un tour ouvert par ce message n'est pas relu à son tour, pour éviter une boucle.

## Quelle page est photographiée

Celle du réglage `orbit.visualCheck.url` s'il contient une adresse `http://` ou `https://`. Sinon, le premier serveur local trouvé (les mêmes ports que pour la [vue vivante](/docs/boucle/vue-vivante)). Sans page locale, rien n'est capturé.

## La page de comparaison

La commande **Relecture visuelle : la page avant et après** ouvre une page avec un curseur pour passer de l'avant à l'après. Elle s'ouvre aussi depuis l'indicateur « Avant / après » de la barre d'état. Tu peux y changer de mode, relancer une capture ou montrer les images à l'agent. La commande **Relecture visuelle : capturer la page maintenant** prend une paire à la demande, sans attendre un tour.

## Modes

| Mode | Effet |
|---|---|
| `auto` (défaut) | L'agent reçoit les captures et se corrige tout seul, une fois par message. |
| `notify` | Orbit prévient et propose **Voir avant / après** ou **Faire relire**. |
| `off` | Aucune capture. |

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `orbit.visualCheck.mode` | `auto` | `auto`, `notify` ou `off`. |
| `orbit.visualCheck.url` | vide | Adresse de la page à photographier, par exemple `http://localhost:3000/tarifs`. Vide : le premier serveur local trouvé. |

## Avec ChatGPT

Le principe est le même. Orbit reconnaît les fichiers d'interface écrits par l'agent d'après les journaux de session de Codex.

## Limites

- Il faut Edge ou Chrome sur la machine (Chrome ou Chromium sous Linux, Chrome ou Edge sous macOS), et une page qui tourne en local.
- Une seule page est photographiée : celle de l'adresse retenue.
- Les captures font 1280 par 720 pixels, donc la version mobile de la page n'est pas relue.
- Les captures et la page de comparaison sont vérifiées ; la boucle complète avec un agent qui modifie une vraie interface n'a pas été rejouée.

## Voir aussi

- [Vue vivante](/docs/boucle/vue-vivante)
- [Vérification automatique](/docs/boucle/verification)
- [Machine à remonter le temps](/docs/boucle/machine-a-remonter-le-temps)
