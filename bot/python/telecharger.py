"""Télécharge l'historique des prix dans un CSV lisible par backtest.py.

Crypto (Binance, aucun compte) :
    python telecharger.py binance BTCUSDT H1 2 btc_h1.csv        # 2 ans d'historique

Forex (OANDA, compte démo gratuit, variables OANDA_TOKEN et OANDA_COMPTE) :
    python telecharger.py oanda EUR_USD H1 2 eurusd_h1.csv
"""

import os
import sys
import time
from datetime import datetime, timedelta, timezone

from courtiers import Oanda
from sources import UNITES_BINANCE, UNITES_OANDA, http_json

DUREE_MS = {"M5": 300_000, "M15": 900_000, "M30": 1_800_000,
            "H1": 3_600_000, "H4": 14_400_000, "D1": 86_400_000}


def _ecrire(chemin, lignes):
    with open(chemin, "w", encoding="utf-8") as f:
        f.write("<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\n")
        for d, o, h, l, c in lignes:
            f.write(f"{d:%Y.%m.%d}\t{d:%H:%M:%S}\t{o}\t{h}\t{l}\t{c}\n")


def binance(symbole, unite, annees, http=http_json, maintenant_ms=None):
    maintenant_ms = maintenant_ms if maintenant_ms is not None else int(time.time() * 1000)
    debut = maintenant_ms - int(annees * 365 * 86_400_000)
    lignes = []
    while debut < maintenant_ms:
        url = (f"https://data-api.binance.vision/api/v3/klines?symbol={symbole.upper()}"
               f"&interval={UNITES_BINANCE[unite]}&startTime={debut}&limit=1000")
        paquet = http(url)
        if not paquet:
            break
        for k in paquet:
            if k[6] < maintenant_ms:  # seulement les bougies terminées
                lignes.append((datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc),
                               k[1], k[2], k[3], k[4]))
        debut = paquet[-1][0] + DUREE_MS[unite]
        print(f"  {len(lignes)} bougies...", end="\r", flush=True)
    return lignes


def oanda(client, instrument, unite, annees):
    debut = datetime.now(timezone.utc) - timedelta(days=365 * annees)
    lignes, vues = [], set()
    while True:
        r = client.requete(f"/v3/instruments/{instrument}/candles?price=M"
                           f"&granularity={UNITES_OANDA[unite]}&count=5000"
                           f"&from={debut:%Y-%m-%dT%H:%M:%SZ}")
        bougies = [c for c in r.get("candles", []) if c.get("complete") and c["time"] not in vues]
        if not bougies:
            break
        for c in bougies:
            vues.add(c["time"])
            m = c["mid"]
            d = datetime.strptime(c["time"][:19], "%Y-%m-%dT%H:%M:%S")
            lignes.append((d, m["o"], m["h"], m["l"], m["c"]))
        debut = datetime.strptime(bougies[-1]["time"][:19], "%Y-%m-%dT%H:%M:%S") + timedelta(seconds=1)
        print(f"  {len(lignes)} bougies...", end="\r", flush=True)
    return lignes


def main(argv):
    if len(argv) != 5 or argv[0] not in ("binance", "oanda") or argv[2] not in DUREE_MS:
        sys.exit(__doc__)
    fournisseur, marche, unite, annees, chemin = argv[0], argv[1], argv[2], float(argv[3]), argv[4]
    if fournisseur == "binance":
        lignes = binance(marche, unite, annees)
    else:
        client = Oanda(os.environ.get("OANDA_TOKEN"), os.environ.get("OANDA_COMPTE"))
        lignes = oanda(client, marche, unite, annees)
    if not lignes:
        sys.exit("Aucune bougie reçue : vérifie le nom du marché.")
    _ecrire(chemin, lignes)
    print(f"{len(lignes)} bougies écrites dans {chemin} "
          f"({lignes[0][0]:%Y-%m-%d} -> {lignes[-1][0]:%Y-%m-%d})")


if __name__ == "__main__":
    main(sys.argv[1:])
