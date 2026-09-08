/**
 * Vue "Collecte" : supervision et pilotage du collecteur de donnees.
 *
 * Concue pour etre consultee depuis un telephone pendant qu'une collecte de
 * plusieurs jours tourne sur le serveur : avancement, quota consomme, journal.
 */
import { esc } from '../utils.js';
import { emptyState, errorState, skeletonList } from '../components.js';

const TOKEN_KEY = 'batscores.collector.token';

const state = {
  data: null,
  form: { league: 61, season: 2023, profile: 'complet', maxCalls: '' },
  plan: null,
  planError: null,
  busy: false,
  message: null,
};

const readToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
};
const writeToken = (value) => {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* navigation privee */ }
};

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR'));

function bytes(n) {
  if (!n) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Libelle lisible d'une portee de collecte ("league:61|season:2023"). */
function scopeLabel(scope) {
  const match = /^league:(\d+)\|season:(\d+)$/.exec(scope || '');
  return match ? `Competition ${match[1]} · saison ${match[2]}` : (scope || '—');
}

/* --------------------------------- Blocs ---------------------------------- */

function quotaCard(data) {
  if (!data.quota) return '';
  const { used, limit } = data.quota;
  const pct = Math.min(100, (used / limit) * 100);
  const critical = pct >= 90;
  return `
    <div class="card">
      <div class="card__title">Quota d'aujourd'hui</div>
      <div class="stat">
        <div class="stat__row">
          <span class="stat__value">${fmt(used)}</span>
          <span class="stat__label">appels consommes</span>
          <span class="stat__value">${fmt(limit)}</span>
        </div>
        <div class="stat__bar">
          <i style="width:${pct.toFixed(1)}%;background:${critical ? 'var(--live)' : 'var(--accent)'}"></i>
        </div>
        <div class="stat__label" style="margin-top:6px">
          ${fmt(Math.max(0, limit - used))} appels restants
        </div>
      </div>
    </div>`;
}

function progressCard(data) {
  if (!data.counts) return '';
  const { pending, done, failed } = data.counts;
  const total = pending + done + failed;
  if (!total) return '';
  const pct = (done / total) * 100;
  return `
    <div class="card">
      <div class="card__title">
        Avancement ${data.running ? '<span style="color:var(--live)">· collecte en cours</span>' : ''}
      </div>
      <div class="stat">
        <div class="stat__row">
          <span class="stat__value">${fmt(done)} / ${fmt(total)}</span>
          <span class="stat__label">taches terminees</span>
          <span class="stat__value">${pct.toFixed(0)} %</span>
        </div>
        <div class="stat__bar"><i class="home" style="width:${pct.toFixed(1)}%"></i></div>
      </div>
      <div class="stat">
        <div class="stat__row">
          <span class="stat__label">En attente</span><span class="stat__value">${fmt(pending)}</span>
        </div>
        <div class="stat__row">
          <span class="stat__label">En echec</span>
          <span class="stat__value" style="${failed ? 'color:var(--live)' : ''}">${fmt(failed)}</span>
        </div>
      </div>
    </div>`;
}

function scopesCard(data) {
  if (!data.scopes?.length) return '';
  return `
    <div class="card">
      <div class="card__title">Competitions collectees</div>
      ${data.scopes.map((s) => `
        <div class="list-row" style="cursor:default">
          <div class="list-row__main">
            <div class="list-row__name">${esc(scopeLabel(s.scope))}</div>
            <div class="list-row__sub">
              ${fmt(s.done)} faites · ${fmt(s.pending)} en attente${s.failed ? ` · <span style="color:var(--live)">${fmt(s.failed)} en echec</span>` : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

function contentCard(data) {
  if (!data.tables) return '';
  const labels = {
    fixtures: 'Rencontres',
    fixture_events: 'Faits de match',
    fixture_player_stats: 'Stats joueurs par match',
    player_season_stats: 'Stats joueurs par saison',
    players: 'Joueurs',
    teams: 'Equipes',
    standings: 'Lignes de classement',
    raw_responses: 'Reponses brutes archivees',
  };
  return `
    <div class="card">
      <div class="card__title">Contenu de la base · ${bytes(data.sizeBytes)}</div>
      ${Object.entries(labels).map(([key, label]) => `
        <div class="list-row" style="cursor:default">
          <div class="list-row__main"><div class="list-row__name">${esc(label)}</div></div>
          <span class="list-row__value">${fmt(data.tables[key])}</span>
        </div>`).join('')}
    </div>`;
}

function runsCard(data) {
  if (!data.runs?.length) return '';
  return `
    <div class="card">
      <div class="card__title">Dernieres executions</div>
      ${data.runs.map((r) => `
        <div class="list-row" style="cursor:default">
          <div class="list-row__main">
            <div class="list-row__name">${esc(scopeLabel(r.scope))} · ${esc(r.profile || '')}</div>
            <div class="list-row__sub">
              ${shortDate(r.started_at)} · ${fmt(r.calls)} appels · ${fmt(r.tasks_done)} taches
              ${r.tasks_failed ? ` · <span style="color:var(--live)">${fmt(r.tasks_failed)} en echec</span>` : ''}
              ${r.stop_reason ? `<br>${esc(r.stop_reason)}` : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

function launchCard(data) {
  const { form } = state;
  const disabled = !data.controlEnabled;

  const planBlock = state.planError
    ? `<div class="stat"><div class="stat__label" style="color:var(--live)">${esc(state.planError)}</div></div>`
    : state.plan
      ? `<div class="stat">
           <div class="stat__row">
             <span class="stat__value">${fmt(state.plan.total)}</span>
             <span class="stat__label">appels estimes${state.plan.known ? '' : ' (calendrier pas encore connu)'}</span>
             <span class="stat__value">${state.plan.days} j</span>
           </div>
           <div class="stat__label">
             ${fmt(state.plan.fixtureCount)} rencontres · ${fmt(state.plan.teamCount)} equipes ·
             ${fmt(state.plan.breakdown.perFixture)} appels par rencontre au total
           </div>
           ${state.plan.paginationKnown ? '' : `
             <div class="stat__label" style="margin-top:6px;color:var(--warn)">
               /players est pagine et n'a pas encore ete appele : comptez quelques
               dizaines d'appels de plus pour un grand championnat.
             </div>`}
         </div>`
      : '';

  return `
    <div class="card">
      <div class="card__title">Lancer une collecte</div>
      <div class="stat" style="display:grid;gap:10px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label class="field">
            <span>Competition</span>
            <input type="number" id="col-league" value="${esc(form.league)}" inputmode="numeric" />
          </label>
          <label class="field">
            <span>Saison</span>
            <input type="number" id="col-season" value="${esc(form.season)}" inputmode="numeric" />
          </label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label class="field">
            <span>Profil</span>
            <select id="col-profile">
              ${['essentiel', 'complet', 'total'].map((p) => `
                <option value="${p}" ${p === form.profile ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Limite d'appels</span>
            <input type="number" id="col-max" placeholder="illimite" value="${esc(form.maxCalls)}" inputmode="numeric" />
          </label>
        </div>
        ${planBlock}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="filter" id="col-plan">Estimer le cout</button>
          ${data.running
            ? '<button class="filter" id="col-stop" style="background:var(--live);border-color:var(--live);color:#fff">Arreter la collecte</button>'
            : `<button class="filter is-active" id="col-start" ${disabled ? 'disabled style="opacity:.5"' : ''}>Lancer</button>`}
        </div>
        ${disabled ? `
          <div class="stat__label">
            Le lancement est desactive : definissez <code>COLLECTOR_ADMIN_TOKEN</code> dans
            <code>.env</code> puis redemarrez le serveur. L'estimation, elle, reste disponible
            et ne consomme aucun appel.
          </div>` : `
          <label class="field">
            <span>Jeton de pilotage</span>
            <input type="password" id="col-token" value="${esc(readToken())}" placeholder="COLLECTOR_ADMIN_TOKEN" />
          </label>`}
        ${state.message ? `<div class="stat__label" style="color:${state.message.error ? 'var(--live)' : 'var(--accent)'}">${esc(state.message.text)}</div>` : ''}
      </div>
    </div>`;
}

function logCard(lines) {
  if (!lines?.length) return '';
  return `
    <div class="card">
      <div class="card__title">Journal de la derniere execution</div>
      <pre class="log">${esc(lines.join('\n'))}</pre>
    </div>`;
}

/* --------------------------------- Rendu ---------------------------------- */

async function fetchStatus() {
  const response = await fetch('/api/collector/status');
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error || 'Erreur'), { status: response.status });
  return payload;
}

async function fetchLog() {
  try {
    const response = await fetch('/api/collector/log?lines=40');
    if (!response.ok) return [];
    return (await response.json()).lines || [];
  } catch {
    return [];
  }
}

function paint(root, data, logLines) {
  const body = root.querySelector('#collector-body');
  if (!body) return;

  if (!data.available) {
    body.innerHTML = emptyState('Collecteur indisponible', data.reason, '⚙️');
    return;
  }

  if (!data.dbExists) {
    body.innerHTML = `
      ${emptyState(
        'Aucune collecte pour l\'instant',
        `La base sera creee au premier lancement (${data.dbPath}).`,
        '📦',
      )}
      ${launchCard(data)}`;
    return;
  }

  body.innerHTML = [
    data.running ? '<div class="refresh-note"><span class="dot-live"></span> Collecte en cours — actualisation automatique</div>' : '',
    quotaCard(data),
    progressCard(data),
    launchCard(data),
    logCard(logLines),
    scopesCard(data),
    contentCard(data),
    runsCard(data),
  ].join('');
}

export async function renderCollector(root) {
  root.innerHTML = `<div id="collector-body">${skeletonList(4)}</div>`;
  try {
    state.data = await fetchStatus();
  } catch (err) {
    root.querySelector('#collector-body').innerHTML = errorState(err);
    return;
  }
  const logLines = state.data.dbExists ? await fetchLog() : [];
  paint(root, state.data, logLines);
}

/** Rafraichissement discret pendant qu'une collecte tourne. */
export async function refreshCollector(root) {
  if (!root.querySelector('#collector-body')) return;
  if (!state.data?.running) return;
  try {
    state.data = await fetchStatus();
    paint(root, state.data, await fetchLog());
  } catch {
    /* on conserve l'affichage courant */
  }
}

/* ------------------------------- Interactions ------------------------------ */

function readForm(root) {
  const value = (id) => root.querySelector(id)?.value ?? '';
  state.form = {
    league: Number(value('#col-league')) || 0,
    season: Number(value('#col-season')) || 0,
    profile: value('#col-profile') || 'complet',
    maxCalls: value('#col-max').trim(),
  };
  return state.form;
}

export function bindCollectorEvents(root) {
  root.addEventListener('click', async (event) => {
    const body = root.querySelector('#collector-body');
    if (!body) return;

    if (event.target.closest('#col-plan')) {
      const form = readForm(root);
      state.plan = null;
      state.planError = null;
      state.message = null;
      try {
        const params = new URLSearchParams({
          league: form.league, season: form.season, profile: form.profile,
        });
        const response = await fetch(`/api/collector/plan?${params}`);
        const payload = await response.json();
        if (!response.ok) state.planError = payload.error || 'Estimation impossible.';
        else state.plan = payload;
      } catch (err) {
        state.planError = err.message;
      }
      paint(root, state.data, await fetchLog());
      return;
    }

    if (event.target.closest('#col-start')) {
      const form = readForm(root);
      const token = root.querySelector('#col-token')?.value.trim() || '';
      writeToken(token);
      state.message = null;
      try {
        const response = await fetch('/api/collector/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-collector-token': token },
          body: JSON.stringify({ ...form, maxCalls: form.maxCalls === '' ? null : Number(form.maxCalls) }),
        });
        const payload = await response.json();
        state.message = response.ok
          ? { text: 'Collecte lancee. Elle continue meme si vous fermez cette page.' }
          : { text: payload.error || 'Lancement impossible.', error: true };
      } catch (err) {
        state.message = { text: err.message, error: true };
      }
      await renderCollector(root);
      return;
    }

    if (event.target.closest('#col-stop')) {
      const token = readToken();
      try {
        const response = await fetch('/api/collector/stop', {
          method: 'POST',
          headers: { 'x-collector-token': token },
        });
        const payload = await response.json();
        state.message = response.ok
          ? { text: 'Collecte interrompue. Rien n\'est perdu : la reprise repartira des taches en attente.' }
          : { text: payload.error || 'Arret impossible.', error: true };
      } catch (err) {
        state.message = { text: err.message, error: true };
      }
      await renderCollector(root);
    }
  });
}
