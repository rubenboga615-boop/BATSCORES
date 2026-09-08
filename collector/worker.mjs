/**
 * Boucle d'execution du collecteur.
 *
 * Propriete essentielle : la reprise. L'etat vit en base, pas en memoire.
 * Une interruption — quota epuise, coupure reseau, machine redemarree —
 * n'entraine aucune perte : la reprise repart de la premiere tache en attente.
 */
import { Client, QuotaExhausted, ApiCallError } from './client.mjs';
import {
  nextTasks, markTask, taskCounts, enqueue, paramsKey,
  startRun, finishRun, callsToday,
} from './db.mjs';
import { seedPlan, expandPlan, allowedKinds } from './plan.mjs';

/**
 * Normalise la demande : une cible unique ou une liste, meme traitement.
 *
 * Collecter cinq championnats sur six saisons n'est pas un cas particulier,
 * c'est le cas normal d'une base historique. Garder `league`/`season` au
 * singulier evite de casser les appels existants.
 */
function targetsOf({ targets, league, season }) {
  if (Array.isArray(targets) && targets.length) return targets;
  if (Number.isInteger(league) && Number.isInteger(season)) return [{ league, season }];
  throw new Error('Aucune cible : precisez au moins un championnat et une saison.');
}

/** Libelle compact d'un lot de cibles, pour le journal des executions. */
export function describeTargets(targets) {
  const leagues = [...new Set(targets.map((t) => t.league))];
  const seasons = [...new Set(targets.map((t) => t.season))].sort((a, b) => a - b);
  const shorten = (list) => (list.length > 4
    ? `${list.slice(0, 3).join(',')}+${list.length - 3}`
    : list.join(','));
  return `league:${shorten(leagues)}|season:${shorten(seasons)}`;
}

/**
 * @param {object} options
 * @param {import('node:sqlite').DatabaseSync} options.db
 * @param {Client} options.client
 * @param {Array<{league: number, season: number}>} [options.targets]
 * @param {number} [options.league]  raccourci pour une cible unique
 * @param {number} [options.season]  raccourci pour une cible unique
 * @param {string} [options.profile]
 * @param {number} [options.maxCalls]  plafond d'appels pour CETTE execution
 * @param {(msg: string) => void} [options.log]
 */
export async function runCollector({
  db, client, targets, league, season,
  profile = 'complet', maxCalls = Infinity, log = () => {},
}) {
  const plan = targetsOf({ targets, league, season });
  const scope = describeTargets(plan);

  // Le collecteur est autonome : il cree son plan de depart s'il n'existe pas
  // encore, puis l'etend au fil des donnees. Les deux operations sont
  // idempotentes, une reprise ne recree donc aucune tache.
  for (const target of plan) {
    seedPlan(db, { ...target, profile });
    expandPlan(db, { ...target, profile });
  }

  const runId = startRun(db, { scope, profile });
  const startCalls = client.callsThisRun;

  // Le profil filtre l'execution, pas seulement la planification : des taches
  // ajoutees par un profil plus large restent en attente au lieu d'etre
  // executees ici, et donc de depenser un quota que l'on ne voulait pas.
  const kinds = allowedKinds(profile);

  let done = 0;
  let failed = 0;
  let stopReason = 'termine';

  const summarise = () => {
    const calls = client.callsThisRun - startCalls;
    finishRun(db, runId, { calls, tasksDone: done, tasksFailed: failed, stopReason });
    // Le decompte porte sur la file entiere, pas sur un seul perimetre : avec
    // plusieurs cibles, un compte par perimetre ne dirait rien de l'avancement.
    return { done, failed, calls, stopReason, counts: taskCounts(db), callsToday: callsToday(db) };
  };

  try {
    collecte: for (;;) {
      const batch = nextTasks(db, 25, kinds);

      if (!batch.length) {
        // Plus rien en attente : de nouvelles taches ont-elles pu naitre des
        // donnees fraichement collectees (rencontres, equipes, joueurs) ?
        // Chaque cible est reexaminee : le calendrier d'un championnat vient
        // d'arriver, ses rencontres deviennent autant de taches.
        let created = 0;
        for (const target of plan) created += expandPlan(db, { ...target, profile });
        if (created === 0) break;
        log(`  + ${created} nouvelle(s) tache(s) issue(s) des donnees collectees`);
        continue;
      }

      for (const task of batch) {
        if (client.callsThisRun - startCalls >= maxCalls) {
          stopReason = "plafond d'appels de cette execution atteint";
          break collecte;
        }

        const params = JSON.parse(task.params_json);
        try {
          const { response, paging } = await client.fetch(task.endpoint, params);
          markTask(db, task.id, 'done');
          done += 1;

          // Pagination : la page suivante devient une tache a part entiere.
          if (paging && paging.total > (params.page || 1)) {
            const nextPage = { ...params, page: (params.page || 1) + 1 };
            enqueue(db, {
              kind: task.kind,
              endpoint: task.endpoint,
              params: nextPage,
              // Le perimetre de la page suivante est celui de la tache dont
              // elle decoule, pas celui du lot en cours d'execution.
              scope: task.scope,
              priority: task.priority,
            });
          }

          log(`  ${task.kind} ${paramsKey(params)} -> ${response.length} element(s)`);
        } catch (err) {
          // Deux cas imposent l'arret net, sans consommer d'essai : la tache
          // est remise en file telle quelle pour la prochaine execution.
          if (err instanceof QuotaExhausted) {
            markTask(db, task.id, 'pending');
            stopReason = 'quota journalier epuise';
            break collecte;
          }
          if (err instanceof ApiCallError && err.status === 401) {
            markTask(db, task.id, 'pending');
            stopReason = `cle API refusee : ${err.message}`;
            break collecte;
          }
          // Sinon : une saison non couverte par le plan renvoie une erreur ou
          // une reponse vide. On enregistre et on poursuit le reste.
          markTask(db, task.id, 'failed', String(err.message).slice(0, 500));
          failed += 1;
          log(`  ECHEC ${task.kind} ${paramsKey(params)} : ${err.message}`);
        }
      }
    }
  } catch (err) {
    stopReason = `interrompu : ${err.message}`;
    summarise();
    throw err;
  }

  if (stopReason !== 'termine') log(`\nArret : ${stopReason}.`);
  return summarise();
}
