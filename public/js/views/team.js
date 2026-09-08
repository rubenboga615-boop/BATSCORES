/** Fiche equipe : identite, derniers resultats et prochaines rencontres. */
import { api } from '../api.js';
import { esc, logo } from '../utils.js';
import { countryName } from '../i18n.js';
import { backLink, matchRow, skeletonList, emptyState, errorState } from '../components.js';

/**
 * Statistiques de saison : l'endpoint le plus riche de l'API et le plus
 * sous-exploite. Series, plus larges scores, buts par quart d'heure,
 * formations, penaltys.
 */
function minuteChart(minutes, against = false) {
  if (!minutes?.length) return '';
  const max = Math.max(...minutes.map((m) => m.total), 1);
  return `
    <div class="minute-bars">
      ${minutes.map((m) => `
        <div class="minute-bar">
          <span class="minute-bar__n">${m.total}</span>
          <span class="minute-bar__col ${against ? 'against' : ''}"
                style="height:${Math.max(3, (m.total / max) * 70)}px"></span>
          <span class="minute-bar__label">${esc(m.range)}</span>
        </div>`).join('')}
    </div>`;
}

function statisticsBlocks(stats) {
  if (!stats?.available) {
    return emptyState(
      'Statistiques indisponibles',
      "Le fournisseur ne publie pas de bilan de saison pour cette equipe.",
      '📊',
    );
  }

  const f = stats.fixtures || {};
  const kv = (rows) => `<div class="kv">${rows.filter(Boolean).map(([k, v]) => `
    <div class="kv__row"><span class="kv__k">${esc(k)}</span><span class="kv__v">${esc(v)}</span></div>`).join('')}</div>`;

  const bilan = kv([
    f.played && ['Matchs joues', `${f.played.total} (${f.played.home} dom. · ${f.played.away} ext.)`],
    f.wins && ['Victoires', `${f.wins.total} (${f.wins.home} dom. · ${f.wins.away} ext.)`],
    f.draws && ['Nuls', f.draws.total],
    f.loses && ['Defaites', f.loses.total],
    stats.goals?.for?.total && ['Buts marques', `${stats.goals.for.total.total} · ${stats.goals.for.average?.total ?? '—'} par match`],
    stats.goals?.against?.total && ['Buts encaisses', `${stats.goals.against.total.total} · ${stats.goals.against.average?.total ?? '—'} par match`],
    stats.cleanSheet && ['Matchs sans encaisser', stats.cleanSheet.total],
    stats.failedToScore && ['Matchs sans marquer', stats.failedToScore.total],
  ]);

  const b = stats.biggest || {};
  const records = kv([
    b.streak?.wins !== undefined && ['Plus longue serie de victoires', b.streak.wins],
    b.streak?.draws !== undefined && ['Plus longue serie de nuls', b.streak.draws],
    b.streak?.loses !== undefined && ['Plus longue serie de defaites', b.streak.loses],
    b.wins?.home && ['Plus large victoire a domicile', b.wins.home],
    b.wins?.away && ['Plus large victoire a l\'exterieur', b.wins.away],
    b.loses?.home && ['Plus lourde defaite a domicile', b.loses.home],
    b.loses?.away && ['Plus lourde defaite a l\'exterieur', b.loses.away],
  ]);

  const p = stats.penalty || {};
  const penalties = p.total ? kv([
    ['Penaltys obtenus', p.total],
    p.scored && ['Marques', `${p.scored.total} · ${p.scored.percentage ?? ''}`],
    p.missed && ['Manques', `${p.missed.total} · ${p.missed.percentage ?? ''}`],
  ]) : '';

  const formations = stats.lineups?.length ? `
    <div class="chips">
      ${stats.lineups.map((l) => `<span class="chip"><strong>${esc(l.formation)}</strong> · ${l.played} match${l.played > 1 ? 's' : ''}</span>`).join('')}
    </div>` : '';

  const form = stats.form ? `
    <div class="chips">
      <span class="form">${String(stats.form).slice(-10).split('').map((c) => `<i class="${c}">${({ W: 'V', D: 'N', L: 'D' })[c] || c}</i>`).join('')}</span>
    </div>` : '';

  return `
    ${form ? `<div class="card"><div class="card__title">Forme recente</div>${form}</div>` : ''}
    <div class="card"><div class="card__title">Bilan de la saison</div>${bilan}</div>
    <div class="card">
      <div class="card__title">Buts marques par tranche de 15 minutes</div>
      ${minuteChart(stats.goals?.for?.minute)}
    </div>
    <div class="card">
      <div class="card__title">Buts encaisses par tranche de 15 minutes</div>
      ${minuteChart(stats.goals?.against?.minute, true)}
    </div>
    ${records ? `<div class="card"><div class="card__title">Records de la saison</div>${records}</div>` : ''}
    ${penalties ? `<div class="card"><div class="card__title">Bilan aux penaltys</div>${penalties}</div>` : ''}
    ${formations ? `<div class="card"><div class="card__title">Formations utilisees</div>${formations}</div>` : ''}`;
}

export async function renderTeam(root, { params, query }) {
  const id = Number(params.id);
  root.innerHTML = `${backLink('#/', 'Retour')}${skeletonList(4)}`;

  let info; let schedule;
  try {
    [info, schedule] = await Promise.all([api.team(id), api.teamFixtures(id)]);
  } catch (err) {
    root.innerHTML = `${backLink('#/', 'Retour')}${errorState(err)}`;
    return;
  }

  const { team, venue } = info;
  const block = (title, matches) => (matches.length
    ? `<div class="section-title">${esc(title)}</div><div class="card">${matches.map(matchRow).join('')}</div>`
    : '');

  // La competition n'est pas toujours connue : on la deduit du dernier match
  // joue, ce qui evite de demander a l'utilisateur de la choisir.
  const league = Number(query?.league) || schedule.last[0]?.league?.id || schedule.next[0]?.league?.id;
  const season = Number(query?.season) || schedule.last[0]?.league?.season || schedule.next[0]?.league?.season;

  let statsHtml = '';
  if (league && season) {
    try {
      const response = await fetch(`/api/teams/${id}/statistics?league=${league}&season=${season}`);
      if (response.ok) statsHtml = statisticsBlocks(await response.json());
    } catch {
      /* la fiche reste utile sans les statistiques */
    }
  }

  root.innerHTML = `
    ${backLink('#/', 'Retour')}
    <div class="mh">
      <div class="mh__main" style="grid-template-columns:auto 1fr">
        ${logo(team.logo, team.name, 'team-logo')}
        <div style="text-align:left">
          <div style="font-size:20px;font-weight:800">${esc(team.name || '')}</div>
          <div style="color:var(--text-faint);font-size:13px;margin-top:4px">
            ${esc(countryName(team.country))}${team.founded ? ` · fonde en ${team.founded}` : ''}
          </div>
          ${venue?.name ? `<div style="color:var(--text-faint);font-size:13px">${esc(venue.name)}${venue.capacity ? ` · ${venue.capacity.toLocaleString('fr-FR')} places` : ''}</div>` : ''}
        </div>
      </div>
    </div>
    ${statsHtml}
    ${block('Prochaines rencontres', schedule.next)}
    ${block('Derniers resultats', schedule.last)}
    ${!schedule.next.length && !schedule.last.length ? emptyState('Aucune rencontre', 'Pas de calendrier disponible pour cette equipe.', '🗓️') : ''}`;
}
