#!/usr/bin/env node
/**
 * Interface en ligne de commande du collecteur.
 *
 *   npm run collect -- plan    --league 61 --season 2023 --profile complet
 *   npm run collect -- run     --league 61 --season 2023 --profile complet
 *   npm run collect -- derive
 *   npm run collect -- status
 */
import 'dotenv/config';
import path from 'node:path';
import { openDatabase, DEFAULT_DB_PATH, taskCounts, usageHistory, callsToday, retryFailed, reopenTasks } from './db.mjs';
import { Client } from './client.mjs';
import { estimate, scopeOf, PROFILES } from './plan.mjs';
import { runCollector } from './worker.mjs';
import { deriveAll } from './derive.mjs';
import { acquireLock, AlreadyRunning, lockState, lockPath, releaseLock } from './lock.mjs';
import { parseLeagues, parseSeasons, targetsOf, leagueName, PRESETS } from './leagues.mjs';
import { exportAll, listTables } from './export.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      opts[name] = true;
    } else {
      opts[name] = next;
      i += 1;
    }
  }
  return { command, opts };
}

const DAILY_LIMIT = Number(process.env.API_FOOTBALL_DAILY_LIMIT) || 7500;
const PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 280;

const fmt = (n) => n.toLocaleString('fr-FR');

function usage() {
  console.log(`
BATSCORES - collecteur de donnees

  plan     Chiffre le cout d'une collecte sans depenser un seul appel
  run      Lance ou reprend la collecte
  derive   Reconstruit les tables normalisees depuis l'archive brute
  status   Etat de la file, du quota et de la base
  retry    Remet les taches en echec dans la file
  cotes    Rouvre le releve des cotes pour en refaire un (trace la derive)
  debloquer Leve un verrou laisse par une collecte interrompue
  ligues   Cherche un championnat et son identifiant
  saisons  Liste les saisons disponibles pour un championnat
  export   Exporte toutes les tables en CSV, JSON ou NDJSON

Options :
  --league <ids>      un ou plusieurs championnats : 61 | 61,39,140 | top5
  --season <annees>   une ou plusieurs saisons : 2023 | 2021,2023 | 2019-2024
  --profile <nom>     ${Object.keys(PROFILES).join(' | ')}   (defaut : complet)
  --max-calls <n>     plafond d'appels pour cette execution
  --db <chemin>       fichier de base (defaut : data/batscores.db)
  --quiet             sortie minimale
  --format <nom>      export : csv | json | ndjson   (defaut : csv)
  --out <dossier>     export : destination           (defaut : export/)
  --tables <liste>    export : se limiter a ces tables
  --with-raw          export : inclure l'archive brute (volumineuse)

Ensembles de championnats : ${Object.keys(PRESETS).join(' | ')}

Exemples :
  npm run collect -- ligues --search "premier"
  npm run collect -- saisons --league 61
  npm run collect -- plan --league top5 --season 2019-2024 --profile total
  npm run collect -- run  --league top5 --season 2019-2024 --profile total
  npm run collect -- cotes --league 61 --season 2023   puis   run --profile complet
  npm run collect -- export --format csv --out ~/batscores-csv

La derive des cotes se construit avec le temps : chaque passage de "cotes"
suivi d'un "run" ajoute un point a la courbe. Un seul releve n'en trace aucune.
`);
}

/**
 * Cibles demandees : un ou plusieurs championnats, une ou plusieurs saisons.
 *
 * Collecter cinq championnats sur six saisons est le cas normal d'une base
 * historique, pas une exception. Une erreur de saisie est fatale ici plutot
 * que silencieuse : se tromper d'identifiant coute des appels payes.
 */
