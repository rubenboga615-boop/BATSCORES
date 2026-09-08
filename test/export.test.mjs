/**
 * Export de la base.
 *
 * Le piege est le CSV : les colonnes contiennent du JSON, donc des guillemets
 * et des sauts de ligne. Un echappement fautif decale toutes les colonnes
 * suivantes, et l'erreur ne se voit qu'a la relecture — parfois des mois plus
 * tard. Les tests relisent donc ce qui a ete ecrit.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);

if (!hasSqlite) {
  test('export', { skip: 'node:sqlite requiert Node 22 ou superieur' }, () => {});
} else {
  const { openDatabase } = await import('../collector/db.mjs');
  const { exportAll, listTables, csvCell, csvRow } = await import('../collector/export.mjs');

  const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'batscores-export-'));

  /** Base minimale, avec les valeurs qui cassent un CSV naif. */
  function seeded() {
    const db = openDatabase(':memory:');
    db.prepare(`INSERT INTO fixtures
      (id, date, timestamp, status_short, league_id, season, home_team_id, away_team_id,
       goals_home, goals_away, referee, venue_name)
      VALUES (?, ?, ?, 'FT', 61, 2023, 85, 81, 3, 1, ?, ?)`)
      .run(1001, '2026-09-08T20:00:00+00:00', 1789000000,
        'C. Turpin, arbitre', 'Stade "Parc des Princes"');
    db.prepare(`INSERT INTO fixtures
      (id, date, timestamp, status_short, league_id, season, home_team_id, away_team_id,
       goals_home, goals_away, referee)
      VALUES (?, ?, ?, 'FT', 61, 2023, 80, 91, 0, 0, ?)`)
      .run(1002, '2026-09-09T20:00:00+00:00', 1789086400, 'Ligne 1\nLigne 2');
    db.prepare('INSERT INTO bookmakers (id, name) VALUES (?, ?)').run(8, 'Bet365');
    return db;
  }

  /** Analyseur CSV minimal, pour relire ce que l'export a produit. */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
        } else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  describe('echappement CSV', () => {
    test('une valeur ordinaire n\'est pas entouree de guillemets', () => {
      assert.equal(csvCell('Marseille'), 'Marseille');
      assert.equal(csvCell(42), '42');
    });

    test('une valeur absente devient une case vide', () => {
      assert.equal(csvCell(null), '');
      assert.equal(csvCell(undefined), '');
      // Mais un zero est une valeur, pas une absence.
      assert.equal(csvCell(0), '0');
    });

    test('virgules, guillemets et sauts de ligne sont proteges', () => {
      assert.equal(csvCell('a,b'), '"a,b"');
      assert.equal(csvCell('il a dit "oui"'), '"il a dit ""oui"""');
      assert.equal(csvCell('deux\nlignes'), '"deux\nlignes"');
    });

    test('une ligne complete se relit a l\'identique', () => {
      const valeurs = ['Paris', 'a,b', 'guillemet "', 'saut\nligne', null, 3];
      assert.deepEqual(parseCsv(`${csvRow(valeurs)}\n`)[0], ['Paris', 'a,b', 'guillemet "', 'saut\nligne', '', '3']);
    });
  });

  describe('export complet', () => {
    test('chaque table donne un fichier, et le contenu se relit', () => {
      const db = seeded();
      const dir = tempDir();
      const result = exportAll(db, { outDir: dir, format: 'csv' });

      const fichier = path.join(dir, 'fixtures.csv');
      assert.ok(fs.existsSync(fichier));

      const lignes = parseCsv(fs.readFileSync(fichier, 'utf8')).filter((r) => r.length > 1);
      const entete = lignes[0];
      assert.ok(entete.includes('id') && entete.includes('goals_home'));
      assert.equal(lignes.length, 3, 'un en-tete et deux rencontres');

      // Les valeurs piegeuses doivent revenir intactes.
      const parId = new Map(lignes.slice(1).map((r) => [r[entete.indexOf('id')], r]));
      assert.equal(parId.get('1001')[entete.indexOf('referee')], 'C. Turpin, arbitre');
      assert.equal(parId.get('1001')[entete.indexOf('venue_name')], 'Stade "Parc des Princes"');
      assert.equal(parId.get('1002')[entete.indexOf('referee')], 'Ligne 1\nLigne 2');

      assert.equal(result.files.find((f) => f.table === 'fixtures').rows, 2);
      db.close();
    });

    test('une table vide produit un fichier avec ses colonnes, pas un fichier vide', () => {
      const db = seeded();
      const dir = tempDir();
      exportAll(db, { outDir: dir, format: 'csv' });
      const contenu = fs.readFileSync(path.join(dir, 'players.csv'), 'utf8');
      assert.match(contenu, /^id,name/, "l'en-tete doit exister meme sans donnees");
      db.close();
    });

    test('le JSON produit est valide, y compris pour une table vide', () => {
      const db = seeded();
      const dir = tempDir();
      exportAll(db, { outDir: dir, format: 'json' });

      const fixtures = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures.json'), 'utf8'));
      assert.equal(fixtures.length, 2);
      assert.equal(fixtures[0].goals_home, 3);

      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'players.json'), 'utf8')), []);
      db.close();
    });

    test('le NDJSON donne une ligne JSON par enregistrement', () => {
      const db = seeded();
      const dir = tempDir();
      exportAll(db, { outDir: dir, format: 'ndjson' });
      const lignes = fs.readFileSync(path.join(dir, 'fixtures.ndjson'), 'utf8')
        .split('\n').filter(Boolean);
      assert.equal(lignes.length, 2);
      for (const ligne of lignes) assert.ok(JSON.parse(ligne).id);
      db.close();
    });

    test('un manifeste decrit l\'export', () => {
      const db = seeded();
      const dir = tempDir();
      exportAll(db, { outDir: dir, format: 'csv' });
      const manifeste = JSON.parse(fs.readFileSync(path.join(dir, 'manifeste.json'), 'utf8'));
      assert.equal(manifeste.format, 'csv');
      assert.ok(manifeste.exportedAt);
      assert.equal(manifeste.tables.find((t) => t.table === 'fixtures').rows, 2);
      db.close();
    });

    test('les tables techniques et l\'archive brute restent en dehors', () => {
      const db = seeded();
      const tables = listTables(db);
      // La file de taches et le journal decrivent la collecte, pas le football.
      for (const interne of ['tasks', 'api_usage', 'runs', 'raw_responses']) {
        assert.ok(!tables.includes(interne), `${interne} ne doit pas etre exportee par defaut`);
      }
      assert.ok(listTables(db, { includeRaw: true }).includes('raw_responses'));
      db.close();
    });

    test('on peut n\'exporter que les tables voulues', () => {
      const db = seeded();
      const dir = tempDir();
      const result = exportAll(db, { outDir: dir, format: 'csv', tables: ['fixtures', 'bookmakers'] });
      assert.equal(result.files.length, 2);
      assert.ok(!fs.existsSync(path.join(dir, 'players.csv')));
      db.close();
    });

    test('une table ou un format inconnu est refuse, pas ignore', () => {
      const db = seeded();
      const dir = tempDir();
      assert.throws(() => exportAll(db, { outDir: dir, tables: ['inexistante'] }), /Table inconnue/);
      assert.throws(() => exportAll(db, { outDir: dir, format: 'xml' }), /Format inconnu/);
      db.close();
    });
  });
}
