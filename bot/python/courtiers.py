"""Les "courtiers" à qui le bot passe ses ordres.

- Papier : un compte fictif tenu par le bot lui-même (fichier JSON).
  Aucun compte, aucun risque : parfait pour commencer.
- Oanda : un vrai compte chez OANDA, en DÉMO par défaut (argent fictif).
"""

import json
import math
import os
from dataclasses import asdict

from sources import http_json
from strategie import Trade, fermer, niveaux, sortie_touchee


class Papier:
    nom = "papier"

    def __init__(self, fichier, capital_initial=10_000.0, spread=0.0):
        self.fichier = fichier
        self.spread = spread
        self.etat = {"capital": capital_initial, "position": None, "debut_bougie_entree": None}
        if os.path.exists(fichier):
            with open(fichier, encoding="utf-8") as f:
                self.etat = json.load(f)

    def _sauver(self):
        temporaire = self.fichier + ".tmp"
        with open(temporaire, "w", encoding="utf-8") as f:
            json.dump(self.etat, f, indent=2)
        os.replace(temporaire, self.fichier)  # écriture atomique : pas de fichier à moitié écrit

    @property
    def _position(self):
        return Trade(**self.etat["position"]) if self.etat["position"] else None

    def position_ouverte(self, _marche=None):
        return self.etat["position"] is not None

    def equite(self, prix_actuel=None):
        t = self._position
        if t is None or prix_actuel is None:
            return self.etat["capital"]
        return self.etat["capital"] + (prix_actuel - t.prix_entree) * t.sens * t.quantite

    def suivre(self, bougies_nouvelles):
        """Vérifie stop et objectif sur les bougies clôturées depuis le dernier passage.
        Renvoie la liste des trades fermés."""
        t = self._position
        if t is None:
            return []
        debut = self.etat["debut_bougie_entree"] or ""
        for b in bougies_nouvelles:
            if f"{b.date} {b.heure}" < debut:
                continue
            prix = sortie_touchee(t, b)
            if prix is not None:
                fermer(t, prix - t.sens * self.spread / 2, f"{b.date} {b.heure}")
                self.etat["capital"] += t.resultat
                self.etat["position"] = None
                self._sauver()
                return [t]
        return []

    def ouvrir(self, _marche, sens, distance, p, prix_actuel, debut_bougie, date):
        entree = prix_actuel + sens * self.spread / 2
        stop, objectif = niveaux(sens, entree, distance, p)
        quantite = (self.etat["capital"] * p.risque_pct / 100) / distance
        t = Trade(sens=sens, date_entree=date, prix_entree=entree,
                  stop=stop, objectif=objectif, quantite=quantite)
        self.etat["position"] = asdict(t)
        self.etat["debut_bougie_entree"] = debut_bougie
        self._sauver()
        return t


class Oanda:
    nom = "oanda"
    URL_DEMO = "https://api-fxpractice.oanda.com"
    URL_REEL = "https://api-fxtrade.oanda.com"

    def __init__(self, jeton, compte, reel=False, http=http_json):
        if not jeton or not compte:
            raise ValueError("OANDA_TOKEN et OANDA_COMPTE doivent être définis (voir cours/05).")
        self.jeton, self.compte, self.http = jeton, compte, http
        self.base = self.URL_REEL if reel else self.URL_DEMO
        self._instruments = {}

    def requete(self, chemin, methode="GET", corps=None):
        return self.http(self.base + chemin, methode=methode, corps=corps,
                         entetes={"Authorization": f"Bearer {self.jeton}"})

    def resume(self):
        return self.requete(f"/v3/accounts/{self.compte}/summary")["account"]

    def equite(self, _prix_actuel=None):
        return float(self.resume()["NAV"])

    def position_ouverte(self, marche):
        trades = self.requete(f"/v3/accounts/{self.compte}/openTrades").get("trades", [])
        return any(t["instrument"] == marche for t in trades)

    def suivre(self, _bougies):
        return []  # OANDA gère lui-même le stop et l'objectif côté serveur

    def _instrument(self, marche):
        if marche not in self._instruments:
            r = self.requete(f"/v3/accounts/{self.compte}/instruments?instruments={marche}")
            self._instruments[marche] = r["instruments"][0]
        return self._instruments[marche]

    def _prix_et_conversion(self, marche):
        """Bid, ask, et le facteur pour convertir la devise de cotation en devise du compte."""
        r = self.requete(f"/v3/accounts/{self.compte}/pricing?instruments={marche}"
                         "&includeHomeConversions=true")
        prix = r["prices"][0]
        bid, ask = float(prix["bids"][0]["price"]), float(prix["asks"][0]["price"])
        devise_cotation = marche.split("_")[1]
        facteur = 1.0
        for conv in r.get("homeConversions", []):
            if conv["currency"] == devise_cotation:
                facteur = float(conv["accountLoss"])
        return bid, ask, facteur

    def ouvrir(self, marche, sens, distance, p, _prix_actuel=None, _debut_bougie=None, date=""):
        info = self._instrument(marche)
        precision_prix = int(info["displayPrecision"])
        precision_unites = int(info.get("tradeUnitsPrecision", 0))
        minimum = float(info.get("minimumTradeSize", 1))

        bid, ask, facteur = self._prix_et_conversion(marche)
        argent_risque = float(self.resume()["balance"]) * p.risque_pct / 100
        echelle = 10 ** precision_unites
        unites = math.floor(argent_risque / (distance * facteur) * echelle) / echelle
        if unites < minimum:
            raise ValueError(f"taille trop petite ({unites} < {minimum}) pour risquer {p.risque_pct} %")

        entree = ask if sens == 1 else bid
        stop, objectif = niveaux(sens, entree, distance, p)
        texte_unites = f"{sens * unites:.{precision_unites}f}"
        ordre = {"order": {
            "type": "MARKET", "instrument": marche, "units": texte_unites,
            "timeInForce": "FOK", "positionFill": "DEFAULT",
            "stopLossOnFill": {"price": f"{stop:.{precision_prix}f}"},
            "takeProfitOnFill": {"price": f"{objectif:.{precision_prix}f}"},
        }}
        r = self.requete(f"/v3/accounts/{self.compte}/orders", methode="POST", corps=ordre)
        if "orderFillTransaction" not in r:
            raison = r.get("orderCancelTransaction", {}).get("reason", "inconnue")
            raise ValueError(f"ordre refusé par OANDA : {raison}")
        execution = float(r["orderFillTransaction"].get("price", entree))
        return Trade(sens=sens, date_entree=date, prix_entree=execution,
                     stop=stop, objectif=objectif, quantite=unites)
