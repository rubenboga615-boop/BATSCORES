import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backtest import charger  # noqa: E402
from generer_donnees import generer  # noqa: E402
from strategie import Bougie, Parametres, backtester, moyenne_mobile, signal, statistiques  # noqa: E402


def bougie(prix, date="2024-01-01", ecart=0.0):
    return Bougie(date, "00:00:00", prix, prix + ecart, prix - ecart, prix)


class TestIndicateurs(unittest.TestCase):
    def test_moyenne_mobile(self):
        self.assertEqual(moyenne_mobile([1, 2, 3, 4], 2), [None, 1.5, 2.5, 3.5])

    def test_signal_croisement(self):
        self.assertEqual(signal([1, 3], [2, 2], 1), 1)
        self.assertEqual(signal([3, 1], [2, 2], 1), -1)
        self.assertEqual(signal([3, 4], [2, 2], 1), 0)


class TestBacktest(unittest.TestCase):
    def p(self, **kw):
        base = dict(mm_rapide=2, mm_lente=3, periode_atr=2, stop_atr=1.0, ratio_objectif=2.0)
        base.update(kw)
        return Parametres(**base)

    def test_achat_qui_touche_l_objectif_rapporte_2R(self):
        prix = [12, 11, 10, 9, 12, 12, 12, 30]
        bougies = [bougie(x, ecart=0.5) for x in prix]
        res = backtester(bougies, self.p())
        self.assertEqual(len(res.trades), 1)
        t = res.trades[0]
        self.assertEqual(t.sens, 1)
        self.assertAlmostEqual(t.r, 2.0)
        # 1 % de 10 000 risqué, 2 R gagnés
        self.assertAlmostEqual(res.capital_final, 10_200.0)

    def test_stop_prioritaire_si_les_deux_sont_touches(self):
        prix = [12, 11, 10, 9, 12, 12]
        bougies = [bougie(x, ecart=0.5) for x in prix]
        bougies.append(Bougie("2024-01-01", "00:00:00", 12, 100, 0, 12))
        res = backtester(bougies, self.p())
        self.assertAlmostEqual(res.trades[0].r, -1.0)
        self.assertAlmostEqual(res.capital_final, 9_900.0)

    def test_limite_de_perte_du_jour_bloque_les_entrees(self):
        p = self.p(risque_pct=5.0, perte_max_jour_pct=3.0)
        prix = [12, 11, 10, 9, 12, 12, 12]
        bougies = [bougie(x, ecart=0.5) for x in prix]
        bougies.append(Bougie("2024-01-01", "00:00:00", 12, 12, 0, 1))   # stop : -5 %
        bougies += [bougie(x, ecart=0.5) for x in [1, 1, 5, 6, 7]]        # nouveau croisement
        res = backtester(bougies, p)
        self.assertEqual(len(res.trades), 1)

    def test_statistiques(self):
        bougies = [bougie(x, ecart=0.5) for x in [12, 11, 10, 9, 12, 12, 12, 30]]
        res = backtester(bougies, self.p())
        s = statistiques(res, 10_000)
        self.assertEqual(s["trades"], 1)
        self.assertEqual(s["taux_reussite_pct"], 100.0)
        self.assertEqual(s["rendement_pct"], 2.0)


class TestFichiers(unittest.TestCase):
    def test_export_mt5_genere_puis_backteste(self):
        with tempfile.TemporaryDirectory() as d:
            chemin = os.path.join(d, "prix.csv")
            generer(chemin, n=2000)
            bougies = charger(chemin)
            self.assertEqual(len(bougies), 2000)
            self.assertRegex(bougies[0].date, r"^\d{4}-\d{2}-\d{2}$")
            res = backtester(bougies)
            self.assertGreater(len(res.trades), 5)

    def test_csv_tradingview(self):
        with tempfile.TemporaryDirectory() as d:
            chemin = os.path.join(d, "tv.csv")
            with open(chemin, "w") as f:
                f.write("time,open,high,low,close\n1704067200,1,2,0.5,1.5\n")
            b = charger(chemin)[0]
            self.assertEqual((b.date, b.cloture), ("2024-01-01", 1.5))


if __name__ == "__main__":
    unittest.main()