function requireTargets(opts) {
  let leagues; let seasons;
  try {
    leagues = parseLeagues(opts.league ?? opts.leagues);
    seasons = parseSeasons(opts.season ?? opts.seasons);
  } catch (err) {
    console.error(`Erreur : ${err.message}`);
    process.exit(1);
  }

  if (!leagues.length || !seasons.length) {
    console.error('Erreur : --league et --season sont obligatoires.\n');
    console.error('  Un seul championnat, une saison :');
    console.error('    --league 61 --season 2023\n');
    console.error('  Les cinq grands championnats sur six saisons :');
    console.error('    --league top5 --season 2019-2024\n');
    console.error(`  Ensembles disponibles : ${Object.keys(PRESETS).join(', ')}`);
    console.error('  Pour trouver un identifiant : npm run collect -- ligues --search "premier"');
    process.exit(1);
  }
  return { leagues, seasons, targets: targetsOf(leagues, seasons) };
}

/**
 * Perimetres correspondant a une selection, ou liste vide si aucune n'est
 * donnee — auquel cas l'appelant agit sur toute la base.
 */
function scopesFrom(opts) {
  if (!opts.league && !opts.season) return [];
  const leagues = parseLeagues(opts.league ?? opts.leagues);
  const seasons = parseSeasons(opts.season ?? opts.seasons);
  return targetsOf(leagues, seasons).map((t) => scopeOf(t.league, t.season));
}

/**
 * Client vers le fournisseur. La cle est exigee ici plutot que plus loin :
 * echouer avant d'avoir commence vaut mieux qu'echouer a la premiere tache.
 */
function newClient(db) {
  const apiKey = (process.env.API_FOOTBALL_KEY || '').trim();
  if (!apiKey) {
    console.error('Erreur : API_FOOTBALL_KEY absente. Renseignez-la dans .env');
    process.exit(1);
  }
  return new Client({
    db,
    apiKey,
    provider: process.env.API_FOOTBALL_PROVIDER || 'apisports',
    baseUrl: process.env.API_FOOTBALL_BASE_URL,
    dailyLimit: DAILY_LIMIT,
    perMinute: PER_MINUTE,
  });
}

