"""Tests du bot en direct, sans réseau : les réponses des API sont simulées."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bot import Bot  # noqa: E402
from courtiers import Oanda, Papier  # noqa: E402
from sources import bougies_binance, bougies_oanda  # noqa: E402
from strategie import Bougie, Parametres  # noqa: E402

P = Parametres(mm_rapide=2, mm_lente=3, periode_atr=2, stop_atr=1.0, ratio_objectif=2.0)


def serie(prix, depart=0):
    """Bougies horaires d'écart 0,5 autour de chaque prix."""
    return [Bougie("2024-01-01", f"{(depart + i):02d}:00:00", x, x + 0.5, x - 0.5, x)
            for i, x in enumerate(prix)]


class FauxMarche:
    """Fournit au bot des bougies qu'on ajoute au fur et à mesure."""
    def __init__(self, bougies):
        self.bougies = list(bougies)

    def __call__(self):
        return list(self.bougies), self.bougies[-1].cloture


class TestSources(unittest.TestCase):
    def test_binance_ignore_la_bougie_en_cours(self):
        heure = 3_600_000
        lignes = [[0, "1", "2", "0.5", "1.5", "0", heure - 1],
                  [heure, "1.5", "3", "1", "2.5", "0", 2 * heure - 1]]
        appels = []

        def http(url):
            appels.append(url)
            return lignes
        cloturees, prix = bougies_binance("btcusdt", "H1", 10, http=http, maintenant_ms=heure + 5)
        self.assertEqual(len(cloturees), 1)
        self.assertEqual((cloturees[0].date, cloturees[0].heure), ("1970-01-01", "00:00:00"))
        self.assertEqual(prix, 2.5)
        self.assertIn("symbol=BTCUSDT", appels[0])
        self.assertIn("interval=1h", appels[0])

    def test_oanda_bougies(self):
        class Client:
            def requete(self, chemin):
                self.chemin = chemin
                return {"candles": [
                    {"time": "2024-01-02T13:00:00.000000000Z", "complete": True,
                     "mid": {"o": "1.1", "h": "1.2", "l": "1.0", "c": "1.15"}},
                    {"time": "2024-01-02T14:00:00.000000000Z", "complete": False,
                     "mid": {"o": "1.15", "h": "1.16", "l": "1.14", "c": "1.155"}}]}
        c = Client()
        cloturees, prix = bougies_oanda(c, "EUR_USD", "D1")
        self.assertEqual(len(cloturees), 1)
        self.assertEqual(cloturees[0].heure, "13:00:00")
        self.assertEqual(prix, 1.155)
        self.assertIn("granularity=D", c.chemin)


