/** Fiche equipe : identite, derniers resultats et prochaines rencontres. */
import { api } from '../api.js';
import { esc, logo } from '../utils.js';
import { countryName } from '../i18n.js';
import { backLink, matchRow, skeletonList, emptyState, errorState } from '../components.js';

export async function renderTeam(root, { params }) {
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
    ${block('Prochaines rencontres', schedule.next)}
    ${block('Derniers resultats', schedule.last)}
    ${!schedule.next.length && !schedule.last.length ? emptyState('Aucune rencontre', 'Pas de calendrier disponible pour cette equipe.', '🗓️') : ''}`;
}
