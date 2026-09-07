/**
 * Routeur a base de fragment d'URL : fonctionne aussi bien derriere le
 * serveur Node que sur un hebergement statique, sans configuration.
 */

const routes = [];
let notFoundHandler = () => {};
let current = null;

export function route(pattern, handler) {
  // "/match/:id" -> expression reguliere avec groupes nommes
  const names = [];
  const regexSource = pattern
    .replace(/\/+$/, '')
    .replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
      names.push(name);
      return '([^/]+)';
    });
  routes.push({ regex: new RegExp(`^${regexSource || '/'}$`), names, handler });
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

export function currentPath() {
  const hash = window.location.hash.replace(/^#/, '');
  const path = hash.split('?')[0] || '/';
  return path.replace(/\/+$/, '') || '/';
}

export function currentQuery() {
  const hash = window.location.hash.replace(/^#/, '');
  const queryString = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return Object.fromEntries(new URLSearchParams(queryString));
}

export function navigate(path) {
  if (window.location.hash === `#${path}`) {
    resolve();
    return;
  }
  window.location.hash = path;
}

export function resolve() {
  const path = currentPath();
  const query = currentQuery();
  for (const entry of routes) {
    const match = path.match(entry.regex);
    if (!match) continue;
    const params = {};
    entry.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });
    current = path;
    entry.handler({ params, query, path });
    return;
  }
  current = path;
  notFoundHandler({ path });
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  if (!window.location.hash) window.location.hash = '#/';
  else resolve();
}

export const activePath = () => current;