/** Resume lisible d'une selection, affiche avant toute depense. */
function describeSelection(leagues, seasons) {
  const noms = leagues.map((id) => `${leagueName(id)} (${id})`).join(', ');
  const annees = seasons.length === 1
    ? `saison ${seasons[0]}`
    : `saisons ${seasons[0]} a ${seasons[seasons.length - 1]} (${seasons.length})`;
  return `${leagues.length} championnat(s) — ${noms}\n  ${annees}`;
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || opts.help) return usage();

  const db = openDatabase(opts.db || DEFAULT_DB_PATH);
  const profile = opts.profile || 'complet';
  const log = opts.quiet ? () => {} : (msg) => console.log(msg);

  if (command === 'plan') {
    const { leagues, seasons, targets } = requireTargets(opts);

    console.log(`\nPlan de collecte — profil "${profile}"`);
    console.log(`  ${describeSelection(leagues, seasons)}\n`);

    // Lecture pure : estimer ne doit rien engager. Creer les taches ici
    // reviendrait a choisir le profil des l'estimation, et une execution
    // ulterieure les executerait quel que soit le profil demande.
    const totaux = { base: 0, seasonWide: 0, perFixture: 0, perTeam: 0, perPlayer: 0 };
    let total = 0;
    let toutConnu = true;
    let paginationConnue = true;

    const detaille = targets.length <= 12;
    if (detaille) console.log('  Detail par cible :');

    for (const target of targets) {
      const est = estimate(db, { ...target, profile });
      total += est.total;
      toutConnu = toutConnu && est.known;
      paginationConnue = paginationConnue && est.paginationKnown;
      for (const key of Object.keys(totaux)) totaux[key] += est.breakdown[key];
      if (detaille) {
        console.log(
          `    ${String(leagueName(target.league)).padEnd(24)} ${target.season}`
          + `  ${fmt(est.total).padStart(7)} appels${est.known ? '' : ' (estime)'}`,
        );
      }
    }

    console.log(`\n  Repartition des appels :`);
    console.log(`    socle (ligue, equipes, calendrier) ${fmt(totaux.base)}`);
    console.log(`    a l'echelle de la saison           ${fmt(totaux.seasonWide)}`);
    console.log(`    par rencontre                      ${fmt(totaux.perFixture)}`);
    console.log(`    par equipe                         ${fmt(totaux.perTeam)}`);
    console.log(`    par joueur                         ${fmt(totaux.perPlayer)}`);
    console.log(`    ----------------------------------------`);
    console.log(`    TOTAL                              ${fmt(total)} appels`);

    if (!toutConnu) {
      console.log("\n  Note : les calendriers pas encore telecharges sont estimes a partir");
      console.log('  d\'un championnat type. Le total se precisera au fil de la collecte.');
    }
    if (!paginationConnue) {
      console.log("\n  Note : /players est pagine et n'a pas encore ete appele ;");
      console.log('  le total ne compte qu\'une page par saison. Comptez quelques dizaines');
      console.log('  d\'appels supplementaires par grand championnat.');
    }

    const days = total / DAILY_LIMIT;
    console.log(`\n  Soit ${(days).toFixed(1)} jour(s) de quota a ${fmt(DAILY_LIMIT)} appels/jour.`);
    console.log(`  Deja consommes aujourd'hui : ${fmt(callsToday(db))}\n`);
    if (total > DAILY_LIMIT) {
      console.log('  Cette collecte depasse le quota d\'une journee. Le collecteur');
      console.log('  s\'arretera proprement et reprendra ou il en est a la prochaine execution.');
      console.log('  Relancez la meme commande chaque jour jusqu\'a ce qu\'elle se termine.\n');
    }
    return undefined;
  }

  if (command === 'run') {
    const { leagues, seasons, targets } = requireTargets(opts);

    // Verrou partage avec la page Collecte : une seule collecte a la fois,
    // sinon le quota serait consomme deux fois sur la meme base.
    let release;
    try {
      release = acquireLock(opts.db || DEFAULT_DB_PATH);
    } catch (err) {
      if (err instanceof AlreadyRunning) {
        console.error(`\nErreur : ${err.message}\n`);
        console.error(`  verrou : ${lockPath(opts.db || DEFAULT_DB_PATH)}\n`);
        process.exit(1);
      }
      throw err;
    }

    const client = newClient(db);

    console.log(`\nCollecte — profil "${profile}"`);
    console.log(`  ${describeSelection(leagues, seasons)}`);
    console.log(`  ${targets.length} cible(s), quota restant aujourd'hui : ${fmt(client.remainingToday())} appels\n`);

    const result = await runCollector({
      db, client, targets, profile,
      maxCalls: opts['max-calls'] ? Number(opts['max-calls']) : Infinity,
      log,
    });

    console.log(`\n  ${result.done} tache(s) reussie(s), ${result.failed} en echec`);
    console.log(`  ${fmt(result.calls)} appel(s) consommes, ${fmt(result.callsToday)} aujourd'hui au total`);
    console.log(`  File : ${result.counts.pending} en attente, ${result.counts.done} faites, ${result.counts.failed} en echec`);
    console.log(`  Arret : ${result.stopReason}`);

    console.log('\nDerivation des tables normalisees...');
    deriveAll(db, { log });
    console.log('');
    release();
    return undefined;
  }

  if (command === 'derive') {
    console.log('\nReconstruction des tables depuis l\'archive brute (aucun appel API)...\n');
    const report = deriveAll(db, { log });
    const total = Object.values(report).reduce((a, b) => a + b, 0);
    console.log(`\n  ${fmt(total)} ligne(s) ecrite(s).\n`);
    return undefined;
  }

  if (command === 'retry') {
    // Sans perimetre, on rouvre tout : c'est le cas courant apres une saison
    // partiellement couverte par le fournisseur.
    const scopes = scopesFrom(opts);
    const n = scopes.length
      ? scopes.reduce((total, scope) => total + retryFailed(db, scope), 0)
      : retryFailed(db);
    console.log(`${n} tache(s) remise(s) en file.`);
    return undefined;
  }

  if (command === 'export') {
    const format = String(opts.format || 'csv').toLowerCase();
    const outDir = opts.out || path.join(process.cwd(), 'export');
    const tables = opts.tables ? String(opts.tables).split(/[,\s]+/).filter(Boolean) : null;

    console.log(`\nExport ${format} vers ${outDir}\n`);
    let result;
    try {
      result = exportAll(db, {
        outDir, format, tables, includeRaw: Boolean(opts['with-raw']), log,
      });
    } catch (err) {
      console.error(`Erreur : ${err.message}`);
      console.error(`\nTables disponibles : ${listTables(db, { includeRaw: true }).join(', ')}\n`);
      process.exit(1);
    }

    console.log(`\n  ${result.files.length} fichier(s), ${fmt(result.total)} ligne(s) au total.`);
    console.log(`  Manifeste : ${path.join(result.directory, 'manifeste.json')}`);
    if (!opts['with-raw']) {
      console.log("\n  L'archive brute n'est pas incluse : elle est volumineuse et");
      console.log('  redondante avec les tables exportees. Ajoutez --with-raw pour l\'avoir.');
    }
    console.log('');
    return undefined;
  }

  if (command === 'ligues') {
    const search = String(opts.search || '').trim();
    if (!search) {
      console.log('\nChampionnats connus, utilisables sans aucun appel :\n');
      for (const [nom, liste] of Object.entries(PRESETS)) {
        console.log(`  --league ${nom}`);
        for (const l of liste) console.log(`      ${String(l.id).padStart(4)}  ${l.name} — ${l.country}`);
        console.log('');
      }
      console.log('Pour en chercher un autre :  npm run collect -- ligues --search "nom"\n');
      return undefined;
    }

    // Un seul appel, et il leve tout doute sur un identifiant : se tromper de
    // championnat coute une collecte entiere de quota.
    const { response } = await newClient(db).fetch('/leagues', { search });
    console.log(`\n${response.length} resultat(s) pour "${search}" :\n`);
    for (const item of response) {
      const annees = (item.seasons || []).map((y) => y.year);
      const plage = annees.length ? `${Math.min(...annees)}-${Math.max(...annees)}` : 'aucune';
      console.log(`  ${String(item.league?.id).padStart(5)}  ${item.league?.name} — ${item.country?.name}`);
      console.log(`         type ${item.league?.type}, saisons ${plage}`);
    }
    console.log('');
    return undefined;
  }

  if (command === 'saisons') {
    let leagues;
    try {
      leagues = parseLeagues(opts.league ?? opts.leagues);
    } catch (err) {
      console.error(`Erreur : ${err.message}`);
      process.exit(1);
    }
    if (!leagues.length) {
      console.error('Erreur : --league est obligatoire (ex: --league 61, ou --league top5).');
      process.exit(1);
    }

    const client = newClient(db);
    for (const id of leagues) {
      const { response } = await client.fetch('/leagues', { id });
      const item = response[0];
      if (!item) {
        console.log(`\n  ${id} : introuvable chez le fournisseur.`);
        continue;
      }
      console.log(`\n${item.league?.name} — ${item.country?.name} (${id})\n`);
      const seasons = [...(item.seasons || [])].sort((a, b) => b.year - a.year);
      // La couverture dit ce que le plan donne reellement : une saison
      // ancienne peut n'avoir ni compositions ni statistiques, et le savoir
      // avant evite de depenser du quota pour des reponses vides.
      for (const y of seasons) {
        const c = y.coverage || {};
        const f = c.fixtures || {};
        const marques = [
          f.events && 'faits',
          f.lineups && 'compos',
          f.statistics_fixtures && 'stats match',
          f.statistics_players && 'stats joueurs',
          c.standings && 'classement',
          c.players && 'joueurs',
          c.odds && 'cotes',
          c.predictions && 'pronostics',
          c.injuries && 'blessures',
        ].filter(Boolean);
        console.log(
          `  ${y.year}${y.current ? ' (en cours)' : '          '}  ${marques.join(', ') || 'couverture minimale'}`,
        );
      }
      if (seasons.length) {
        const plage = `${seasons[seasons.length - 1].year}-${seasons[0].year}`;
        console.log(`\n  Tout collecter :  npm run collect -- plan --league ${id} --season ${plage} --profile total\n`);
      }
    }
    return undefined;
  }

  if (command === 'debloquer') {
    const dbPath = opts.db || DEFAULT_DB_PATH;
    const state = lockState(dbPath);

    if (!state) {
      // Le fichier peut exister sans designer de collecte vivante : on le
      // retire quand meme, sinon la commande ne servirait a rien dans le seul
      // cas ou l'on en a besoin.
      releaseLock(dbPath);
      console.log('Aucun verrou actif. Vous pouvez relancer une collecte.');
      return undefined;
    }

    if (state.certain && !opts.force) {
      console.error(`\nUne collecte tourne reellement (processus ${state.pid}).`);
      console.error('Lever le verrou ferait tourner deux collectes sur la meme base,');
      console.error('et consommerait le quota deux fois.\n');
      console.error('Pour l\'arreter proprement :  kill ' + state.pid);
      console.error('Pour passer outre malgre tout :  npm run collect -- debloquer --force\n');
      process.exit(1);
    }

    releaseLock(dbPath);
    console.log(`Verrou leve (il designait le processus ${state.pid}).`);
    console.log('Rien n\'est perdu : la reprise repartira de la premiere tache en attente.');
    return undefined;
  }

  if (command === 'cotes') {
    const scopes = scopesFrom(opts);
    const n = scopes.length
      ? scopes.reduce((total, scope) => total + reopenTasks(db, ['fixture_odds'], scope), 0)
      : reopenTasks(db, ['fixture_odds']);
    console.log(`${n} releve(s) de cotes remis en file.`);
    if (n) console.log('Lancez "run" pour les collecter : chaque passage ajoute un point a la derive.');
    else console.log("Aucune tache de cotes : elles ne sont planifiees que sur les profils complet et total, et seulement sur les rencontres non jouees.");
    return undefined;
  }

  if (command === 'status') {
    const counts = taskCounts(db);
    const raw = db.prepare('SELECT COUNT(*) AS n FROM raw_responses').get().n;
    const consommes = callsToday(db);

    console.log('\nEtat du collecteur\n');
    console.log(`  File   : ${fmt(counts.pending)} en attente, ${fmt(counts.done)} faites, ${fmt(counts.failed)} en echec`);
    console.log(`  Archive: ${fmt(raw)} reponse(s) brute(s)`);
    console.log(`  Quota  : ${fmt(consommes)} / ${fmt(DAILY_LIMIT)} appels aujourd'hui`);

    const verrou = lockState(opts.db || DEFAULT_DB_PATH);
    if (verrou) console.log(`  Verrou : collecte en cours (processus ${verrou.pid})`);

    // Avancement par cible : c'est ici qu'on voit qu'une collecte « qui
    // n'avance pas » a en realite fini les cibles semees, ou qu'elle attend
    // le quota de demain.
    const scopes = db.prepare(`
      SELECT scope,
             SUM(state = 'pending') AS pending,
             SUM(state = 'done')    AS done,
             SUM(state = 'failed')  AS failed
      FROM tasks WHERE scope IS NOT NULL GROUP BY scope ORDER BY scope
    `).all();

    if (scopes.length) {
      console.log('\n  Avancement par cible :');
      for (const row of scopes) {
        const total = row.pending + row.done + row.failed;
        const pourcent = total ? Math.round((row.done / total) * 100) : 0;
        const [, ligue, saison] = /league:(\d+)\|season:(\d+)/.exec(row.scope) || [];
        const libelle = ligue ? `${leagueName(Number(ligue))} ${saison}` : row.scope;
        console.log(
          `    ${libelle.padEnd(28)} ${String(pourcent).padStart(3)}%`
          + `  ${fmt(row.done)} faites, ${fmt(row.pending)} en attente`
          + `${row.failed ? `, ${fmt(row.failed)} en echec` : ''}`,
        );
      }
    }

    const tables = ['fixtures', 'fixture_events', 'fixture_player_stats', 'players',
      'teams', 'standings', 'player_season_stats', 'odds_snapshots'];
    console.log('\n  Contenu :');
    for (const table of tables) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      console.log(`    ${table.padEnd(22)} ${fmt(n)}`);
    }

    const derniere = db.prepare(
      'SELECT scope, profile, calls, tasks_done, tasks_failed, stop_reason, started_at, finished_at'
      + ' FROM runs ORDER BY id DESC LIMIT 1',
    ).get();
    if (derniere) {
      console.log('\n  Derniere execution :');
      console.log(`    ${derniere.scope} — profil ${derniere.profile}`);
      console.log(`    ${fmt(derniere.calls)} appel(s), ${fmt(derniere.tasks_done)} tache(s) faite(s), ${fmt(derniere.tasks_failed)} en echec`);
      console.log(`    Arret : ${derniere.stop_reason || 'en cours'}`);
    }

    const history = usageHistory(db, 7);
    if (history.length) {
      console.log('\n  Consommation des derniers jours :');
      for (const row of history) console.log(`    ${row.day}  ${fmt(row.calls)}`);
    }

    // Diagnostic explicite : « ca n'avance pas » a toujours une raison, et
    // elle doit etre lisible sans interpreter des compteurs.
    console.log('\n  Diagnostic :');
    if (verrou) {
      console.log('    Une collecte tourne en ce moment. Suivez-la : npm run collect -- status');
    } else if (counts.pending === 0 && counts.done === 0) {
      console.log('    Rien n\'a encore ete planifie.');
      console.log('    Commencez par :  npm run collect -- plan --league top5 --season 2019-2024');
    } else if (counts.pending === 0) {
      console.log('    Toutes les taches semees sont faites : la collecte est terminee');
      console.log('    pour les cibles demandees jusqu\'ici. Pour aller plus loin,');
      console.log('    ajoutez des championnats ou des saisons :');
      console.log('      npm run collect -- plan --league top5 --season 2015-2024 --profile total');
    } else if (consommes >= DAILY_LIMIT) {
      console.log(`    Quota du jour epuise (${fmt(consommes)} / ${fmt(DAILY_LIMIT)}).`);
      console.log(`    Il reste ${fmt(counts.pending)} tache(s) : relancez la meme commande demain,`);
      console.log('    la collecte repartira exactement ou elle s\'est arretee.');
    } else {
      const restants = DAILY_LIMIT - consommes;
      console.log(`    ${fmt(counts.pending)} tache(s) en attente, ${fmt(restants)} appel(s) disponibles aujourd'hui.`);
      console.log('    Relancez :  npm run collect -- run --league <...> --season <...>');
      if (counts.pending > restants) {
        const jours = Math.ceil(counts.pending / DAILY_LIMIT);
        console.log(`    Il faudra environ ${jours} jour(s) de quota pour tout terminer.`);
      }
    }
    if (counts.failed) {
      console.log(`    ${fmt(counts.failed)} tache(s) en echec — souvent une saison non couverte`);
      console.log('    par le fournisseur. Pour reessayer :  npm run collect -- retry');
    }

    // Cas deroutant : des donnees collectees, mais des tables vides. L'archive
    // brute est bien la, seule la derivation manque — et elle ne coute rien.
    const rencontres = db.prepare('SELECT COUNT(*) AS n FROM fixtures').get().n;
    if (raw > 0 && rencontres === 0) {
      console.log('    L\'archive contient des reponses mais les tables sont vides :');
      console.log('    la derivation n\'a pas encore tourne. Elle ne coute aucun appel :');
      console.log('      npm run collect -- derive');
    }
    console.log('');
    return undefined;
  }

  console.error(`Commande inconnue : ${command}`);
  usage();
  process.exit(1);
  return undefined;
}

main().catch((err) => {
  console.error(`\nErreur : ${err.message}\n`);
  process.exit(1);
});