class TestPapierEtBot(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.TemporaryDirectory()
        self.compte = os.path.join(self.dossier.name, "compte.json")
        self.journal = os.path.join(self.dossier.name, "journal.csv")
        self.messages = []

    def tearDown(self):
        self.dossier.cleanup()

    def bot(self, marche, etat=None):
        return Bot(Papier(self.compte), marche, "TEST", P, journal=self.journal,
                   etat=etat if etat is not None else {}, log=self.messages.append)

    def test_cycle_complet_entree_puis_objectif(self):
        marche = FauxMarche(serie([12, 11, 10, 9]))
        bot = self.bot(marche)
        bot.cycle()                                   # premier passage : on attend
        self.assertIn("J'attends", self.messages[-1])

        marche.bougies += serie([12], depart=4)       # croisement haussier à la clôture
        bot.cycle()
        self.assertTrue(bot.courtier.position_ouverte())
        self.assertIn("ENTRÉE ACHAT", self.messages[-1])
        self.assertFalse(bot.cycle())                 # même bougie : rien ne se passe

        marche.bougies += serie([30], depart=5)       # l'objectif est touché
        bot.cycle()
        self.assertFalse(bot.courtier.position_ouverte())
        self.assertTrue(any("SORTIE" in m and "+2.00 R" in m for m in self.messages))
        self.assertAlmostEqual(bot.courtier.equite(), 10_200.0)

        # Le compte papier survit à un redémarrage
        self.assertAlmostEqual(Papier(self.compte).equite(), 10_200.0)
        with open(self.journal) as f:
            lignes = f.read().splitlines()
        self.assertEqual([lg.split(",")[0] for lg in lignes[1:]], ["entree", "sortie"])

    def test_limite_du_jour(self):
        marche = FauxMarche(serie([12, 11, 10, 9]))
        bot = self.bot(marche, etat={"derniere_bougie": "2024-01-01 03:00:00"})
        bot.courtier.etat["capital"] = 9_000.0        # on a déjà perdu 10 % aujourd'hui
        from datetime import datetime, timezone
        bot.etat["jour"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        bot.etat["equite_debut_jour"] = 10_000.0
        marche.bougies += serie([12], depart=4)
        bot.cycle()
        self.assertFalse(bot.courtier.position_ouverte())
        self.assertIn("limite de perte du jour", self.messages[-1])


class FauxOanda:
    """Simule les réponses de l'API OANDA et garde les requêtes reçues."""
    def __init__(self, ordre_accepte=True):
        self.requetes = []
        self.ordre_accepte = ordre_accepte

    def __call__(self, url, methode="GET", entetes=None, corps=None):
        self.requetes.append((methode, url, corps, entetes))
        if url.endswith("/summary"):
            return {"account": {"balance": "10000", "NAV": "10000"}}
        if "/instruments?" in url:
            return {"instruments": [{"displayPrecision": 5, "tradeUnitsPrecision": 0,
                                     "minimumTradeSize": "1"}]}
        if "/pricing?" in url:
            return {"prices": [{"bids": [{"price": "1.10000"}], "asks": [{"price": "1.10010"}]}],
                    "homeConversions": [{"currency": "USD", "accountLoss": "0.9"}]}
        if url.endswith("/orders"):
            if self.ordre_accepte:
                return {"orderFillTransaction": {"price": "1.10012"}}
            return {"orderCancelTransaction": {"reason": "INSUFFICIENT_MARGIN"}}
        raise AssertionError(url)


class TestOanda(unittest.TestCase):
    def test_demo_par_defaut_et_ordre_bien_forme(self):
        http = FauxOanda()
        o = Oanda("jeton", "101-001", http=http)
        t = o.ouvrir("EUR_USD", -1, 0.0020, P)
        methode, url, corps, entetes = http.requetes[-1]
        self.assertTrue(url.startswith("https://api-fxpractice.oanda.com/v3/accounts/101-001/orders"))
        self.assertEqual(entetes["Authorization"], "Bearer jeton")
        ordre = corps["order"]
        # 1 % de 10 000 = 100 ; perte par unité = 0,0020 USD x 0,9 = 0,0018 -> 55 555 unités
        self.assertEqual(ordre["units"], "-55555")
        self.assertEqual(ordre["stopLossOnFill"]["price"], "1.10200")    # vente : stop au-dessus
        self.assertEqual(ordre["takeProfitOnFill"]["price"], "1.09600")
        self.assertAlmostEqual(t.prix_entree, 1.10012)

    def test_ordre_refuse(self):
        o = Oanda("jeton", "101-001", http=FauxOanda(ordre_accepte=False))
        with self.assertRaisesRegex(ValueError, "INSUFFICIENT_MARGIN"):
            o.ouvrir("EUR_USD", 1, 0.0020, P)

    def test_sans_identifiants(self):
        with self.assertRaises(ValueError):
            Oanda(None, None)


if __name__ == "__main__":
    unittest.main()


class TestTelecharger(unittest.TestCase):
    def test_binance_pagine_puis_relu_par_le_backtest(self):
        import telecharger
        from backtest import charger
        heure = 3_600_000
        fin = 2500 * heure

        def http(url):
            debut = int(url.split("startTime=")[1].split("&")[0])
            debut = (debut // heure) * heure
            return [[t, "1", "2", "0.5", "1.5", "0", t + heure - 1]
                    for t in range(debut, min(debut + 1000 * heure, fin + heure), heure)]
        lignes = telecharger.binance("BTCUSDT", "H1", 2500 / 8760, http=http, maintenant_ms=fin)
        self.assertEqual(len(lignes), 2500)                       # 3 pages, bougie en cours exclue
        self.assertEqual(len({d for d, *_ in lignes}), 2500)      # sans doublon
        with tempfile.TemporaryDirectory() as d:
            chemin = os.path.join(d, "btc.csv")
            telecharger._ecrire(chemin, lignes)
            self.assertEqual(len(charger(chemin)), 2500)
