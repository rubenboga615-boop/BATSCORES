# Collecteur de donnees BATSCORES

Fonctionnalite distincte de l'application web : elle constitue une base de
donnees historique a partir d'API-Football, competition par competition et
saison par saison.

## Principe : l'archive brute est la source de verite

Chaque reponse de l'API est stockee **telle quelle** dans `raw_responses`.
Les tables normalisees (`fixtures`, `fixture_events`, `player_season_stats`...)
en sont **derivees**.

Cette separation est le coeur du systeme. Si un champ que le schema ignore
devient interessant dans six mois — une metrique obscure, un identifiant, un
commentaire d'arbitre — il est deja en base. Il suffit d'enrichir la
derivation et de la rejouer :

```bash
npm run collect -- derive     # aucun appel API, aucun quota consomme
```

Sans cette archive, il faudrait redemander les donnees a l'API et repayer le
quota — pour des saisons passees, cela represente des dizaines de milliers
d'appels.

## Utilisation

```bash
# 1. Chiffrer le cout AVANT de depenser du quota
npm run collect -- plan --league 61 --season 2023 --profile complet

# 2. Lancer (ou reprendre) la collecte
npm run collect -- run --league 61 --season 2023 --profile complet

# 3. Consulter l'etat
npm run collect -- status
```

| Commande | Role |
| --- | --- |
| `plan` | Estime le nombre d'appels necessaires. Lecture pure : n'engage rien et ne cree aucune tache |
| `run` | Lance ou reprend la collecte |
| `derive` | Reconstruit les tables normalisees depuis l'archive brute |
| `status` | File d'attente, quota consomme, volumetrie de la base |
| `retry` | Remet les taches en echec dans la file |

Options : `--league`, `--season`, `--profile`, `--max-calls`, `--db`, `--quiet`.

## Depuis l'interface web

La page **Collecte** (`#/collecte`) supervise et pilote le collecteur depuis un
navigateur — utile pour suivre depuis un telephone une collecte qui tourne
plusieurs jours sur le serveur :

- quota consomme du jour et appels restants ;
- avancement (taches faites / en attente / en echec) ;
- journal de l'execution en cours, rafraichi automatiquement ;
- contenu de la base et historique des executions ;
- estimation du cout d'une collecte, qui **ne consomme aucun appel** ;
- lancement et arret d'une collecte.

### Le lancement est desactive par defaut

Declencher une collecte depense un quota paye. Sur une instance accessible
publiquement, un bouton sans protection permettrait a n'importe qui de vider
votre quota. Les actions de lancement et d'arret exigent donc un jeton, et
sont **refusees tant qu'il n'est pas configure** :

```bash
# dans .env
COLLECTOR_ADMIN_TOKEN=une-phrase-secrete-que-vous-choisissez
```

Sans ce reglage, la page reste consultable : supervision et estimation
fonctionnent, seuls les boutons de lancement sont inertes. C'est le bon
reglage si vous n'avez pas besoin de piloter a distance.

Le jeton se saisit une fois dans la page, puis reste dans le navigateur.

Une collecte lancee depuis la page tourne en arriere-plan : elle continue si
vous fermez l'onglet, et meme si le serveur web redemarre.

## Profils

Le cout est domine par les appels **par rencontre** : chaque endpoint ajoute
se multiplie par le nombre de matchs de la saison.

| Profil | Par rencontre | Cout pour un championnat a 20 equipes (380 matchs) |
| --- | --- | --- |
| `essentiel` | faits, compositions, statistiques | ~1 150 appels |
| `complet` | + statistiques par joueur | ~1 590 appels |
| `total` | + pronostics, cotes, transferts, palmares | ~14 000 appels |

Le profil choisi au lancement filtre aussi l'execution : des taches ajoutees
par un profil plus large restent en attente au lieu d'etre executees. Passer de
`complet` a `essentiel` reduit donc reellement le quota depense, meme si la file
contient deja des taches du profil large.

