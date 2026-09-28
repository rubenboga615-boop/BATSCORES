/**
 * Cotes comparees - ecran autonome de la refonte.
 *
 * Sans rencontre choisie, la page propose les matchs a venir du jour : les
 * cotes ne sont publiees que sur des rencontres non commencees, lister les
 * matchs termines n'offrirait que des pages vides.
 */
import { api } from '../api.js';
import { esc, isoDay, kickoffTime, logo } from '../utils.js';
import { skeletonList, emptyState, errorState } from '../components.js';
import { countryName } from '../i18n.js';

/** Courbe d'un seul releve : une ligne plate dirait faussement "stable". */
function spark(series, outcome) {
  const values = series
    .map((snap) => snap.probabilities?.[outcome])
    .filter((v) => typeof v === 'number');
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 22 - ((v - min) / range) * 20 - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${points}" /></svg>`;
}

function driftCell(move) {
  if (!move) return '<span class="drift is-flat">—</span>';
  const delta = move.delta;
  if (Math.abs(delta) < 0.5) return '<span class="drift is-flat">— stable</span>';
  const up = delta > 0;
  return `<span class="drift ${up ? 'edge-up' : 'edge-down'}">
    ${up ? '▲ +' : '▼ −'}${Math.abs(delta).toFixed(1)} pt</span>`;
}

function marketBlock(market) {
  const latest = market.latest;
  const rows = Object.entries(latest.probabilities).map(([outcome, prob]) => {
    const move = market.drift?.moves.find((m) => m.outcome === outcome);
    return `
      <div class="odd">
        <div class="odd__label">${esc(market.outcomeLabels?.[outcome] || outcome)}</div>
        <div class="odd__price">${esc(String(latest.prices[outcome] ?? '—'))}</div>
        <div class="odd__prob">${prob} %</div>
        <div class="odd__spark">${spark(market.series, outcome)}</div>
        <div class="odd__drift">${driftCell(move)}</div>
      </div>`;
  }).join('');

  const comparison = market.comparison || [];
  const edges = comparison.length
    ? comparison.map((c) => `
        <div class="kv__row">
          <span class="kv__k">${esc(c.label)}</span>
          <span class="kv__v ${c.notable ? (c.edge > 0 ? 'edge-up' : 'edge-down') : ''}">
            modele ${c.model} % · marche ${c.market} % (${c.edge > 0 ? '+' : ''}${c.edge} pt)
          </span>
        </div>`).join('')
    : `<div class="kv__row"><span class="kv__k">Notre modele n'a pas assez de rencontres
         collectees sur cette competition pour se prononcer.</span></div>`;

  const captures = `${market.captures} releve${market.captures > 1 ? 's' : ''}`;
  const window = market.drift ? ` sur ${market.drift.hours} h` : '';
  const books = `mediane de ${latest.bookmakers} bookmaker${latest.bookmakers > 1 ? 's' : ''}`;

  return `
    <section style="margin-bottom:36px">
      <div class="section-title">${esc(market.label)}</div>
      <div class="odd odd--head">
        <div class="odd__label">Issue</div>
        <div class="odd__price">Cote</div>
        <div class="odd__prob">Proba.</div>
        <div class="odd__spark">Courbe</div>
        <div class="odd__drift">Mouvement</div>
      </div>
      ${rows}
      <div class="split" style="margin-top:28px">
        <div class="split__col" style="padding-top:0">
          <div class="section-title">Ecart avec notre modele</div>
          ${edges}
        </div>
        <div class="split__rule"></div>
        <div class="split__col" style="padding-top:0">
          <div class="note">
            Les probabilites affichees sont degonflees de la marge du bookmaker :
            elles totalisent 100 %, contrairement aux cotes brutes. Le mouvement
            compare le dernier releve au premier.
            ${captures}${window}, ${books}, marge retiree de ${latest.margin} %.
          </div>
        </div>
      </div>
    </section>`;
}

