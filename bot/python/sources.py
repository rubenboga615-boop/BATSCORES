"""Récupération des prix sur internet (bibliothèque standard uniquement).

- Binance (crypto) : données publiques, AUCUN compte nécessaire.
- OANDA (forex, or, indices) : nécessite un compte démo gratuit et un jeton.
"""

import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

from strategie import Bougie

# Noms d'unités de temps communs -> noms propres à chaque fournisseur
UNITES_BINANCE = {"M5": "5m", "M15": "15m", "M30": "30m", "H1": "1h", "H4": "4h", "D1": "1d"}
UNITES_OANDA = {"M5": "M5", "M15": "M15", "M30": "M30", "H1": "H1", "H4": "H4", "D1": "D"}


class ErreurReseau(Exception):
    pass


def http_json(url, methode="GET", entetes=None, corps=None, delai=20):
    """Requête HTTP qui renvoie du JSON, avec un message d'erreur lisible."""
    donnees = json.dumps(corps).encode() if corps is not None else None
    requete = urllib.request.Request(url, data=donnees, method=methode,
                                     headers={"Content-Type": "application/json", **(entetes or {})})
    try:
        with urllib.request.urlopen(requete, timeout=delai) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise ErreurReseau(f"HTTP {e.code} sur {url.split('?')[0]} : {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ErreurReseau(f"connexion impossible ({e})") from e


def _bougie_depuis_iso(texte, o, h, l, c):
    # "2024-01-02T13:00:00.000000000Z" -> date "2024-01-02", heure "13:00:00"
    return Bougie(texte[:10], texte[11:19], float(o), float(h), float(l), float(c))


def bougies_binance(symbole, unite, nombre=200, http=http_json, maintenant_ms=None):
    """Renvoie (bougies_cloturees, prix_actuel) pour une paire crypto, ex. BTCUSDT."""
    if unite not in UNITES_BINANCE:
        raise ValueError(f"unité inconnue {unite} ; choix : {', '.join(UNITES_BINANCE)}")
    url = (f"https://data-api.binance.vision/api/v3/klines?symbol={symbole.upper()}"
           f"&interval={UNITES_BINANCE[unite]}&limit={min(nombre + 1, 1000)}")
    lignes = http(url)
    maintenant_ms = maintenant_ms if maintenant_ms is not None else time.time() * 1000
    cloturees = []
    for k in lignes:
        ouverture_ms, o, h, l, c, fin_ms = k[0], k[1], k[2], k[3], k[4], k[6]
        if fin_ms < maintenant_ms:  # bougie terminée
            d = datetime.fromtimestamp(ouverture_ms / 1000, tz=timezone.utc)
            cloturees.append(Bougie(d.strftime("%Y-%m-%d"), d.strftime("%H:%M:%S"),
                                    float(o), float(h), float(l), float(c)))
    prix_actuel = float(lignes[-1][4]) if lignes else None
    return cloturees, prix_actuel


def bougies_oanda(client, instrument, unite, nombre=200):
    """Renvoie (bougies_cloturees, prix_actuel) depuis OANDA, ex. EUR_USD."""
    if unite not in UNITES_OANDA:
        raise ValueError(f"unité inconnue {unite} ; choix : {', '.join(UNITES_OANDA)}")
    reponse = client.requete(
        f"/v3/instruments/{instrument}/candles?price=M&granularity={UNITES_OANDA[unite]}"
        f"&count={min(nombre + 1, 5000)}")
    cloturees, prix_actuel = [], None
    for c in reponse.get("candles", []):
        m = c["mid"]
        prix_actuel = float(m["c"])
        if c.get("complete"):
            cloturees.append(_bougie_depuis_iso(c["time"], m["o"], m["h"], m["l"], m["c"]))
    return cloturees, prix_actuel
