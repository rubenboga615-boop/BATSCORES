/**
 * Selection des championnats et des saisons.
 *
 * Une erreur de saisie ici ne se voit pas : elle se paie en appels depenses
 * sur la mauvaise competition. Les cas limites sont donc traites comme des
 * erreurs franches, pas comme des valeurs par defaut silencieuses.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { parseLeagues, parseSeasons, targetsOf, PRESETS, TOP5, leagueName } =
  await import('../collector/leagues.mjs');

describe('choix des championnats', () => {
  test('les cinq grands championnats sont fournis sous un nom', () => {
    const ids = parseLeagues('top5');
    assert.equal(ids.length, 5);
    assert.deepEqual(ids, TOP5.map((l) => l.id));
    // Les identifiants ne sont pas devinables : ils doivent etre stables.
    assert.ok(ids.includes(61), 'Ligue 1');
    assert.ok(ids.includes(39), 'Premier League');
  });

  test('identifiants et ensembles se melangent', () => {
    const ids = parseLeagues('top5,2,3');
    assert.equal(ids.length, 7);
    assert.ok(ids.includes(2) && ids.includes(3));
  });

  test('les doublons sont ecartes sans bruit', () => {
    assert.deepEqual(parseLeagues('61,61,61'), [61]);
    // "top5" contient deja la Ligue 1 : la redemander ne la collecte pas deux fois.
    assert.equal(parseLeagues('top5,61').length, 5);
  });

  test('les separateurs usuels sont acceptes', () => {
    assert.deepEqual(parseLeagues('61, 39  140'), [61, 39, 140]);
  });

  test('une saisie fautive est refusee, avec la liste des ensembles', () => {
    assert.throws(() => parseLeagues('premier-league'), /Championnat inconnu/);
    assert.throws(() => parseLeagues('top6'), /top5/);
    assert.throws(() => parseLeagues('-3'), /Championnat inconnu/);
  });

  test('une selection vide reste vide plutot que de tout prendre', () => {
    // Collecter par defaut « tout » sur une faute de frappe couterait une
    // fortune en quota.
    assert.deepEqual(parseLeagues(''), []);
    assert.deepEqual(parseLeagues(undefined), []);
  });

  test('chaque ensemble est non vide et sans doublon', () => {
    for (const [nom, liste] of Object.entries(PRESETS)) {
      assert.ok(liste.length > 0, `${nom} est vide`);
      const ids = liste.map((l) => l.id);
      assert.equal(new Set(ids).size, ids.length, `${nom} contient un doublon`);
      for (const l of liste) {
        assert.ok(Number.isInteger(l.id) && l.id > 0, `${nom} : identifiant invalide`);
        assert.ok(l.name && l.country, `${nom} : libelle incomplet`);
      }
    }
  });

  test('un identifiant connu se traduit en nom lisible', () => {
    assert.equal(leagueName(61), 'Ligue 1');
    assert.match(leagueName(99999), /99999/, 'un inconnu reste identifiable');
  });
});

describe('choix des saisons', () => {
  test('une plage est inclusive aux deux bouts', () => {
    // "2019-2024" doit donner six saisons. En donner cinq perdrait une annee
    // entiere sans que personne ne s'en apercoive.
    assert.deepEqual(parseSeasons('2019-2024'), [2019, 2020, 2021, 2022, 2023, 2024]);
  });

  test('listes, plages et valeurs isolees se combinent', () => {
    assert.deepEqual(parseSeasons('2015,2019-2021,2024'), [2015, 2019, 2020, 2021, 2024]);
  });

  test('le resultat est trie et sans doublon', () => {
    assert.deepEqual(parseSeasons('2021,2019,2021,2020'), [2019, 2020, 2021]);
  });

  test('une plage a l\'envers est une erreur, pas un silence', () => {
    assert.throws(() => parseSeasons('2024-2019'), /a l'envers/);
  });

  test('une plage demesuree est refusee', () => {
    assert.throws(() => parseSeasons('1900-2100'), /demesuree/);
  });

  test('une annee absurde est refusee', () => {
    assert.throws(() => parseSeasons('23'), /Saison invalide/);
    assert.throws(() => parseSeasons('saison'), /Saison invalide/);
  });
});

describe('cibles a collecter', () => {
  test('chaque championnat est croise avec chaque saison', () => {
    const targets = targetsOf([61, 39], [2023, 2024]);
    assert.equal(targets.length, 4);
  });

  test('l\'ordre parcourt saison par saison, pas championnat par championnat', () => {
    // Une collecte interrompue par le quota doit laisser des saisons
    // completes, pas cinq championnats a moitie faits.
    const targets = targetsOf([61, 39, 140], [2023, 2024]);
    assert.deepEqual(
      targets.map((t) => `${t.league}/${t.season}`),
      ['61/2023', '39/2023', '140/2023', '61/2024', '39/2024', '140/2024'],
    );
  });

  test('cinq championnats sur six saisons font trente cibles', () => {
    assert.equal(targetsOf(parseLeagues('top5'), parseSeasons('2019-2024')).length, 30);
  });
});
