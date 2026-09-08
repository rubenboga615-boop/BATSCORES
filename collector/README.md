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
# 0. Trouver un championnat, voir ses saisons disponibles
npm run collect -- ligues                       # les ensembles connus, sans appel
npm run collect -- ligues --search "premier"    # 1 appel
npm run collect -- saisons --league 61          # 1 appel, dit ce que couvre chaque saison

# 1. Chiffrer le cout AVANT de depenser du quota
npm run collect -- plan --league top5 --season 2019-2024 --profile total

# 2. Lancer (ou reprendre) la collecte
npm run collect -- run --league top5 --season 2019-2024 --profile total

# 3. Consulter l'etat, et savoir pourquoi ca n'avance pas
npm run collect -- status

# 4. Recuperer les donnees
npm run collect -- export --format csv --out ~/batscores-csv
```

### Choisir les championnats et les saisons

`--league` et `--season` acceptent bien plus qu'une valeur :

| Ecriture | Signification |
| --- | --- |
| `--league 61` | un championnat |
| `--league 61,39,140` | une liste |
| `--league top5` | un ensemble nomme |
| `--season 2023` | une saison |
| `--season 2021,2023` | une liste |
| `--season 2019-2024` | une plage, bornes comprises (6 saisons) |

Ensembles disponibles : `top5`, `coupes`, `top5+coupes`, `deuxiemes`, `europe`,
`monde`. `npm run collect -- ligues` les affiche avec leurs identifiants.

Les cibles sont parcourues **saison par saison**, pas championnat par
championnat : une collecte interrompue par le quota laisse ainsi des saisons
completes plutot que cinq championnats a moitie faits.

Une saisie fautive est refusee avec sa raison plutot que corrigee en silence.
Se tromper de competition ne coute pas un message d'erreur, cela coute une
collecte entiere de quota.

| Commande | Role |
| --- | --- |
| `plan` | Estime le nombre d'appels necessaires. Lecture pure : n'engage rien et ne cree aucune tache |
| `run` | Lance ou reprend la collecte |
| `derive` | Reconstruit les tables normalisees depuis l'archive brute |
| `status` | File d'attente, quota consomme, volumetrie de la base |
| `retry` | Remet les taches en echec dans la file |
| `cotes` | Rouvre le releve des cotes pour en refaire un et tracer la derive |
| `debloquer` | Leve un verrou laisse par une collecte interrompue |
| `ligues` | Cherche un championnat et son identifiant |
| `saisons` | Liste les saisons disponibles et ce que couvre chacune |
| `export` | Exporte les tables en CSV, JSON ou NDJSON |
| `nettoyer` | Remet a zero, du plus sur au plus destructeur |

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

### Une seule collecte a la fois

Ligne de commande et page Collecte partagent un verrou, un simple fichier PID
a cote de la base. Lancer une seconde collecte pendant qu'une premiere tourne
est refuse des deux cotes : sans cela le quota serait consomme deux fois, et
deux processus pourraient prendre la meme tache.

Un verrou laisse par un processus disparu (machine redemarree en pleine
collecte) est ignore automatiquement.

### « La collecte n'avance pas »

`npm run collect -- status` repond directement. Il affiche l'avancement **par
cible**, la derniere execution avec sa raison d'arret, et un diagnostic en
clair : quota du jour epuise, file terminee, derivation jamais lancee, taches
en echec.

Trois causes reviennent :

- **Le quota.** Collecter les cinq grands championnats sur six saisons en
  profil `total` represente environ 100 000 appels, soit une quinzaine de jours
  a 7 500 appels par jour. Ce n'est pas un blocage, c'est un rationnement :
  relancez la meme commande chaque jour, la reprise repart ou elle s'est
  arretee.
- **La file est vide.** Toutes les cibles semees sont faites. Pour aller plus
  loin, il faut ajouter des championnats ou des saisons — le collecteur ne
  devine pas ce qu'on ne lui a pas demande.
- **La derivation n'a pas tourne.** L'archive se remplit mais les tables
  restent vides. `npm run collect -- derive` les reconstruit, sans aucun appel.

### « Une collecte tourne deja » alors que rien ne tourne

Le verrou est un fichier `collector.pid` depose a cote de la base. Il enregistre
le numero du processus **et son empreinte**, car tester le seul numero ne suffit
pas : l'espace des PID fait 32 768 valeurs et Android les recycle vite. Apres un
arret brutal — batterie, veille, terminal ferme — le numero laisse dans le
fichier peut avoir ete repris par un tout autre programme, et le verrou
paraissait alors detenu pour toujours.

Un numero recycle est desormais reconnu et ignore. Si le doute subsiste — sur un
systeme sans `/proc`, ou avec un verrou d'ancienne version — la commande de
sortie est explicite :

```bash
npm run collect -- debloquer
```

Elle refuse de lever un verrou dont elle a pu confirmer qu'il appartient a une
collecte reellement en cours ; `--force` passe outre, au risque de faire tourner
deux collectes sur la meme base et de consommer le quota deux fois.

Rien n'est perdu en levant un verrou : tout l'etat vit en base, la reprise
repart de la premiere tache en attente.

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

## Exporter

La base SQLite est deja un format ouvert. Mais « ouvrable dans un tableur » et
« chargeable dans pandas » comptent autant, et personne ne devrait avoir a
ecrire du SQL pour recuperer ce qu'il a paye.

```bash
npm run collect -- export --format csv    --out ~/batscores-csv
npm run collect -- export --format ndjson --out ~/batscores-json
npm run collect -- export --tables fixtures,fixture_events --out ~/extrait
npm run collect -- export --with-raw --out ~/tout      # archive brute comprise
```

| Format | Usage |
| --- | --- |
| `csv` | tableur, R — un fichier par table, echappement RFC 4180 |
| `json` | script — un tableau complet par table |
| `ndjson` | gros volumes — une ligne JSON par enregistrement, lisible en flux |

Un `manifeste.json` accompagne l'export : date, format, nombre de lignes par
table. Un dossier de fichiers sans contexte vieillit mal.

L'archive brute est exclue par defaut : elle est volumineuse et redondante avec
les tables derivees. `--with-raw` l'inclut.

Depuis la page Collecte, chaque table non vide se telecharge d'un clic, au
format choisi.

## Repartir proprement

Une base a moitie collectee, avec des taches en echec et un plan qui ne
correspond plus a ce qu'on veut, est penible a demeler. `nettoyer` permet de
repartir — mais tout effacer n'est presque jamais ce qu'il faut.

```bash
npm run collect -- nettoyer                          # explique les trois niveaux
npm run collect -- nettoyer --niveau taches          # apercu : ne detruit rien
npm run collect -- nettoyer --niveau taches --oui    # applique
```

| Niveau | Efface | Conserve | Cout |
| --- | --- | --- | --- |
| `derive` | les tables interrogeables | l'archive, la file | aucun appel |
| `taches` | la file et l'historique | **l'archive** | aucun appel |
| `tout` | absolument tout | rien | **toute la collecte est a refaire** |

Sans `--oui`, la commande se contente d'afficher ce qu'elle effacerait. Une
commande destructrice portant sur des donnees payees doit pouvoir etre
inspectee avant d'etre lancee.

### Pourquoi `taches` ne coute rien

Le collecteur **ne consulte pas l'archive avant d'appeler** : chaque tache
executee consomme un appel, meme si la reponse est deja en base. Vider la file
et la ressemer reviendrait donc a repayer l'integralite de la collecte.

`nettoyer --niveau taches` reseme la file depuis l'archive, puis **reconcilie** :
toute tache dont le couple (endpoint, parametres) figure deja dans
`raw_responses` est marquee comme faite. On repart sur une file propre en
sachant ce qui reste reellement a demander.

Un test verifie cette propriete de bout en bout : apres nettoyage et
reconciliation, une nouvelle collecte consomme **zero appel**.

Ce que cela ne fait pas : rafraichir. Une donnee qui bouge — cotes, pronostics,
saison en cours — reste sur son dernier releve. Pour la redemander, il faut
rouvrir explicitement les taches concernees (`cotes`, `retry`).

### Choisir le bon profil au nettoyage

`taches` reseme avec le profil demande (`--profile`, `complet` par defaut).
Ressemer avec un profil plus large que celui d'origine cree des taches inedites,
qui restent en attente : ce n'est pas un defaut, mais la commande le signale.
Pour retrouver exactement l'etat d'avant, passez le profil d'origine.

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

## Modele de prediction

`collector/predict.mjs` entraine un modele de Poisson bivarie corrige facon
Dixon-Coles sur les rencontres deja collectees. Il ne consomme aucun appel API.

Pour chaque equipe, il estime une force d'attaque et une force de defense
relatives a la moyenne du championnat, separement a domicile et a l'exterieur.
Le produit de ces forces donne un nombre de buts attendu de chaque cote, dont
on tire la probabilite de chaque score exact. Le 1N2, le plus/moins de 2,5 buts
et le « les deux equipes marquent » se lisent dans cette matrice.

Deux raffinements comptent :

- **Ponderation temporelle.** Un match plus ancien pese moins, avec une
  demi-vie d'environ un an. L'anciennete se mesure **par rapport au match le
  plus recent de l'echantillon**, pas par rapport a l'horloge : sinon une base
  de quelques annees voit tous ses poids devenir infinitesimaux, le rappel vers
  la moyenne l'emporte, et le modele rend toutes les equipes identiques — un
  effondrement silencieux, bien pire qu'un refus de repondre.
- **Correction de Dixon-Coles.** Le Poisson simple sous-estime les scores nuls
  et 1-1 et surestime 1-0 et 0-1 ; le facteur tau corrige ces quatre cases, qui
  sont justement les plus frequentes.

Le modele refuse de repondre sous quarante rencontres, et signale la qualite de
l'echantillon au-dela. Il expose aussi les forces qu'il a estimees : on peut
donc voir **pourquoi** il penche d'un cote.

La confiance est l'ecart de la distribution 1N2 a l'incertitude maximale : un
match indecis donne mecaniquement une confiance basse, ce qui est honnete.

## Cotes : la seule donnee qui perd son sens si on n'en garde qu'une photo

Toutes les autres donnees sont figees une fois le match joue. Les cotes, non :
leur mouvement dit quelque chose que leur valeur finale ne dit pas. La table
`odds` ne garde que le dernier etat ; `odds_snapshots` garde **chaque releve**,
date par la reponse qui l'a produit.

La derivation alimente cette table sans appel supplementaire : elle relit
l'archive brute et y ajoute un point par reponse `/odds` archivee. Comme la
date vient de la reponse et non de l'heure de derivation, rejouer la
derivation ne fabrique aucun faux point.

Reste que la file de taches dedoublonne : une fois les cotes d'une rencontre
collectees, elles ne le seraient plus jamais. D'ou une commande dediee :

```bash
# Rouvrir le releve, puis le refaire : un point de plus sur la courbe
npm run collect -- cotes --league 61 --season 2025
npm run collect -- run   --league 61 --season 2025 --profile complet
```

Deux passages espaces de quelques heures suffisent a tracer une derive. Un
seul releve n'en trace aucune, et l'interface le dit plutot que de faire
semblant.

A la lecture (`collector/odds.mjs`), les cotes des differents bookmakers sont
agregees par la mediane — un operateur isole ne deplace donc pas la serie — et
la marge est retiree avant toute comparaison. Sans cela, les probabilites
implicites totalisent 105 a 110 % et notre modele paraitrait systematiquement
plus optimiste que le marche, ce qui serait un artefact et non un signal.

## Tests

Le collecteur est teste contre un faux fournisseur qui simule une saison
complete (`test/mock-season.mjs`) : calendrier aller-retour, faits de match,
compositions, statistiques d'equipe et de joueur, pagination.

Les tests couvrent notamment la reprise apres interruption, l'absence de
double appel, l'arret sur quota epuise, le fait que la derivation soit
rejouable sans creer de doublon, et le fait qu'un second releve de cotes
allonge la serie au lieu d'ecraser le premier.
