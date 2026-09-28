/** Fonctions utilitaires partagees par les vues. */

/** Echappe le texte insere dans du HTML genere. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const isoDay = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return isoDay(date);
}

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_LABELS = ['jan.', 'fev.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.'];

export function dayLabel(dateStr) {
  const today = isoDay(new Date());
  if (dateStr === today) return "Auj.";
  if (dateStr === addDays(today, 1)) return 'Demain';
  if (dateStr === addDays(today, -1)) return 'Hier';
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_LABELS[new Date(y, m - 1, d).getDay()];
}

export function dayNumber(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d}/${String(m).padStart(2, '0')}`;
}

export function longDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAY_LABELS[date.getDay()]} ${d} ${MONTH_LABELS[m - 1]} ${y}`;
}

/** Heure locale du navigateur, a partir de la date ISO renvoyee par l'API. */
export function kickoffTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Libelle court affiche a la place de l'heure selon l'etat du match. */
export function statusLabel(status) {
  const { short, elapsed, phase } = status;
  if (phase === 'live') {
    if (short === 'HT') return 'MT';
    if (short === 'P') return 'TAB';
    if (short === 'BT') return 'Pause';
    if (short === 'SUSP') return 'Susp.';
    if (short === 'INT') return 'Interr.';
    return elapsed !== null ? `${elapsed}'` : 'En cours';
  }
  if (phase === 'finished') {
    if (short === 'AET') return 'ap. p.';
    if (short === 'PEN') return 'tab';
    return 'Term.';
  }
  if (phase === 'cancelled') {
    return { PST: 'Reporte', CANC: 'Annule', ABD: 'Abandonne', AWD: 'Forfait', WO: 'Forfait' }[short] || short;
  }
  return null;
}

/** Balise <img> tolerante aux logos manquants cote fournisseur. */
export function logo(url, alt, cls = '') {
  if (!url) {
    return `<span class="${cls}" style="display:inline-block;width:18px;height:18px"></span>`;
  }
  // Pas de gestionnaire `onerror` en attribut : ce serait du script en ligne,
  // et cela interdirait toute politique de securite du contenu digne de ce nom.
  // L'echec de chargement est traite par un ecouteur delegue dans app.js.
  return `<img class="${cls}" src="${esc(url)}" alt="${esc(alt || '')}" loading="lazy" />`;
}

/** Compare deux valeurs de statistique pour dessiner la barre de repartition. */
export function statRatio(homeValue, awayValue) {
  const toNumber = (v) => {
    if (v === null || v === undefined) return 0;
    const n = parseFloat(String(v).replace('%', ''));
    return Number.isNaN(n) ? 0 : n;
  };
  const h = toNumber(homeValue);
  const a = toNumber(awayValue);
  const total = h + a;
  if (total === 0) return [50, 50];
  return [(h / total) * 100, (a / total) * 100];
}

const STAT_LABELS = {
  'Shots on Goal': 'Tirs cadres',
  'Shots off Goal': 'Tirs non cadres',
  'Total Shots': 'Tirs totaux',
  'Blocked Shots': 'Tirs bloques',
  'Shots insidebox': 'Tirs dans la surface',
  'Shots outsidebox': 'Tirs hors surface',
  Fouls: 'Fautes',
  'Corner Kicks': 'Corners',
  Offsides: 'Hors-jeu',
  'Ball Possession': 'Possession',
  'Yellow Cards': 'Cartons jaunes',
  'Red Cards': 'Cartons rouges',
  'Goalkeeper Saves': 'Arrets du gardien',
  'Total passes': 'Passes totales',
  'Passes accurate': 'Passes reussies',
  'Passes %': 'Precision des passes',
  'expected_goals': 'Buts attendus (xG)',
  'goals_prevented': 'Buts evites',
};

export const statLabel = (type) => STAT_LABELS[type] || type;

const EVENT_ICONS = {
  Goal: '⚽',
  Card: '▮',
  subst: '⇄',
  Var: 'VAR',
};

export function eventIcon(event) {
  if (event.type === 'Card') {
    return event.detail === 'Red Card'
      ? '<span style="color:#ff4d4f">▮</span>'
      : '<span style="color:#f5a623">▮</span>';
  }
  if (event.type === 'Goal') return EVENT_ICONS.Goal;
  if (event.type === 'subst') return '<span style="color:#21c55d">⇄</span>';
  if (event.type === 'Var') return '<span style="color:#9aa8b8;font-size:10px">VAR</span>';
  return '•';
}

const EVENT_DETAILS = {
  'Normal Goal': 'But',
  'Own Goal': 'Contre son camp',
  Penalty: 'Penalty',
  'Missed Penalty': 'Penalty manque',
  'Yellow Card': 'Carton jaune',
  'Second Yellow card': 'Deuxieme jaune',
  'Red Card': 'Carton rouge',
  'Substitution 1': 'Remplacement',
  'Substitution 2': 'Remplacement',
  'Substitution 3': 'Remplacement',
  'Substitution 4': 'Remplacement',
  'Substitution 5': 'Remplacement',
  'Goal cancelled': 'But refuse',
  'Penalty confirmed': 'Penalty accorde',
};

export const eventDetail = (detail) => EVENT_DETAILS[detail] || detail || '';

export function minuteLabel(time) {
  if (!time) return '';
  const extra = time.extra ? `+${time.extra}` : '';
  return `${time.elapsed}${extra}'`;
}

/** Debounce simple pour la recherche au clavier. */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
