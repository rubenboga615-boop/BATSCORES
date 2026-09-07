/**
 * Etat persistant cote navigateur : favoris et competitions repliees.
 * Aucune donnee ne quitte l'appareil.
 */

const KEY_FIXTURES = 'batscores.favorites.fixtures';
const KEY_LEAGUES = 'batscores.favorites.leagues';
const KEY_COLLAPSED = 'batscores.collapsed';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* mode navigation privee : on continue sans persistance */
  }
}

const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export const store = {
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  favoriteFixtures: () => read(KEY_FIXTURES),
  isFavoriteFixture: (id) => read(KEY_FIXTURES).includes(Number(id)),
  toggleFixture(id) {
    const numeric = Number(id);
    const list = read(KEY_FIXTURES);
    const index = list.indexOf(numeric);
    if (index === -1) list.push(numeric);
    else list.splice(index, 1);
    write(KEY_FIXTURES, list.slice(-100));
    notify();
    return index === -1;
  },

  favoriteLeagues: () => read(KEY_LEAGUES),
  isFavoriteLeague: (id) => read(KEY_LEAGUES).includes(Number(id)),
  toggleLeague(id) {
    const numeric = Number(id);
    const list = read(KEY_LEAGUES);
    const index = list.indexOf(numeric);
    if (index === -1) list.push(numeric);
    else list.splice(index, 1);
    write(KEY_LEAGUES, list);
    notify();
    return index === -1;
  },

  isCollapsed: (key) => read(KEY_COLLAPSED).includes(key),
  toggleCollapsed(key) {
    const list = read(KEY_COLLAPSED);
    const index = list.indexOf(key);
    if (index === -1) list.push(key);
    else list.splice(index, 1);
    write(KEY_COLLAPSED, list);
    return index === -1;
  },
};
