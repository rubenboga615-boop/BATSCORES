"""Le bot de trading, qui tourne dans Termux (ou sur n'importe quel serveur Linux).

Mode papier (aucun compte, argent fictif simulé, prix réels de Binance) :
    python bot.py --marche BTCUSDT --unite H1

Compte démo OANDA (forex) :
    export OANDA_TOKEN=...   export OANDA_COMPTE=...
    python bot.py --courtier oanda --marche EUR_USD --unite H1

Le bot ne décide qu'une fois par bougie clôturée, comme le backtester.
Arrêt : Ctrl+C. Il reprend où il en était au redémarrage (fichiers dans donnees/).
"""

import argparse
import csv
import os
import sys
import time
from datetime import datetime, timezone

from courtiers import Oanda, Papier
from sources import ErreurReseau, bougies_binance, bougies_oanda
from strategie import Parametres, decision

DOSSIER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "donnees")


def maintenant_texte():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


class Bot:
    def __init__(self, courtier, lire_bougies, marche, p, journal=None, etat=None, log=print):
        self.courtier = courtier
        self.lire_bougies = lire_bougies  # fonction () -> (bougies_cloturees, prix_actuel)
        self.marche = marche
        self.p = p
        self.journal = journal
        self.log = log
        # derniere_bougie : la dernière bougie traitée ; jour / equite_debut_jour : limite du jour
        self.etat = etat if etat is not None else {}

    def _noter(self, evenement, t):
        if not self.journal:
            return
        nouveau = not os.path.exists(self.journal)
        with open(self.journal, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if nouveau:
                w.writerow(["evenement", "date_entree", "sens", "entree", "stop", "objectif",
                            "quantite", "date_sortie", "sortie", "resultat", "R"])
            w.writerow([evenement, t.date_entree, "achat" if t.sens == 1 else "vente",
                        round(t.prix_entree, 6), round(t.stop, 6), round(t.objectif, 6),
                        round(t.quantite, 6), t.date_sortie, round(t.prix_sortie, 6),
                        round(t.resultat, 2), round(t.r, 2)])

    def _limite_du_jour_atteinte(self, prix_actuel):
        equite = self.courtier.equite(prix_actuel)
        jour = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self.etat.get("jour") != jour:
            self.etat["jour"], self.etat["equite_debut_jour"] = jour, equite
        debut = self.etat["equite_debut_jour"]
        return debut > 0 and (debut - equite) / debut * 100 >= self.p.perte_max_jour_pct

    def cycle(self):
        """Un passage complet. Renvoie True si une nouvelle bougie a été traitée."""
        bougies, prix_actuel = self.lire_bougies()
        if not bougies:
            self.log("Aucune bougie reçue.")
            return False
        derniere = f"{bougies[-1].date} {bougies[-1].heure}"
        deja_vue = self.etat.get("derniere_bougie")
        if derniere == deja_vue:
            return False

        if deja_vue is None:
            # Premier lancement : on ne trade pas sur un signal qui a peut-être déjà
            # une heure de retard. On attend la prochaine clôture.
            self.etat["derniere_bougie"] = derniere
            self.log(f"Démarrage : dernière bougie clôturée {derniere}. J'attends la suivante.")
            return True

        # 1) Suivi de la position (stop / objectif) sur les nouvelles bougies
        nouvelles = [b for b in bougies if f"{b.date} {b.heure}" > deja_vue]
        for t in self.courtier.suivre(nouvelles):
            self.log(f"SORTIE {'achat' if t.sens == 1 else 'vente'} à {t.prix_sortie:.5f} : "
                     f"{t.r:+.2f} R ({t.resultat:+.2f})")
            self._noter("sortie", t)
        self.etat["derniere_bougie"] = derniere

        # 2) Nouvelle entrée ?
        if self.courtier.position_ouverte(self.marche):
            self.log(f"Bougie {derniere} : position déjà ouverte, rien à faire.")
            return True
        if self._limite_du_jour_atteinte(prix_actuel):
            self.log(f"Bougie {derniere} : limite de perte du jour atteinte, pas de trade.")
            return True
        sens, distance = decision(bougies, self.p)
        if sens == 0:
            self.log(f"Bougie {derniere} : pas de signal (prix {prix_actuel}).")
            return True
        try:
            t = self.courtier.ouvrir(self.marche, sens, distance, self.p,
                                     prix_actuel, derniere, maintenant_texte())
        except (ValueError, ErreurReseau) as e:
            self.log(f"Signal {'ACHAT' if sens == 1 else 'VENTE'} ignoré : {e}")
            return True
        self.log(f"ENTRÉE {'ACHAT' if sens == 1 else 'VENTE'} à {t.prix_entree:.5f}, "
                 f"stop {t.stop:.5f}, objectif {t.objectif:.5f}, quantité {t.quantite:.6g}")
        self._noter("entree", t)
        return True


def _charger_etat(chemin):
    import json
    if os.path.exists(chemin):
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _sauver_etat(chemin, etat):
    import json
    with open(chemin + ".tmp", "w", encoding="utf-8") as f:
        json.dump(etat, f, indent=2)
    os.replace(chemin + ".tmp", chemin)


def main(argv=None):
    a = argparse.ArgumentParser(description="Bot de trading de tendance")
    a.add_argument("--courtier", choices=["papier", "oanda"], default="papier")
    a.add_argument("--source", choices=["binance", "oanda"],
                   help="d'où viennent les prix en mode papier (binance par défaut)")
    a.add_argument("--marche", default="BTCUSDT", help="ex. BTCUSDT (Binance) ou EUR_USD (OANDA)")
    a.add_argument("--unite", default="H1", help="M15, M30, H1, H4 ou D1")
    a.add_argument("--rapide", type=int, default=20)
    a.add_argument("--lente", type=int, default=50)
    a.add_argument("--atr", type=int, default=14)
    a.add_argument("--stop-atr", type=float, default=1.5)
    a.add_argument("--ratio", type=float, default=2.0)
    a.add_argument("--risque", type=float, default=1.0, help="%% du capital par trade (max 5)")
    a.add_argument("--perte-max-jour", type=float, default=3.0)
    a.add_argument("--capital", type=float, default=10_000.0, help="capital fictif (papier)")
    a.add_argument("--spread", type=float, default=0.0, help="coût simulé par trade (papier)")
    a.add_argument("--pause", type=int, default=60, help="secondes entre deux vérifications")
    a.add_argument("--une-fois", action="store_true", help="un seul passage puis arrêt")
    a.add_argument("--reel", action="store_true", help="compte OANDA RÉEL (déconseillé)")
    a.add_argument("--je-comprends-le-risque", action="store_true")
    args = a.parse_args(argv)

    if args.rapide >= args.lente:
        a.error("--rapide doit être plus petit que --lente")
    if not 0 < args.risque <= 5:
        a.error("--risque doit être entre 0 et 5")
    if args.reel and not (args.courtier == "oanda" and args.je_comprends_le_risque):
        a.error("--reel exige --courtier oanda et --je-comprends-le-risque (voir cours/06)")

    p = Parametres(mm_rapide=args.rapide, mm_lente=args.lente, periode_atr=args.atr,
                   stop_atr=args.stop_atr, ratio_objectif=args.ratio, risque_pct=args.risque,
                   perte_max_jour_pct=args.perte_max_jour)
    nombre = max(p.mm_lente, p.periode_atr) + 50

    os.makedirs(DOSSIER, exist_ok=True)
    nom = f"{args.courtier}_{args.marche}_{args.unite}"
    fichier_log = os.path.join(DOSSIER, f"{nom}.log")

    def log(message):
        ligne = f"[{maintenant_texte()} UTC] {message}"
        print(ligne, flush=True)
        with open(fichier_log, "a", encoding="utf-8") as f:
            f.write(ligne + "\n")

    oanda = None
    if args.courtier == "oanda" or args.source == "oanda":
        try:
            oanda = Oanda(os.environ.get("OANDA_TOKEN"), os.environ.get("OANDA_COMPTE"), reel=args.reel)
        except ValueError as e:
            a.error(str(e))

    if args.courtier == "papier":
        courtier = Papier(os.path.join(DOSSIER, f"{nom}_compte.json"), args.capital, args.spread)
    else:
        courtier = oanda

    if (args.source or ("oanda" if args.courtier == "oanda" else "binance")) == "oanda":
        def lire():
            return bougies_oanda(oanda, args.marche, args.unite, nombre)
    else:
        def lire():
            return bougies_binance(args.marche, args.unite, nombre)

    fichier_etat = os.path.join(DOSSIER, f"{nom}_etat.json")
    bot = Bot(courtier, lire, args.marche, p,
              journal=os.path.join(DOSSIER, f"{nom}_journal.csv"),
              etat=_charger_etat(fichier_etat), log=log)

    type_compte = "papier (fictif)" if args.courtier == "papier" else (
        "OANDA RÉEL" if args.reel else "OANDA démo")
    log(f"Bot lancé : {args.marche} {args.unite}, compte {type_compte}, "
        f"MM {p.mm_rapide}/{p.mm_lente}, risque {p.risque_pct} %")

    while True:
        try:
            bot.cycle()
            _sauver_etat(fichier_etat, bot.etat)
        except ErreurReseau as e:
            log(f"Problème réseau, nouvel essai dans {args.pause} s : {e}")
        except KeyboardInterrupt:
            break
        except Exception as e:  # le bot ne doit pas mourir sur une réponse inattendue
            log(f"ERREUR inattendue ({type(e).__name__}: {e}), nouvel essai dans {args.pause} s")
        if args.une_fois:
            break
        try:
            time.sleep(args.pause)
        except KeyboardInterrupt:
            break
    log("Bot arrêté.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
