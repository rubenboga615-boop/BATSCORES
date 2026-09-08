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
import { seedPlan, expandPlan, scopeOf } from './plan.mjs';

/**
 * @param {object} options
 * @param {import('node:sqlite').DatabaseSync} options.db
 * @param {Client} options.client
 * @param {number} options.league
 * @param {number} options.season
 * @param {string} [options.profile]
 * @param {number} [options.maxCalls]  plafond d'appels pour CETTE execution
 * @param {(msg: string) => void} [options.log]
 */
export async function runCollector({
  db, client, league, season, profile = 'complet', maxCalls = Infinity, log = () => {},
}) {
  const scope = scopeOf(league, season);

  // Le collecteur est autonome : il cree son plan de depart s'il n'existe pas
  // encore, puis l'etend au fil des donnees. Les deux operations sont
  // idempotentes, une reprise ne recree donc aucune tache.
  seedPlan(db, { league, season, profile });
  expandPlan(db, { league, season, profile });

  const runId = startRun(db, { scope, profile });
  const startCalls = client.callsThisRun;

  let done = 0;
  let failed = 0;
  let stopReason = 'termine';

  const summarise = () => {
    const calls = client.callsThisRun - startCalls;
    finishRun(db, runId, { calls, tasksDone: done, tasksFailed: failed, stopReason });
    return { done, failed, calls, stopReason, counts: taskCounts(db, scope), callsToday: callsToday(db) };
  };

  try {
    collecte: for (;;) {
      const batch = nextTasks(db, 25);

      if (!batch.length) {
        // Plus rien en attente : de nouvelles taches ont-elles pu naitre des
        // donnees fraichement collectees (rencontres, equipes, joueurs) ?
        const created = expandPlan(db, { league, season, profile });
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
              kind: task.kind, endpoint: task.endpoint, params: nextPage, scope, priority: task.priority,
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
