/** Acces au backend BATSCORES. Le navigateur ne voit jamais la cle API. */

const inFlight = new Map();

async function request(path) {
  if (inFlight.has(path)) return inFlight.get(path);

  const promise = (async () => {
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Erreur ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  })();

  inFlight.set(path, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(path);
  }
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, v);
  }
  const str = search.toString();
  return str ? `?${str}` : '';
};

export const api = {
  config: () => request('/api/config'),
  fixturesByDate: (date) => request(`/api/fixtures${qs({ date })}`),
  liveFixtures: () => request('/api/fixtures/live'),
  fixture: (id) => request(`/api/fixtures/${id}`),
  teamFixtures: (id) => request(`/api/fixtures/team/${id}`),
  competitions: () => request('/api/competitions'),
  standings: (id, season) => request(`/api/competitions/${id}/standings${qs({ season })}`),
  competitionFixtures: (id, season) => request(`/api/competitions/${id}/fixtures${qs({ season })}`),
  scorers: (id, season) => request(`/api/competitions/${id}/scorers${qs({ season })}`),
  team: (id) => request(`/api/teams/${id}`),
  search: (q) => request(`/api/search${qs({ q })}`),
  favorites: (ids) => request(`/api/favorites${qs({ ids: ids.join(',') })}`),
};
