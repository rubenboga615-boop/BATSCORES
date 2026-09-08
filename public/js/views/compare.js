/**
 * Comparateur d'equipes.
 *
 * Deux bilans de saison mis face a face, indicateur par indicateur. Chaque
 * ligne est une barre partagee : la longueur dit l'ecart, la couleur dit qui
 * a l'avantage. Les indicateurs sans direction (matchs joues, part de nuls)
 * n'ont pas de gagnant et restent neutres, sinon la lecture ment.
 */
import { esc, logo } from '../utils.js';
import { backLink, emptyState, errorState, skeletonList } from '../components.js';

function formChips(form) {
  if (!form) return '';
  return `<span class="form">${String(form).slice(-6).split('').map((c) => `<i class="${c}">${({ W: 'V', D: 'N', L: 'D' })[c] || c}</i>`).join('')}</span>`;
}

function metricRow(row) {
  const fmt = (v) => (v === null ? '—' : `${v}${row.unit}`);
  return `
    <div class="versus">
      <div class="versus__value ${row.leader === 'a' ? 'is-leader' : ''}">${esc(fmt(row.a))}</div>
      <div class="versus__body">
        <div class="versus__label">${esc(row.label)}</div>
        <div class="versus__bar ${row.neutral ? 'is-neutral' : ''}">
          <i class="a" style="width:${row.shareA}%"></i>
          <i class="b" style="width:${(100 - row.shareA).toFixed(1)}%"></i>
        </div>
      </div>
      <div class="versus__value ${row.leader === 'b' ? 'is-leader' : ''}">${esc(fmt(row.b))}</div>
    </div>`;
}

/**
 * Buts par tranche de quinze minutes, les deux equipes sur le meme axe.
 * L'echelle est commune, sans quoi deux profils tres differents auraient
 * l'air identiques.
 */
function minuteComparison(minutes, teams, against = false) {
  const side = against ? 'against' : 'for';
  const a = minutes.a[side];
  const b = minutes.b[side];
  if (!a?.length || !b?.length) return '';
  const max = Math.max(...a.map((m) => m.total), ...b.map((m) => m.total), 1);
  const column = (list, index, cls) => {
    const value = list[index]?.total ?? 0;
    return `<span class="minute-bar__col ${cls}" style="height:${Math.max(3, (value / max) * 64)}px"
                  title="${value} but${value > 1 ? 's' : ''}"></span>`;
  };
  return `
    <div class="minute-bars minute-bars--versus">
      ${a.map((slot, i) => `
        <div class="minute-bar">
          <span class="minute-bar__pair">
            ${column(a, i, 'a')}
            ${column(b, i, 'b')}
          </span>
          <span class="minute-bar__label">${esc(slot.range)}</span>
        </div>`).join('')}
    </div>
    <div class="versus__legend">
      <span class="dot a"></span>${esc(teams.a.name)}
      <span class="dot b"></span>${esc(teams.b.name)}
      <span class="versus__scale">echelle commune : 0 a ${max} but${max > 1 ? 's' : ''}</span>
    </div>`;
}

export async function renderCompare(root, { query }) {
  const { a, b, league, season } = query || {};
  root.innerHTML = `${backLink('#/', 'Retour')}${skeletonList(4)}`;

  if (!a || !b || !league) {
    root.innerHTML = `${backLink('#/', 'Retour')}${emptyState(
      'Comparaison impossible',
      "Ouvrez une rencontre et utilisez le bouton « Comparer les deux equipes ».",
      '⇄',
    )}`;
    return;
  }

  let data;
  try {
    const params = new URLSearchParams({ a, b, league, season: season || '' });
    const response = await fetch(`/api/compare?${params}`);
    data = await response.json();
    if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  } catch (err) {
    root.innerHTML = `${backLink('#/', 'Retour')}${errorState(err)}`;
    return;
  }

  if (!data.available) {
    root.innerHTML = `${backLink('#/', 'Retour')}${emptyState(
      'Comparaison indisponible',
      data.diagnostic || "Pas de bilan de saison pour ces equipes.",
      '📊',
    )}`;
    return;
  }

  const { teams, rows, advantages, minutes } = data;
  const verdict = advantages.a === advantages.b
    ? 'Les deux equipes se partagent les avantages.'
    : `${advantages.a > advantages.b ? teams.a.name : teams.b.name} devance sur `
      + `${Math.max(advantages.a, advantages.b)} des ${advantages.a + advantages.b} indicateurs departages.`;

  const head = (team, cls) => `
    <div class="versus-head__team ${cls}">
      ${logo(team.logo, team.name, 'team-logo')}
      <a href="#/equipe/${team.id}">${esc(team.name || '')}</a>
      ${formChips(team.form)}
    </div>`;

  root.innerHTML = `
    ${backLink('#/', 'Retour')}
    <div class="card versus-head">
      ${head(teams.a, 'a')}
      <div class="versus-head__vs">contre</div>
      ${head(teams.b, 'b')}
    </div>
    <div class="card">
      <div class="stat"><div class="stat__label">${esc(verdict)}
        Saison ${esc(String(data.league.season))}. Les taux sont ramenes au match
        pour que deux equipes n'ayant pas joue le meme nombre de rencontres
        restent comparables.</div></div>
    </div>
    <div class="card">
      <div class="card__title">Indicateurs de la saison</div>
      ${rows.map(metricRow).join('')}
      <div class="stat"><div class="stat__label">
        La barre penche du cote favorise : sur les buts encaisses ou les
        cartons, c'est la valeur la plus basse qui l'emporte. Les lignes grises
        ne departagent personne.
      </div></div>
    </div>
    <div class="card">
      <div class="card__title">Buts marques par tranche de 15 minutes</div>
      ${minuteComparison(minutes, teams)}
    </div>
    <div class="card">
      <div class="card__title">Buts encaisses par tranche de 15 minutes</div>
      ${minuteComparison(minutes, teams, true)}
    </div>`;
}
