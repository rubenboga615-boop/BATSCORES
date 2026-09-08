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
- **Fiche equipe** : identite, prochaines rencontres et derniers resultats.
- **Recherche** d'equipes et de competitions.
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

L'application est un serveur Node classique, sans etape de build. Elle fonctionne sur
tout hebergeur acceptant Node 18+ (Render, Railway, Fly.io, VPS, Docker...).

Deux points a respecter :

1. Definir `API_FOOTBALL_KEY` dans les variables d'environnement de l'hebergeur,
   **jamais** dans un fichier versionne. `.env` est deja ignore par git.
2. Servir en HTTPS : le service worker et l'installation PWA l'exigent.

Le cache etant en memoire, chaque instance a le sien. Avec plusieurs instances,
la consommation de quota est multipliee d'autant : ajustez `RATE_LIMIT_PER_MINUTE`
en consequence.

## Structure du projet

```
server/
  index.js         point d'entree : ecoute le port configure
  app.js           construction de l'application Express (routes, statiques, erreurs)
  config.js        lecture de l'environnement, choix du fournisseur
  apiFootball.js   client amont : cache, deduplication, limiteur de debit
  cache.js         cache memoire TTL
  normalize.js     mise en forme des reponses, regroupement, ordre d'affichage
  routes/          fixtures, competitions, equipes, recherche, sante
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
    views/         matchs, direct, fiche match, competitions, equipe, recherche, favoris
  sw.js            service worker (shell uniquement, jamais les scores)
collector/
  schema.sql       28 tables : archive brute, file de travail, donnees normalisees
  db.mjs           acces SQLite, file de taches, comptabilite du quota
  client.mjs       client API : limitation de debit, reprises, archivage brut
  plan.mjs         profils de collecte et estimation du cout
  worker.mjs       boucle d'execution reprenable
  derive.mjs       archive brute -> tables normalisees
  cli.mjs          ligne de commande
test/
  mock-api.mjs     faux fournisseur API-Football
  api.test.mjs     tests des routes du backend
  errors.test.mjs  tests des chemins d'erreur, chacun dans un processus isole
  stack.mjs        pile faux fournisseur + application, pour les tests navigateur
  mock-season.mjs  faux fournisseur simulant une saison complete
  collector.test.mjs tests du collecteur
  e2e/             tests d'interface Playwright
.github/workflows/
  ci.yml           integration continue
```

## Licence

MIT.
