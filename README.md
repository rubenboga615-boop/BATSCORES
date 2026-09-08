# BATSCORES

Application de scores de football en direct, dans l'esprit de FlashScore, propulsee par
[API-Football](https://www.api-football.com/) (plan Pro).

Resultats en direct, calendriers, classements, compositions, statistiques et
confrontations directes — en francais, sur ordinateur comme sur mobile.

Le depot contient aussi un **collecteur de donnees** qui constitue une base
historique interrogeable a partir de la meme cle API : voir
[`collector/README.md`](collector/README.md).

## Fonctionnalites

- **Matchs du jour** groupes par competition, avec navigation sur 7 jours et filtres
  (tous / en direct / termines / a venir).
- **Direct** : scores et minutes de jeu rafraichis automatiquement toutes les 30 secondes.
- **Fiche de match** : faits de match minute par minute, statistiques comparees,
  compositions et banc, bilan des confrontations.
- **Competitions** : catalogue filtrable, classement avec zones europeennes et
  relegation, calendrier par journee, meilleurs buteurs.
- **Fiche equipe** : identite, bilan de saison (series, records, buts par tranche de
  quinze minutes, formations utilisees, penaltys), prochaines rencontres et resultats.
- **Fiche joueur** : identite, statistiques de saison detaillees, transferts, palmares,
  blessures et suspensions.
- **Pronostic** : le moteur du fournisseur et notre propre modele, entraine sur les
  donnees collectees, avec les forces estimees et la confiance.
- **Momentum** : courbe de pression minute par minute, reconstruite a partir des faits
  de match, avec la part de temps a l'avantage de chaque equipe.
- **Cotes et derive** : probabilites degonflees de la marge du bookmaker, mouvement
  entre le premier et le dernier releve, et ecart avec notre modele.
- **Comparateur d'equipes** : quatorze indicateurs de saison face a face, ramenes au
  match, plus le profil de buts par tranche de quinze minutes.
- **Notes des joueurs** par rencontre, et composition dessinee sur un terrain.
- **Quatre classements individuels** : buteurs, passeurs, cartons jaunes, cartons rouges.
- **Classement general, a domicile et a l'exterieur**, rang et points recalcules.
- **Recherche** d'equipes et de competitions.
- **Notifications** : coup d'envoi, buts, mi-temps et resultat final de vos matchs
  suivis, meme application fermee. Rien d'autre n'est envoye.
- **Actualites** : les articles de sources RSS choisies par l'exploitant du serveur,
  fusionnes et dates.
- **Favoris** : suivez des matchs et des competitions ; tout reste sur votre appareil.
- **PWA** : installable sur mobile, avec demarrage instantane hors ligne du shell.

## Architecture

```
navigateur  ->  serveur BATSCORES  ->  API-Football
   (PWA)        (proxy + cache)         (votre cle)
```

Le navigateur ne voit **jamais** la cle API : il interroge uniquement le serveur
BATSCORES, qui ajoute la cle cote serveur. Cela evite qu'une cle payante ne soit
lisible dans le code source de la page.

Le serveur protege aussi votre quota :

- **Cache memoire a duree variable** — les resultats passes sont conserves 6 heures,
  le calendrier a venir 15 minutes, la journee en cours 45 secondes, le direct 20 secondes.
  Dix visiteurs sur la meme page ne coutent qu'un seul appel.
- **Deduplication** — deux requetes identiques simultanees ne declenchent qu'un appel.
- **Limiteur de debit glissant** — au maximum `RATE_LIMIT_PER_MINUTE` appels par minute
  (280 par defaut, sous le plafond de 300/min du plan Pro), les appels excedentaires
  attendent leur tour au lieu d'etre rejetes.

## Installation

Prerequis : Node.js 20 ou superieur.

```bash
git clone https://github.com/rubenboga615-boop/BATSCORES.git
cd BATSCORES
npm install
cp .env.example .env
```

Ouvrez `.env` et renseignez votre cle :

```
API_FOOTBALL_KEY=votre_cle_api
API_FOOTBALL_PROVIDER=apisports
```

Puis lancez :

```bash
npm start
```

L'application est disponible sur <http://localhost:3000>.

En developpement, `npm run dev` redemarre le serveur a chaque modification.

## Configuration

| Variable | Defaut | Role |
| --- | --- | --- |
| `API_FOOTBALL_KEY` | *(vide)* | Votre cle API. **Obligatoire.** |
| `API_FOOTBALL_PROVIDER` | `apisports` | `apisports` si inscrit sur dashboard.api-football.com, `rapidapi` si souscrit via RapidAPI. |
| `PORT` | `3000` | Port d'ecoute. |
| `DEFAULT_TIMEZONE` | `Europe/Paris` | Fuseau demande au fournisseur. |
| `RATE_LIMIT_PER_MINUTE` | `280` | Plafond d'appels amont par minute. |
| `API_FOOTBALL_BASE_URL` | *(vide)* | Surcharge de l'URL amont, pour les tests hors ligne. |
| `API_FOOTBALL_DAILY_LIMIT` | `7500` | Plafond d'appels par jour de votre plan. |
| `COLLECTOR_ADMIN_TOKEN` | *(vide)* | Jeton exigé pour lancer une collecte depuis l'interface. Vide = lancement désactivé. |
| `COLLECTOR_DB` | `data/batscores.db` | Emplacement de la base du collecteur. |

**Quel fournisseur choisir ?** Si votre tableau de bord est sur
`dashboard.api-football.com`, gardez `apisports`. Si vous avez souscrit depuis
RapidAPI, mettez `rapidapi` : l'en-tete d'authentification et l'URL changent.

## API interne

Le frontend consomme ces routes ; elles sont aussi utilisables directement.

| Route | Description |
| --- | --- |
| `GET /api/config` | Reglages publics (nom, fuseau, cle configuree ou non). |
| `GET /api/health` | Etat du service, statistiques de cache, quota consomme. |
| `GET /api/fixtures?date=YYYY-MM-DD` | Rencontres d'une journee, groupees par competition. |
| `GET /api/fixtures/live` | Rencontres en cours. |
| `GET /api/fixtures/:id` | Fiche complete : faits, compositions, statistiques, confrontations. |
| `GET /api/fixtures/team/:id` | Derniers et prochains matchs d'une equipe. |
| `GET /api/competitions` | Catalogue des competitions de la saison en cours. |
| `GET /api/competitions/:id/standings?season=` | Classement. |
| `GET /api/competitions/:id/fixtures?season=` | Calendrier complet. |
| `GET /api/competitions/:id/scorers?season=` | Meilleurs buteurs. |
| `GET /api/teams/:id` | Fiche equipe. |
| `GET /api/teams/:id/statistics?league=&season=` | Bilan de saison detaille. |
| `GET /api/players/:id?season=` | Fiche joueur. |
| `GET /api/predict/:id` | Pronostic : moteur du fournisseur et modele maison. |
| `GET /api/odds/:id` | Cotes archivees, probabilites nettes de marge et derive. |
| `GET /api/compare?a=&b=&league=&season=` | Comparaison de deux equipes. |
| `GET /api/news` | Articles des sources RSS configurees. Aucun quota consomme. |
| `GET /api/push/key` | Cle publique VAPID, ou raison de l'indisponibilite. |
| `POST /api/push/subscribe` | Enregistre un appareil et les rencontres qu'il suit. |
| `POST /api/push/unsubscribe` | Oublie un appareil. |
| `GET /api/search?q=` | Recherche equipes et competitions. |

## Collecteur de donnees

Fonctionnalite distincte de l'application web : elle archive l'integralite de
ce qu'API-Football expose pour une competition et une saison, dans une base
SQLite interrogeable.

```bash
npm run collect -- plan --league 61 --season 2023 --profile complet  # chiffre le cout
npm run collect -- run  --league 61 --season 2023 --profile complet  # collecte
npm run collect -- status                                            # etat
```

Le collecteur se pilote aussi depuis l'application, page **Collecte**
(`#/collecte`) : quota du jour, avancement, journal en direct, estimation du
cout, lancement et arret. Le lancement est desactive tant que
`COLLECTOR_ADMIN_TOKEN` n'est pas defini dans `.env` — une instance publique ne
doit pas laisser n'importe qui consommer votre quota.

Deux proprietes en font le coeur :

- **Rien n'est perdu.** Chaque reponse est archivee telle quelle ; les tables
  normalisees en sont derivees et peuvent etre enrichies puis reconstruites
  plus tard, sans redepenser un seul appel.
- **La reprise est garantie.** L'etat vit en base : quota epuise, coupure
  reseau ou machine redemarree, relancer la meme commande repart exactement ou
  la collecte s'etait arretee.

Le collecteur exige **Node 22 ou superieur** (module `node:sqlite`), alors que
l'application web fonctionne des Node 20. Details, profils de collecte et
budget de quota : [`collector/README.md`](collector/README.md).

## Tests

```bash
npm test          # routes du backend et chemins d'erreur (runner integre de Node)
npm run test:e2e  # interface, dans Chromium, en bureau et en mobile
npm run test:all  # les deux
```

**Aucun test n'appelle le vrai API-Football.** Ils tournent contre un faux
fournisseur (`test/mock-api.mjs`) qui reproduit la forme des reponses de l'API v3,
y compris ses particularites : enveloppe `{ errors, response }`, tableau de tableaux
pour les classements, possession exprimee en pourcentage textuel. Les tests sont donc
deterministes, executables hors ligne, et ne consomment aucun quota.

Couverture : 41 tests backend (groupement et ordre des competitions, phases de
statut, agregation de la fiche de match, classement, buteurs, recherche, favoris,
efficacite du cache, cle absente, cle refusee, panne du fournisseur, et pour le
collecteur : planification, reprise apres interruption, arret sur quota,
derivation rejouable) et 34 tests d'interface joues deux fois, en bureau et en
mobile.

Les tests du collecteur sont automatiquement ignores sous Node 20, qui ne
fournit pas `node:sqlite`.

Les tests navigateur ont besoin de Chromium :

```bash
npx playwright install chromium
```

Si vous disposez deja d'un Chromium sur la machine, `PW_CHROMIUM_PATH` permet de
le reutiliser sans rien telecharger :

```bash
PW_CHROMIUM_PATH=/chemin/vers/chromium npm run test:e2e
```

### Integration continue

`.github/workflows/ci.yml` rejoue tout cela a chaque poussee sur `main` et a chaque
pull request : les tests backend sous Node 20 et 22, puis les tests d'interface.
En cas d'echec, le rapport Playwright est conserve comme artefact pendant 7 jours.

## Deploiement

**[DEPLOIEMENT.md](DEPLOIEMENT.md)** deroule la mise en ligne pas a pas, sans rien
supposer d'acquis : VPS, Node, PM2, nom de domaine, HTTPS, sauvegardes. Comptez une
heure la premiere fois, trente secondes pour chaque mise a jour ensuite.

L'application est un serveur Node classique, sans etape de build. Elle fonctionne sur
tout hebergeur acceptant Node 20+ ; le collecteur, lui, exige Node 22.

Quatre points a respecter :

1. Definir `API_FOOTBALL_KEY` dans `.env` ou dans les variables d'environnement de
   l'hebergeur, **jamais** dans un fichier versionne. `.env` est ignore par git ;
   `.env.example` ne doit contenir que des valeurs d'exemple.
2. Servir en HTTPS : le service worker et l'installation PWA l'exigent.
3. Derriere un proxy inverse, poser `HOST=127.0.0.1` et `TRUST_PROXY=1`. Sans le
   premier, le site reste joignable en clair sur le port de Node, ce qui contourne
   le HTTPS ; sans le second, toutes les requetes semblent venir du proxy.
4. **Une seule instance.** Le cache et le limiteur de debit vivent en memoire : deux
   instances, c'est deux fois moins d'effet du cache et deux fois le plafond d'appels
   envoye au fournisseur, pour le meme trafic. `ecosystem.config.cjs` impose donc le
   mode `fork` a un seul processus.

Fichiers fournis : `ecosystem.config.cjs` (PM2) et `Caddyfile.exemple` (proxy inverse
et certificat automatique).

### Notifications

Elles sont eteintes par defaut. Pour les activer :

```bash
npm run vapid          # genere la paire de cles, une seule fois
```

Collez les trois lignes affichees dans `.env`, puis redemarrez. Tant que les cles
sont absentes, l'interface l'annonce au lieu de proposer un bouton qui echouerait.

Le protocole est implemente directement sur `node:crypto` (`server/webpush.js`) :
chiffrement RFC 8291 et authentification VAPID RFC 8292. La bibliotheque usuelle
aurait ajoute quatorze paquets transitifs a un projet qui en compte trois — autant
de mises a jour a suivre sur le serveur. Le chiffrement est verifie par aller-retour
dans les tests : un message chiffre puis dechiffre avec les cles d'un faux abonnement
prouve que le navigateur saura le lire.

**Cout en quota.** Le veilleur n'interroge le fournisseur que si au moins une
rencontre suivie est en cours ou commence dans les dix minutes ; sinon il se rendort
sans depenser un appel. Les rencontres suivies partent par lots de vingt en un seul
appel. Une rencontre terminee depuis trois heures sort automatiquement des listes.

### Actualites

`NEWS_FEEDS` declare les sources, au format `Nom|https://...`, separees par des
virgules ou des retours a la ligne. Les flux sont lus **par le serveur** : une
adresse fournie par un visiteur n'est jamais suivie, sans quoi l'application
deviendrait un relai vers n'importe quelle machine, y compris sur son reseau interne.

Les vignettes des articles ne sont pas affichees : elles viendraient des serveurs des
redactions, ce qui obligerait a ouvrir la politique de securite du contenu a toutes
les origines et signalerait chaque lecture a ces redactions.

### En-tetes de securite

`server/app.js` pose une politique de securite du contenu sans exception sur les
scripts : aucun script en ligne, aucune origine tierce. C'est ce qui a motive le
remplacement des derniers gestionnaires `onclick`/`onerror` en attribut par des
ecouteurs delegues — une politique qu'on affaiblit pour faire passer le code
n'en est plus une. Les images du fournisseur sont autorisees explicitement ;
`CSP_EXTRA_IMG_HOSTS` permet d'en ajouter sans toucher au code.

## Structure du projet

```
DEPLOIEMENT.md     mise en ligne pas a pas (VPS, PM2, domaine, HTTPS)
ecosystem.config.cjs configuration PM2 : un seul processus, deliberement
scripts/vapid.mjs  generation des cles de notification
Caddyfile.exemple  proxy inverse et certificat automatique
server/
  index.js         point d'entree : ecoute HOST:PORT, veilleur, arret propre
  webpush.js       Web Push sur node:crypto : chiffrement et VAPID
  pushStore.js     abonnements, dans un fichier JSON (compatible Node 20)
  pushWatcher.js   detecte buts et changements d'etat, previent les appareils
  rss.js           lecture tolerante des flux RSS et Atom
  app.js           application Express : routes, en-tetes de securite, statiques
  config.js        lecture de l'environnement, choix du fournisseur
  apiFootball.js   client amont : cache, deduplication, limiteur de debit
  cache.js         cache memoire TTL
  normalize.js     mise en forme des reponses, regroupement, ordre d'affichage
  routes/          fixtures, competitions, equipes, joueurs, recherche, sante, collecteur
public/
  index.html       shell de l'application
  css/styles.css   theme sombre
  js/
    app.js         routes, evenements globaux, rafraichissement du direct
    api.js         appels au backend
    router.js      routeur a fragment d'URL
    store.js       favoris et etat replie (localStorage)
    components.js  fragments de rendu partages
    i18n.js        traduction des libelles du fournisseur
    utils.js       formatage des dates, scores, statuts
    momentum.js    indice de pression reconstruit a partir des faits de match
    notifications.js negociation de l'abonnement et synchronisation des favoris
    views/         matchs, direct, fiche match, competitions, equipe, joueur,
                   recherche, favoris, comparateur, actualites, collecte
  sw.js            service worker : reseau d'abord, cache en secours hors ligne
collector/
  schema.sql       29 tables : archive brute, file de travail, donnees normalisees
  lock.mjs         verrou partage : une seule collecte a la fois
  db.mjs           acces SQLite, file de taches, comptabilite du quota
  client.mjs       client API : limitation de debit, reprises, archivage brut
  plan.mjs         profils de collecte et estimation du cout
  worker.mjs       boucle d'execution reprenable
  derive.mjs       archive brute -> tables normalisees
  predict.mjs      modele Dixon-Coles entraine sur la base
  odds.mjs         lecture des cotes : marge retiree, derive, ecart au modele
  cli.mjs          ligne de commande
test/
  mock-api.mjs     faux fournisseur API-Football
  api.test.mjs     tests des routes du backend
  errors.test.mjs  tests des chemins d'erreur, chacun dans un processus isole
  stack.mjs        pile faux fournisseur + application, pour les tests navigateur
  mock-season.mjs  faux fournisseur simulant une saison complete
  collector.test.mjs tests du collecteur
  predict.test.mjs   tests du modele de prediction
  odds.test.mjs      tests de lecture des cotes
  momentum.test.mjs  tests de la courbe de pression
  analytics.test.mjs tests du comparateur et de la route des cotes
  webpush.test.mjs   chiffrement Web Push, verifie par aller-retour
  push.test.mjs      abonnements, veilleur et faits detectes
  news.test.mjs      lecture des flux RSS et Atom
  e2e/             tests d'interface Playwright
.github/workflows/
  ci.yml           integration continue
```

## Licence

MIT.
