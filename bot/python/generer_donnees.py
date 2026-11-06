"""Génère des prix fictifs (format export MT5) pour s'entraîner sans données réelles.

    python3 generer_donnees.py donnees_exemple.csv [nombre_de_bougies] [graine]

Attention : des prix aléatoires n'ont aucune "vraie" tendance. Une stratégie
qui gagne dessus a eu de la chance. Pour juger une stratégie, utilise des
données réelles exportées de MT5 (voir cours/04-strategie-et-backtest.md).
"""

import random
import sys
from datetime import datetime, timedelta


def generer(chemin, n=5000, graine=42):
    rng = random.Random(graine)
    prix = 1.1000
    derive = 0.0
    t = datetime(2024, 1, 1)
    with open(chemin, "w", encoding="utf-8") as f:
        f.write("<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\n")
        for _ in range(n):
            if rng.random() < 0.01:  # de temps en temps, la "tendance" change
                derive = rng.gauss(0, 0.0002)
            ouverture = prix
            cloture = ouverture + derive + rng.gauss(0, 0.0012)
            haut = max(ouverture, cloture) + abs(rng.gauss(0, 0.0006))
            bas = min(ouverture, cloture) - abs(rng.gauss(0, 0.0006))
            f.write(f"{t:%Y.%m.%d}\t{t:%H:%M:%S}\t{ouverture:.5f}\t{haut:.5f}\t"
                    f"{bas:.5f}\t{cloture:.5f}\t{rng.randint(100, 2000)}\n")
            prix = cloture
            t += timedelta(hours=1)
            if t.weekday() >= 5:  # pas de cotation le week-end
                t += timedelta(days=7 - t.weekday())


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    generer(sys.argv[1],
            int(sys.argv[2]) if len(sys.argv) > 2 else 5000,
            int(sys.argv[3]) if len(sys.argv) > 3 else 42)
    print(f"Fichier écrit : {sys.argv[1]}")
