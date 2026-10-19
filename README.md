# Randomizer Arcade

Bot TypeScript pour Pokémon Showdown : tirages d’équipes par joueur et par round, distribution privée et suivi des tournois du salon configuré.

## Installation

Node.js 24 recommandé.

```sh
npm ci
```

Copier `.env.example` vers `.env` et renseigner `PS_USERNAME`, `PS_PASSWORD`, `ADMIN_USERS` et `PS_ROOM`. `BOT_MODE=ps` active Showdown ; `console` permet les essais locaux. Le préfixe reste `$`.

```sh
npm run dev
```

Sous Windows CMD, lancer cette commande dans le dossier contenant `package.json`.

## Liste des sets

En MP depuis un compte admin : `$setlist https://pokepast.es/xxxxxxxxxxxxxxxx`, puis `$currentlist`. La liste est conservée dans `data/current-list.json`. Le fichier `sets/sample-sets.txt` sert de liste de secours. Changer de liste hors tournoi actif.

## Tournois automatiques

En MP au bot : `$auto permanent on`. Le bot suit ensuite les tournois **Single Elimination nommés exactement RandArcade** du salon configuré. Les organisateurs créent et lancent le tournoi sur Showdown, avec son nom défini avant le départ :

```text
/tour name RandArcade
/wall Le bot UrsuCyberus vous envoie votre team par mp avant chaque match ! Attention à ne pas bloquer les PM.
```

Le démarrage Showdown remplace `$start`. Lorsqu’un match est prêt, les deux joueurs reçoivent leur équipe en MP, avec un lien Poképaste et un bloc copiable. Attendre cette équipe, l’importer et la sélectionner avant de combattre. Les événements répétés ne provoquent pas de nouveau tirage. Les rounds sont individuels ; les exemptions et remplacements de joueurs sont pris en charge.

En mode permanent, l’historique précédent est exporté et archivé avant la session suivante ; `$new` n’est pas nécessaire entre deux tournois pris en charge. `$auto permanent off` désactive les prochains démarrages automatiques ; un tournoi déjà en cours continue. `$auto off` suspend aussi les nouvelles actions de la session.

Pour un tournoi ponctuel : `$new` puis `$auto on` avant le départ. `$auto status` affiche l’état. Après un redémarrage, une session active est conservée mais mise en pause : attendre la réception du tableau, puis utiliser `$auto resume`. Ne pas reprendre une ancienne session dans un nouveau tournoi avec les mêmes participants.

## Commandes

| Commande | Usage |
| --- | --- |
| `$team` | Récupérer son équipe, sans nouveau tirage |
| `$round`, `$help` | Round individuel et aide |
| `$resend Pseudo` | Admin, en MP : renvoyer l’équipe directement au joueur ; l’admin reçoit seulement une confirmation |
| `$start`, `$next`, `$end` | Gestion manuelle des rounds et fin de tournoi |
| `$new` | Effacer l’état courant pour préparer un nouveau tournoi ; exporter d’abord si nécessaire |
| `$reset Pseudo`, `$advance Pseudo` | Corrections admin du tirage |
| `$status`, `$history Pseudo`, `$export` | État, historique et export Markdown |
| `$watch LIEN`, `$unwatch LIEN` | Surveillance manuelle d’un combat |

Les commandes incompatibles sont bloquées pendant l’automatisation. `$resend` ne crée jamais une équipe et refuse les joueurs sans match prêt en mode automatique. Une mise en file de MP ne garantit pas sa réception.

## Vérification des combats et sauvegardes

Le bot suit les combats annoncés par le tournoi et compare les Pokémon et attaques visibles aux équipes attribuées pour le match. Les anomalies sont envoyées à BalooDanceur. Aucun bannissement ni résultat de match n’est imposé automatiquement. Les informations cachées, Illusion, copies et transformations limitent la vérification ; dix combats simultanés au maximum et accès spectateur requis.

Les états et archives sont dans `data/`, les exports dans `exports/`. Préserver ces dossiers et `.env` lors des mises à jour. Ils sont exclus de Git.

Les guides Word sont dans [docs](docs/). Le README décrit le fonctionnement actuel du mode permanent ; certaines procédures du guide utilisateur correspondent au mode manuel.

## Vérifications

```sh
npm run check
npm test
```

Les tests utilisent des données temporaires et des requêtes Poképaste simulées. Le test WebSocket nécessite l’autorisation d’ouvrir un serveur local. Une validation sur un vrai tournoi reste nécessaire après installation.
