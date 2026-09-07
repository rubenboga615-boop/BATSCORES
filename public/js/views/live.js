/** Vue "Direct" : uniquement les rencontres en cours, rafraichies en continu. */
import { api } from '../api.js';
import { leagueBlock, skeletonList, emptyState, errorState } from '../components.js';

const state = { data: null };

function paint(root) {
  const container = root.querySelector('#live-body');
  if (!container) return;
  if (!state.data.groups.length) {
    container.innerHTML = emptyState(
      'Aucun match en direct',
      'Revenez au coup d\'envoi des prochaines rencontres.',
      '📡',
    );
    return;
  }
  container.innerHTML = state.data.groups.map(leagueBlock).join('');
}

export async function renderLive(root) {
  root.innerHTML = `
    <div class="refresh-note"><span class="dot-live"></span> Actualisation automatique</div>
    <div id="live-body">${skeletonList()}</div>`;
  try {
    state.data = await api.liveFixtures();
  } catch (err) {
    root.querySelector('#live-body').innerHTML = errorState(err);
    return;
  }
  paint(root);
}

export async function refreshLive(root) {
  if (!root.querySelector('#live-body')) return;
  try {
    state.data = await api.liveFixtures();
    paint(root);
  } catch {
    /* on conserve l'affichage courant */
  }
}
