/**
 * Le modele de prediction, eprouve sur des donnees construites pour que la
 * bonne reponse soit connue d'avance.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);

if (!hasSqlite) {
  test('modele de prediction', { skip: 'node:sqlite requiert Node 22 ou superieur' }, () => {});
} else {
  const { fit, predict, sampleQuality } = await import('../collector/predict.mjs');

  const now = Date.now();
  const daysAgo = (n) => Math.floor(now / 1000 - n * 86400);

  /** Championnat fictif ou l'equipe 1 domine et l'equipe 4 est faible. */
  function championship() {
    const matches = [];
    const teams = [1, 2, 3, 4];
    const force = { 1: 2.4, 2: 1.4, 3: 1.1, 4: 0.5 };
    let day = 400;
    // Plusieurs tours pour que chaque equipe ait un historique consequent.
    for (let round = 0; round < 12; round += 1) {
      for (const h of teams) {
        for (const a of teams) {
          if (h === a) continue;
          matches.push({
            home: h,
            away: a,
            gh: Math.round(force[h] * 1.15),
            ga: Math.round(force[a] * 0.85),
            ts: daysAgo(day),
          });
          day -= 1;
        }
      }
    }
    return matches;
  }

  describe('estimation des forces', () => {
    test('une base vide ne produit pas de modele', () => {
      assert.equal(fit([]), null);
    });

    test('l\'equipe dominante obtient la plus forte attaque', () => {
      const model = fit(championship(), { now });
      const fort = model.teams.get(1);
      const faible = model.teams.get(4);
      assert.ok(fort.attackHome > faible.attackHome, 'attaque du fort superieure');
      assert.ok(fort.defenceHome < faible.defenceHome, 'defense du fort meilleure');
    });

    test('les matchs recents pesent plus que les anciens', () => {
      // Meme confrontation, mais l'equipe 1 gagnait large il y a longtemps et
      // perd largement recemment : le modele doit suivre le present.
      const anciens = Array.from({ length: 40 }, (_, i) => ({
        home: 1, away: 2, gh: 5, ga: 0, ts: daysAgo(900 + i),
      }));
      const recents = Array.from({ length: 40 }, (_, i) => ({
        home: 1, away: 2, gh: 0, ga: 3, ts: daysAgo(10 + i),
      }));
      const model = fit([...anciens, ...recents], { now });
      const p = predict(model, 1, 2);
      assert.ok(p.expected.home < p.expected.away,
        `le present doit primer (${p.expected.home} vs ${p.expected.away})`);
    });
  });

  describe('donnees anciennes', () => {
    test('un echantillon entierement ancien reste exploitable', () => {
      // Piege trouve a l'usage : quand l'anciennete se mesurait par rapport a
      // l'horloge, une base de quelques annees voyait tous ses poids devenir
      // infinitesimaux. Le rappel vers la moyenne l'emportait et le modele
      // rendait toutes les equipes identiques — un effondrement silencieux,
      // bien pire qu'un refus de repondre.
      const vieux = championship().map((m) => ({ ...m, ts: m.ts - 1500 * 86400 }));
      const model = fit(vieux, { now });
      const fort = model.teams.get(1);
      const faible = model.teams.get(4);
      assert.ok(fort.attackHome > 1.3,
        `l'attaque du fort doit rester marquee (${fort.attackHome})`);
      assert.ok(faible.attackHome < 0.85,
        `celle du faible aussi (${faible.attackHome})`);

      const p = predict(model, 1, 4);
      assert.ok(p.outcome.home > 60, `le favori doit rester favori (${p.outcome.home}%)`);
    });
  });

  describe('prediction', () => {
    test('le favori a la plus forte probabilite de victoire', () => {
      const model = fit(championship(), { now });
      const p = predict(model, 1, 4);
      assert.ok(p.outcome.home > p.outcome.away, 'le fort a domicile est favori');
      assert.ok(p.outcome.home > 50);
    });

    test('les probabilites 1N2 totalisent 100 %', () => {
      const model = fit(championship(), { now });
      const p = predict(model, 2, 3);
      const total = p.outcome.home + p.outcome.draw + p.outcome.away;
      assert.ok(Math.abs(total - 100) < 0.5, `total ${total}`);
    });

    test('la matrice des scores est une vraie distribution', () => {
      const model = fit(championship(), { now });
      const p = predict(model, 1, 2);
      // Les cinq scores les plus probables sont ordonnes et plausibles.
      assert.equal(p.topScores.length, 5);
      for (let i = 1; i < p.topScores.length; i += 1) {
        assert.ok(p.topScores[i - 1].p >= p.topScores[i].p, 'scores ordonnes');
      }
      assert.match(p.topScores[0].score, /^\d+-\d+$/);
    });

    test('un match desequilibre est plus sur qu\'un match equilibre', () => {
      const model = fit(championship(), { now });
      const desequilibre = predict(model, 1, 4);
      const equilibre = predict(model, 2, 3);
      assert.ok(desequilibre.confidence > equilibre.confidence,
        `${desequilibre.confidence} devrait depasser ${equilibre.confidence}`);
    });

    test('over 2.5 et under 2.5 sont complementaires', () => {
      const model = fit(championship(), { now });
      const p = predict(model, 1, 2);
      assert.ok(Math.abs(p.goals.over25 + p.goals.under25 - 100) < 0.5);
    });

    test('une equipe inconnue du modele ne produit pas de prediction', () => {
      const model = fit(championship(), { now });
      assert.equal(predict(model, 1, 999), null);
    });

    test('le modele expose sur quoi il s\'appuie', () => {
      const model = fit(championship(), { now });
      const p = predict(model, 1, 2);
      // La transparence est le point : on doit pouvoir dire pourquoi il penche.
      assert.ok(p.basis.matches > 0);
      assert.ok(p.basis.attackHome > 0);
      assert.ok(p.basis.homeMatches > 0);
    });
  });

  describe('qualite de l\'echantillon', () => {
    test('un echantillon trop mince est signale comme tel', () => {
      assert.equal(sampleQuality(50).level, 'insuffisant');
      assert.equal(sampleQuality(300).level, 'faible');
      assert.equal(sampleQuality(600).level, 'correct');
      assert.equal(sampleQuality(1500).level, 'solide');
    });
  });
}
