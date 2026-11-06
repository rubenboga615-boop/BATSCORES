"""Stratégie de tendance : croisement de moyennes mobiles, stop ATR, risque fixe.

C'est la même logique que l'Expert Advisor MQL5 (bot/mql5/BotTendance.mq5),
pour pouvoir la tester et la modifier sans MetaTrader.
Aucune dépendance : seulement la bibliothèque standard de Python.
"""

from dataclasses import dataclass, field


@dataclass
class Bougie:
    date: str  # "AAAA-MM-JJ" (sert à remettre à zéro la limite de perte du jour)
    heure: str
    ouverture: float
    haut: float
    bas: float
    cloture: float


@dataclass
class Parametres:
    mm_rapide: int = 20          # période de la moyenne mobile rapide
    mm_lente: int = 50           # période de la moyenne mobile lente
    periode_atr: int = 14
    stop_atr: float = 1.5        # stop = 1,5 x ATR
    ratio_objectif: float = 2.0  # objectif = 2 x la distance du stop
    risque_pct: float = 1.0      # % du capital risqué par trade
    perte_max_jour_pct: float = 3.0
    capital_initial: float = 10_000.0
    spread: float = 0.0          # coût par trade, en unités de prix


@dataclass
class Trade:
    sens: int            # +1 achat, -1 vente
    date_entree: str
    prix_entree: float
    stop: float
    objectif: float
    quantite: float
    date_sortie: str = ""
    prix_sortie: float = 0.0
    resultat: float = 0.0  # gain/perte en argent
    r: float = 0.0         # résultat exprimé en multiples du risque (R)


@dataclass
class Resultat:
    trades: list = field(default_factory=list)
    courbe_capital: list = field(default_factory=list)
    capital_final: float = 0.0


def moyenne_mobile(valeurs, periode):
    """Moyenne mobile simple. None tant qu'il n'y a pas assez de bougies."""
    sortie = [None] * len(valeurs)
    somme = 0.0
    for i, v in enumerate(valeurs):
        somme += v
        if i >= periode:
            somme -= valeurs[i - periode]
        if i >= periode - 1:
            sortie[i] = somme / periode
    return sortie


def atr(bougies, periode):
    """Average True Range (moyenne simple du vrai range, comme iATR dans MT5)."""
    vrais_ranges = []
    for i, b in enumerate(bougies):
        if i == 0:
            vrais_ranges.append(b.haut - b.bas)
        else:
            prec = bougies[i - 1].cloture
            vrais_ranges.append(max(b.haut - b.bas, abs(b.haut - prec), abs(b.bas - prec)))
    return moyenne_mobile(vrais_ranges, periode)


def signal(rapide, lente, i):
    """+1 si croisement haussier à la clôture de la bougie i, -1 si baissier, 0 sinon."""
    if i < 1 or None in (rapide[i], lente[i], rapide[i - 1], lente[i - 1]):
        return 0
    if rapide[i - 1] <= lente[i - 1] and rapide[i] > lente[i]:
        return 1
    if rapide[i - 1] >= lente[i - 1] and rapide[i] < lente[i]:
        return -1
    return 0


def backtester(bougies, p=None):
    """Rejoue la stratégie bougie par bougie, sans regarder le futur.

    - Le signal est lu à la clôture de la bougie i, l'entrée se fait à
      l'ouverture de la bougie i+1 (comme le bot dans MT5).
    - Si le stop et l'objectif sont touchés dans la même bougie, on compte le
      stop (hypothèse prudente : on ne sait pas lequel est arrivé en premier).
    """
    p = p or Parametres()
    closes = [b.cloture for b in bougies]
    rapide = moyenne_mobile(closes, p.mm_rapide)
    lente = moyenne_mobile(closes, p.mm_lente)
    atrs = atr(bougies, p.periode_atr)

    capital = p.capital_initial
    res = Resultat(courbe_capital=[capital])
    position = None
    jour = None
    capital_debut_jour = capital

    for i in range(1, len(bougies)):
        b = bougies[i]
        if b.date != jour:
            jour = b.date
            capital_debut_jour = capital

        # 1) Entrée sur le signal de la bougie précédente (déjà clôturée).
        if position is None:
            s = signal(rapide, lente, i - 1)
            perte_jour_pct = (capital_debut_jour - capital) / capital_debut_jour * 100
            if s != 0 and atrs[i - 1] and perte_jour_pct < p.perte_max_jour_pct:
                distance = p.stop_atr * atrs[i - 1]
                entree = b.ouverture + s * p.spread / 2
                quantite = (capital * p.risque_pct / 100) / distance
                position = Trade(
                    sens=s,
                    date_entree=f"{b.date} {b.heure}",
                    prix_entree=entree,
                    stop=entree - s * distance,
                    objectif=entree + s * distance * p.ratio_objectif,
                    quantite=quantite,
                )

        # 2) Sortie : stop ou objectif touché pendant la bougie.
        if position is not None:
            t = position
            stop_touche = b.bas <= t.stop if t.sens == 1 else b.haut >= t.stop
            objectif_touche = b.haut >= t.objectif if t.sens == 1 else b.bas <= t.objectif
            if stop_touche or objectif_touche:
                t.prix_sortie = t.stop if stop_touche else t.objectif
                t.prix_sortie -= t.sens * p.spread / 2
                t.date_sortie = f"{b.date} {b.heure}"
                t.resultat = (t.prix_sortie - t.prix_entree) * t.sens * t.quantite
                risque = abs(t.prix_entree - t.stop) * t.quantite
                t.r = t.resultat / risque if risque else 0.0
                capital += t.resultat
                res.trades.append(t)
                position = None

        res.courbe_capital.append(capital)

    res.capital_final = capital
    return res


def statistiques(res, capital_initial):
    trades = res.trades
    gains = [t.resultat for t in trades if t.resultat > 0]
    pertes = [-t.resultat for t in trades if t.resultat <= 0]
    sommet, dd_max = capital_initial, 0.0
    for c in res.courbe_capital:
        sommet = max(sommet, c)
        dd_max = max(dd_max, (sommet - c) / sommet * 100)
    n = len(trades)
    return {
        "trades": n,
        "taux_reussite_pct": round(len(gains) / n * 100, 1) if n else 0.0,
        "profit_factor": round(sum(gains) / sum(pertes), 2) if pertes and sum(pertes) else None,
        "r_moyen": round(sum(t.r for t in trades) / n, 2) if n else 0.0,
        "resultat_net": round(res.capital_final - capital_initial, 2),
        "rendement_pct": round((res.capital_final / capital_initial - 1) * 100, 2),
        "drawdown_max_pct": round(dd_max, 2),
    }
