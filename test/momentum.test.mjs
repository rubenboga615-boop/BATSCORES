/**
 * Le momentum est un indice, pas une mesure : ce qui doit etre garanti, c'est
 * qu'il pointe dans le bon sens et qu'il ne fabrique rien a partir de rien.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { momentumSeries, dominanceShare, momentumChart } = await import('../public/js/momentum.js');

const fixture = {
  home: { id: 10, name: 'Domicile' },
  away: { id: 20, name: 'Visiteur' },
};

const goal = (minute, team) => ({
  time: { elapsed: minute, extra: null },
  team: { id: team },
  type: 'Goal',
  detail: 'Normal Goal',
  player: { name: 'Joueur' },
});

const at = (series, minute) => series.minutes.find((p) => p.minute === minute).value;

describe('momentum reconstruit', () => {
  test('un but fait pencher la courbe du cote de son auteur', () => {
    const series = momentumSeries([goal(30, 10)], fixture);
    assert.ok(at(series, 30) > 50, 'le pic doit etre du cote domicile');
    assert.equal(at(series, 30), 100, 'la normalisation cale le pic a 100');
    assert.ok(at(series, 60) === 0, 'loin de l\'evenement, la pression retombe a zero');
  });

  test('un but exterieur produit une valeur negative', () => {
    const series = momentumSeries([goal(30, 20)], fixture);
    assert.equal(at(series, 30), -100);
  });

  test('l\'influence monte avant le but et retombe plus lentement apres', () => {
    const series = momentumSeries([goal(40, 10)], fixture);
    assert.ok(at(series, 38) > 0, 'la montee precede le but');
    assert.ok(at(series, 36) === 0, 'au-dela de la fenetre de montee, plus rien');
    assert.ok(at(series, 46) > 0, 'la retombee depasse la fenetre de montee');
    // A distance egale du but, l'apres pese plus lourd que l'avant.
    assert.ok(at(series, 43) > at(series, 37), 'la decroissance est plus lente que la croissance');
  });

  test('un carton rouge profite a l\'equipe adverse', () => {
    const rouge = {
      time: { elapsed: 50 },
      team: { id: 10 },
      type: 'Card',
      detail: 'Red Card',
      player: { name: 'Expulse' },
    };
    const series = momentumSeries([rouge], fixture);
    assert.ok(at(series, 50) < 0, 'le carton du cote domicile doit favoriser le visiteur');
  });

  test('un but annule par la video ne compte pas comme un but', () => {
    const events = [{
      time: { elapsed: 20 },
      team: { id: 10 },
      type: 'Var',
      detail: 'Goal cancelled',
      player: { name: 'Joueur' },
    }];
    const series = momentumSeries(events, fixture);
    assert.equal(series.markers.length, 0, 'aucun but ne doit etre marque sur la courbe');
    assert.ok(at(series, 20) < 0, "l'annulation profite a l'adversaire");
  });

  test('sans evenement porteur de signal, aucune courbe n\'est produite', () => {
    assert.equal(momentumSeries([], fixture), null);
    assert.equal(momentumSeries(null, fixture), null);
    // Un remplacement seul ne dit rien de la pression : pas de courbe plate.
    const subst = [{ time: { elapsed: 60 }, team: { id: 10 }, type: 'subst', detail: 'Substitution 1' }];
    assert.equal(momentumSeries(subst, fixture), null);
  });

  test('les buts sont reportes comme reperes, du bon cote', () => {
    const series = momentumSeries([goal(12, 10), goal(70, 20)], fixture);
    assert.deepEqual(series.markers.map((m) => m.side), ['home', 'away']);
    assert.deepEqual(series.markers.map((m) => m.minute), [12, 70]);
  });

  test('le temps additionnel etire la courbe sans la faire deborder', () => {
    const tardif = { ...goal(90, 10), time: { elapsed: 90, extra: 5 } };
    const series = momentumSeries([tardif], fixture);
    assert.equal(series.span, 95);
    assert.equal(series.minutes.length, 96);
    assert.equal(at(series, 95), 100);
  });

  test('la part de domination reflete le camp qui a eu l\'ascendant', () => {
    const series = momentumSeries([goal(20, 10), goal(30, 10)], fixture);
    const share = dominanceShare(series);
    assert.ok(share.home > share.away);
    assert.equal(share.home + share.away + share.neutral, 100);
  });

  test('le graphique est un SVG valide et sans injection', () => {
    const series = momentumSeries([{ ...goal(30, 10), player: { name: '<script>x</script>' } }], fixture);
    const svg = momentumChart(series);
    assert.match(svg, /^\s*<svg /);
    assert.ok(svg.includes('</svg>'));
    assert.ok(!svg.includes('<script>'), "le nom du buteur ne doit pas passer en balise");
    assert.equal(momentumChart(null), '');
  });
});
