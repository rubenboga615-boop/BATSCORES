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
import { openDatabase, DEFAULT_DB_PATH, taskCounts, usageHistory, callsToday, retryFailed } from './db.mjs';
import { Client } from './client.mjs';
import { estimate, scopeOf, PROFILES } from './plan.mjs';
import { runCollector } from './worker.mjs';
import { deriveAll } from './derive.mjs';

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

Options :
  --league <id>       identifiant de competition (61 = Ligue 1)
  --season <annee>    saison (2023 = saison 2023-2024)
  --profile <nom>     ${Object.keys(PROFILES).join(' | ')}   (defaut : complet)
  --max-calls <n>     plafond d'appels pour cette execution
  --db <chemin>       fichier de base (defaut : data/batscores.db)
  --quiet             sortie minimale

Exemple :
  npm run collect -- plan --league 61 --season 2023 --profile complet
`);
}

function requireScope(opts) {
  const league = Number(opts.league);
  const season = Number(opts.season);
  if (!Number.isInteger(league) || !Number.isInteger(season)) {
    console.error('Erreur : --league et --season sont obligatoires (ex: --league 61 --season 2023).');
    process.exit(1);
  }
  return { league, season };
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || opts.help) return usage();

  const db = openDatabase(opts.db || DEFAULT_DB_PATH);
  const profile = opts.profile || 'complet';
  const log = opts.quiet ? () => {} : (msg) => console.log(msg);

  if (command === 'plan') {
    const { league, season } = requireScope(opts);
    // Lecture pure : estimer ne doit rien engager. Creer les taches ici
    // reviendrait a choisir le profil des l'estimation, et une execution
    // ulterieure les executerait quel que soit le profil demande.
    const est = estimate(db, { league, season, profile });

    console.log(`\nPlan de collecte — competition ${league}, saison ${season}, profil "${profile}"\n`);
    console.log(est.known
      ? `  Base sur les donnees deja collectees : ${est.fixtureCount} rencontres, ${est.teamCount} equipes`
      : `  Estimation a priori : ${est.fixtureCount} rencontres, ${est.teamCount} equipes (calendrier pas encore telecharge)`);
    console.log('\n  Repartition des appels :');
    console.log(`    socle (ligue, equipes, calendrier) ${fmt(est.breakdown.base)}`);
    console.log(`    a l'echelle de la saison           ${fmt(est.breakdown.seasonWide)}`);
    console.log(`    par rencontre                      ${fmt(est.breakdown.perFixture)}`);
    console.log(`    par equipe                         ${fmt(est.breakdown.perTeam)}`);
    console.log(`    par joueur                         ${fmt(est.breakdown.perPlayer)}`);
    console.log(`    ----------------------------------------`);
    console.log(`    TOTAL                              ${fmt(est.total)} appels`);
    if (!est.paginationKnown) {
      console.log("\n  Note : /players est pagine et n'a pas encore ete appele ;");
      console.log('  le total ne compte qu\'une page. Comptez quelques dizaines');
      console.log('  d\'appels supplementaires pour un grand championnat.');
    }

    const days = est.total / DAILY_LIMIT;
    console.log(`\n  Soit ${(days).toFixed(1)} jour(s) de quota a ${fmt(DAILY_LIMIT)} appels/jour.`);
    console.log(`  Deja consommes aujourd'hui : ${fmt(callsToday(db))}\n`);
    if (est.total > DAILY_LIMIT) {
      console.log('  Cette collecte depasse le quota d\'une journee. Le collecteur');
      console.log('  s\'arretera proprement et reprendra ou il en est a la prochaine execution.\n');
    }
    return undefined;
  }

  if (command === 'run') {
    const { league, season } = requireScope(opts);
    const apiKey = (process.env.API_FOOTBALL_KEY || '').trim();
    if (!apiKey) {
      console.error('Erreur : API_FOOTBALL_KEY absente. Renseignez-la dans .env');
      process.exit(1);
    }

    const client = new Client({
      db,
      apiKey,
      provider: process.env.API_FOOTBALL_PROVIDER || 'apisports',
      baseUrl: process.env.API_FOOTBALL_BASE_URL,
      dailyLimit: DAILY_LIMIT,
      perMinute: PER_MINUTE,
    });

    console.log(`\nCollecte — competition ${league}, saison ${season}, profil "${profile}"`);
    console.log(`  quota restant aujourd'hui : ${fmt(client.remainingToday())} appels\n`);

    const result = await runCollector({
      db, client, league, season, profile,
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
    const scope = opts.league && opts.season
      ? scopeOf(Number(opts.league), Number(opts.season))
      : null;
    const n = retryFailed(db, scope);
    console.log(`${n} tache(s) remise(s) en file.`);
    return undefined;
  }

  if (command === 'status') {
    const counts = taskCounts(db);
    const raw = db.prepare('SELECT COUNT(*) AS n FROM raw_responses').get().n;
    console.log('\nEtat du collecteur\n');
    console.log(`  File   : ${counts.pending} en attente, ${counts.done} faites, ${counts.failed} en echec`);
    console.log(`  Archive: ${fmt(raw)} reponse(s) brute(s)`);
    console.log(`  Quota  : ${fmt(callsToday(db))} / ${fmt(DAILY_LIMIT)} appels aujourd'hui`);

    const tables = ['fixtures', 'fixture_events', 'fixture_player_stats', 'players',
      'teams', 'standings', 'player_season_stats'];
    console.log('\n  Contenu :');
    for (const table of tables) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      console.log(`    ${table.padEnd(22)} ${fmt(n)}`);
    }

    const history = usageHistory(db, 7);
    if (history.length) {
      console.log('\n  Consommation des derniers jours :');
      for (const row of history) console.log(`    ${row.day}  ${fmt(row.calls)}`);
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