/** Liste de choix : les rencontres a venir du jour. */
async function renderPicker(root) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-head__kicker">Marche et modele, face a face</div>
        <h1 class="page-head__title">Cotes comparees</h1>
      </div>
    </div>
    <div id="odds-body">${skeletonList(5)}</div>`;

  const body = root.querySelector('#odds-body');
  let data;
  try {
    data = await api.fixturesByDate(isoDay(new Date()));
  } catch (err) {
    body.innerHTML = errorState(err);
    return;
  }

  const upcoming = data.groups
    .map((group) => ({
      ...group,
      matches: group.matches.filter((m) => m.status.phase === 'scheduled'),
    }))
    .filter((group) => group.matches.length);

  if (!upcoming.length) {
    body.innerHTML = emptyState(
      'Aucune rencontre a venir aujourd\'hui',
      'Les cotes ne sont publiees que sur des matchs non commences. Revenez a la veille d\'une journee de championnat.',
      '💱',
    );
    return;
  }

  body.innerHTML = `
    <p class="lede" style="margin:20px 0 8px">
      Choisissez une rencontre : la page en donne les probabilites nettes de marge,
      leur mouvement depuis le premier releve, et l'ecart avec notre propre modele.
    </p>
    ${upcoming.map((group) => `
      <section class="league">
        <header class="league__head" style="cursor:default">
          ${logo(group.league.flag || group.league.logo, group.league.country, 'league__flag')}
          <span class="league__country">${esc(countryName(group.league.country))}</span>
          <span class="league__name">${esc(group.league.name || '')}</span>
          <span class="league__count">${group.matches.length}</span>
        </header>
        ${group.matches.map((m) => `
          <a class="list-row" href="#/cotes?match=${m.id}">
            <div class="list-row__main">
              <div class="list-row__name">${esc(m.home.name)} – ${esc(m.away.name)}</div>
              <div class="list-row__sub">${esc(kickoffTime(m.date))}</div>
            </div>
            <span class="list-row__value" style="color:var(--accent);font-size:12px">Cotes →</span>
          </a>`).join('')}
      </section>`).join('')}`;
}

export async function renderOdds(root, { query } = {}) {
  const id = query?.match;
  if (!id) return renderPicker(root);

  root.innerHTML = `
    <a class="back-link" href="#/cotes">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15.4 7.4L14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" fill="currentColor"/></svg>
      Toutes les rencontres
    </a>
    <div id="odds-body">${skeletonList(4)}</div>`;

  const body = root.querySelector('#odds-body');
  let data;
  try {
    data = await fetch(`/api/odds/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload.error || `Erreur ${response.status}`);
          error.status = response.status;
          throw error;
        }
        return payload;
      });
  } catch (err) {
    body.innerHTML = errorState(err);
    return;
  }

  const fixture = data.fixture;
  const title = fixture ? `${fixture.home.name} – ${fixture.away.name}` : 'Rencontre';

  if (!data.markets?.length) {
    body.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-head__kicker">${esc(title)}</div>
          <h1 class="page-head__title">Cotes comparees</h1>
        </div>
      </div>
      ${emptyState('Cotes indisponibles', data.diagnostic || 'Aucune cote pour cette rencontre.', '💱')}`;
    return;
  }

  const markets = data.markets.map((m) => esc(m.label)).join(' · ');

  body.innerHTML = `
    <div class="page-head" style="display:block">
      <div class="page-head__kicker">${esc(title)} · ${markets}</div>
      <h1 class="page-head__title" style="max-width:900px;text-wrap:pretty">
        Probabilites nettes de marge, et derive depuis le premier releve
      </h1>
    </div>
    <div style="margin-top:24px">
      ${data.markets.map(marketBlock).join('')}
      ${data.diagnostic ? `<div class="note note--sm">${esc(data.diagnostic)}</div>` : ''}
    </div>`;
}