Attention aux endpoints pagines : `/players` compte une page par tranche de 20
joueurs, soit plus de quarante appels pour un championnat a 20 equipes. Tant
qu'il n'a jamais ete appele, l'estimation n'en compte qu'une seule et le signale.

`complet` est le defaut, et le bon compromis dans la plupart des cas.
`total` n'a d'interet que si les cotes et les palmares individuels vous servent
reellement : il coute environ dix fois plus cher.

## Reprise : la propriete la plus importante

Une collecte historique se compte en jours de quota. Elle **sera** interrompue —
quota epuise, coupure reseau, machine redemarree. Tout l'etat vit en base :

- chaque unite de travail est une ligne de `tasks` (`pending` / `done` / `failed`) ;
- le quota consomme est compte par jour UTC dans `api_usage`, et survit donc
  a un redemarrage ;
- une interruption remet la tache en cours en attente **sans consommer d'essai**.

Relancer la meme commande reprend exactement ou la collecte s'etait arretee.
Aucun appel deja effectue n'est refait.

```bash
# Interrompu hier a court de quota ? La meme commande reprend.
npm run collect -- run --league 61 --season 2023
```

## Quota

Le plan Pro autorise 300 appels/minute et 7 500 par jour. Le collecteur :

- respecte le plafond par minute avec une fenetre glissante ;
- s'arrete proprement quand le plafond journalier est atteint ;
- accepte `--max-calls` pour reserver du quota a d'autres usages.

```bash
# Ne consommer que 2 000 appels, garder le reste pour l'application
npm run collect -- run --league 61 --season 2023 --max-calls 2000
```

Ordre de grandeur pour un historique : **10 saisons d'un championnat en profil
`complet` coutent environ 16 000 appels, soit un peu plus de deux jours de
quota.** Cinq championnats sur dix ans depassent la semaine. Lancez-le sur le
VPS, pas sur un poste que vous eteignez.

## Base de donnees

SQLite, via le module `node:sqlite` integre a Node — aucune dependance native
a compiler, ce qui evite les ennuis sur ARM et sur un VPS minimal.

**Le collecteur exige Node 22 ou superieur** (`node:sqlite` n'existe pas avant).
L'application web, elle, fonctionne des Node 20.

Fichier par defaut : `data/batscores.db` (ignore par git). Deplacez-le,
sauvegardez-le ou interrogez-le avec n'importe quel outil SQLite.

```sql
-- Meilleurs buteurs, calcules depuis les faits de match
SELECT p.name, COUNT(*) AS buts
FROM fixture_events e JOIN players p ON p.id = e.player_id
WHERE e.type = 'Goal' AND e.detail != 'Own Goal'
GROUP BY e.player_id ORDER BY buts DESC LIMIT 10;

-- Note moyenne d'un joueur, extraite du JSON conserve
SELECT p.name, ROUND(AVG(CAST(json_extract(s.stats, '$[0].games.rating') AS REAL)), 2) AS note
FROM fixture_player_stats s JOIN players p ON p.id = s.player_id
GROUP BY s.player_id HAVING COUNT(*) >= 10 ORDER BY note DESC LIMIT 10;
```

## Couverture des saisons anciennes

Tout n'est pas disponible pour toutes les saisons : la profondeur d'historique
et les endpoints couverts dependent de la competition et du plan. L'objet
`coverage` renvoye par `/leagues` est archive dans `league_seasons.coverage` —
consultez-le avant de lancer une collecte sur dix ans :

```sql
SELECT season, coverage FROM league_seasons WHERE league_id = 61 ORDER BY season;
```

Une saison sans couverture pour un endpoint donne produit des taches en echec,
sans interrompre le reste de la collecte. `npm run collect -- status` les compte.

## Tests

Le collecteur est teste contre un faux fournisseur qui simule une saison
complete (`test/mock-season.mjs`) : calendrier aller-retour, faits de match,
compositions, statistiques d'equipe et de joueur, pagination.

Les tests couvrent notamment la reprise apres interruption, l'absence de
double appel, l'arret sur quota epuise, et le fait que la derivation soit
rejouable sans creer de doublon.
