"""Lance un backtest sur un fichier de prix.

Formats acceptés :
- export MetaTrader 5 (clic droit sur le graphique > Barres > Exporter) :
  colonnes <DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> ..., séparées par des tabulations ;
- export TradingView ou tout CSV avec les colonnes time/date, open, high, low, close.

Exemples :
    python3 backtest.py EURUSD_H1.csv
    python3 backtest.py EURUSD_H1.csv --rapide 10 --lente 30 --spread 0.0001
    python3 backtest.py EURUSD_H1.csv --trades     # affiche chaque trade
"""

import argparse
import csv
import sys
from datetime import datetime, timezone

from strategie import Bougie, Parametres, backtester, statistiques


def _nom(colonne):
    return colonne.strip().strip("<>").lower()


def _date_heure(ligne):
    if "date" in ligne and "time" in ligne:
        return ligne["date"].replace(".", "-"), ligne["time"]
    brut = ligne.get("time") or ligne.get("date") or ligne.get("datetime")
    if brut is None:
        raise ValueError("colonne de date introuvable (time, date ou datetime)")
    brut = brut.strip()
    if brut.replace(".", "").isdigit():  # horodatage Unix (TradingView)
        d = datetime.fromtimestamp(float(brut), tz=timezone.utc)
        return d.strftime("%Y-%m-%d"), d.strftime("%H:%M:%S")
    brut = brut.replace(".", "-").replace("T", " ")
    date, _, heure = brut.partition(" ")
    return date, heure[:8]


def charger(chemin):
    with open(chemin, newline="", encoding="utf-8-sig") as f:
        echantillon = f.read(2048)
        f.seek(0)
        separateur = "\t" if "\t" in echantillon else (";" if ";" in echantillon.splitlines()[0] else ",")
        lecteur = csv.DictReader(f, delimiter=separateur)
        bougies = []
        for brute in lecteur:
            ligne = {_nom(k): v for k, v in brute.items() if k}
            date, heure = _date_heure(ligne)
            bougies.append(Bougie(
                date=date, heure=heure,
                ouverture=float(ligne["open"]), haut=float(ligne["high"]),
                bas=float(ligne["low"]), cloture=float(ligne["close"]),
            ))
    if not bougies:
        raise ValueError("aucune bougie dans le fichier")
    return bougies


def main(argv=None):
    a = argparse.ArgumentParser(description="Backtest de la stratégie de tendance")
    a.add_argument("fichier")
    a.add_argument("--rapide", type=int, default=20)
    a.add_argument("--lente", type=int, default=50)
    a.add_argument("--atr", type=int, default=14)
    a.add_argument("--stop-atr", type=float, default=1.5)
    a.add_argument("--ratio", type=float, default=2.0)
    a.add_argument("--risque", type=float, default=1.0, help="%% du capital par trade")
    a.add_argument("--capital", type=float, default=10_000.0)
    a.add_argument("--spread", type=float, default=0.0, help="coût par trade en prix")
    a.add_argument("--trades", action="store_true", help="lister chaque trade")
    args = a.parse_args(argv)

    if args.rapide >= args.lente:
        a.error("--rapide doit être plus petit que --lente")

    p = Parametres(
        mm_rapide=args.rapide, mm_lente=args.lente, periode_atr=args.atr,
        stop_atr=args.stop_atr, ratio_objectif=args.ratio, risque_pct=args.risque,
        capital_initial=args.capital, spread=args.spread,
    )
    bougies = charger(args.fichier)
    res = backtester(bougies, p)
    stats = statistiques(res, p.capital_initial)

    print(f"Bougies : {len(bougies)}  ({bougies[0].date} -> {bougies[-1].date})")
    print(f"MM {p.mm_rapide}/{p.mm_lente}, stop {p.stop_atr} x ATR{p.periode_atr}, "
          f"objectif {p.ratio_objectif} R, risque {p.risque_pct} %")
    print("-" * 50)
    libelles = {
        "trades": "Nombre de trades", "taux_reussite_pct": "Taux de réussite (%)",
        "profit_factor": "Profit factor", "r_moyen": "Gain moyen par trade (R)",
        "resultat_net": "Résultat net", "rendement_pct": "Rendement (%)",
        "drawdown_max_pct": "Drawdown max (%)",
    }
    for cle, libelle in libelles.items():
        print(f"{libelle:<28} {stats[cle]}")

    if args.trades:
        print("-" * 50)
        for t in res.trades:
            sens = "ACHAT" if t.sens == 1 else "VENTE"
            print(f"{t.date_entree}  {sens:<5}  {t.prix_entree:.5f} -> {t.prix_sortie:.5f}  "
                  f"{t.r:+.2f} R  {t.resultat:+.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
