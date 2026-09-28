/**
 * Lecture de flux RSS et Atom.
 *
 * Ecrit a la main plutot que confie a une bibliotheque : les deux formats
 * tiennent en une poignee de balises, et un analyseur XML generique
 * apporterait une dependance de plus a maintenir sur le serveur pour lire
 * quatre champs.
 *
 * L'analyse est deliberement tolerante. Les flux de presse sont souvent mal
 * formes — entites non echappees, CDATA imbriquees, encodages douteux — et
 * un lecteur strict n'afficherait rien la ou un lecteur tolerant affiche
 * l'essentiel.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç',
  ocirc: 'ô', ugrave: 'ù', icirc: 'î', euro: '€', hellip: '…',
  laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—',
};

/** Decode les entites XML et HTML les plus courantes. */
function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/** Retire les balises d'un resume, souvent livre en HTML. */
function stripTags(text) {
  return decodeEntities(
    String(text)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

/** Contenu d'une balise, CDATA compris. */
function tagContent(block, ...names) {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block);
    if (match) return match[1];
  }
  return null;
}

/** Attribut d'une balise auto-fermante, comme <link href="..."/> en Atom. */
function tagAttribute(block, tag, attribute, filter = () => true) {
  const pattern = new RegExp(`<${tag}\\b([^>]*)\\/?>`, 'gi');
  for (const match of block.matchAll(pattern)) {
    const attrs = match[1];
    if (!filter(attrs)) continue;
    const value = new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, 'i').exec(attrs);
    if (value) return decodeEntities(value[1]);
  }
  return null;
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Analyse un flux RSS 2.0 ou Atom.
 * @param {string} xml
 * @param {number} limit nombre maximal d'articles retenus
 * @returns {{title: string|null, items: Array}}
 */
export function parseFeed(xml, limit = 20) {
  const source = String(xml);
  const isAtom = /<feed[\s>]/i.test(source);
  const entryTag = isAtom ? 'entry' : 'item';

  // Le titre du flux est le premier <title> hors des articles.
  const head = source.split(new RegExp(`<${entryTag}[\\s>]`, 'i'))[0];
  const feedTitle = tagContent(head, 'title');

  const blocks = [...source.matchAll(new RegExp(`<${entryTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${entryTag}>`, 'gi'))];

  const items = [];
  for (const [, block] of blocks) {
    const title = stripTags(tagContent(block, 'title') || '');
    if (!title) continue;

    // En Atom le lien est un attribut ; on ecarte les liens de service
    // (commentaires, edition) au profit du lien de lecture.
    const link = stripTags(tagContent(block, 'link') || '')
      || tagAttribute(block, 'link', 'href', (attrs) => !/rel\s*=\s*["'](self|edit|replies)["']/i.test(attrs))
      || null;

    const published = stripTags(
      tagContent(block, 'pubDate', 'published', 'updated', 'dc:date') || '',
    );
    const date = published ? new Date(published) : null;

    const summary = stripTags(
      tagContent(block, 'description', 'summary', 'content') || '',
    );

    items.push({
      title: truncate(title, 200),
      link,
      summary: truncate(summary, 320),
      publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      image: tagAttribute(block, 'enclosure', 'url', (attrs) => /image/i.test(attrs))
        || tagAttribute(block, 'media:content', 'url')
        || tagAttribute(block, 'media:thumbnail', 'url'),
    });
    if (items.length >= limit) break;
  }

  return { title: feedTitle ? stripTags(feedTitle) : null, items };
}
