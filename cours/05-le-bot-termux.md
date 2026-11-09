# Module 5 : le bot dans Termux

Le bot est dans `bot/python/`. Il tourne sur ton téléphone dans **Termux**,
puis plus tard sur un petit serveur Linux, avec exactement le même code.

## Comment il fonctionne

```
 toutes les 60 s :
   1. il lit les prix sur internet ............ sources.py
   2. une nouvelle bougie est clôturée ?
        non -> il attend
        oui -> stop ou objectif touché ? ....... courtiers.py
               une position déjà ouverte ?
               limite de perte du jour atteinte ?
               croisement des moyennes ? ....... strategie.py (la même que le backtest)
   3. si oui : il calcule la taille (1 %) et passe l'ordre AVEC stop et objectif
   4. il note tout dans donnees/ ............... journal + historique
```

| Fichier | Rôle |
|---|---|
| `strategie.py` | Les règles (moyennes, ATR, signal, stop, objectif). Partagé avec le backtest |
| `sources.py` | Lit les prix : Binance (crypto, sans compte) ou OANDA (forex) |
| `courtiers.py` | Passe les ordres : **papier** (compte fictif) ou **OANDA** (démo) |
| `bot.py` | La boucle principale et les sécurités |
| `telecharger.py` | Télécharge l'historique pour le backtest |

Les sécurités sont les mêmes que dans la version MT5 : une seule position à
la fois, 1 % de risque, arrêt pour la journée à −3 %, et **refus du compte
réel** sauf avec `--reel --je-comprends-le-risque`. Au premier lancement, il
ne trade pas tout de suite : il attend la clôture de la bougie suivante.

## Étape 1 : le mode papier (aucun compte)

Le bot lit les **vrais prix** du Bitcoin sur Binance, mais tient lui-même un
compte **fictif** de 10 000 $.

```bash
cd ~/batscores/bot/python
python bot.py --marche BTCUSDT --unite H1
```

Tu dois voir :

```
[... UTC] Bot lancé : BTCUSDT H1, compte papier (fictif), MM 20/50, risque 1.0 %
[... UTC] Démarrage : dernière bougie clôturée .... J'attends la suivante.
```

Puis, une fois par heure, une ligne « pas de signal », une **ENTRÉE** ou une
**SORTIE**. `Ctrl+C` arrête le bot ; il reprend où il en était au prochain
lancement.

Tout est enregistré dans `bot/python/donnees/` :
- `papier_BTCUSDT_H1.log` : tout ce que le bot a dit ;
- `papier_BTCUSDT_H1_journal.csv` : tes trades (entrée, stop, objectif, résultat en R) ;
- `papier_BTCUSDT_H1_compte.json` : le capital fictif et la position ouverte.

Pour repartir de zéro : supprime ces fichiers.

### Le laisser tourner en arrière-plan

Android a tendance à endormir Termux. Pour l'en empêcher :

1. Paramètres Android > Applications > Termux > Batterie : **Non optimisée**
   (ou « Sans restriction »).
2. Dans Termux :
   ```bash
   termux-wake-lock
   nohup python bot.py --marche BTCUSDT --unite H1 > /dev/null 2>&1 &
   tail -f donnees/papier_BTCUSDT_H1.log       # regarder (Ctrl+C pour quitter la vue)
   pkill -f bot.py                             # arrêter le bot
   ```
3. Laisse le téléphone en charge et connecté au wifi.

Même comme ça, le téléphone n'est pas fiable à 100 % (redémarrage, réseau
coupé). C'est suffisant pour apprendre ; pour la démo de 3 mois (phase 5), on
passera sur un serveur.

## Étape 2 : un vrai compte démo OANDA (forex)

1. Crée un compte **démo** (*practice*) sur le site d'OANDA. Si OANDA
   n'accepte pas les résidents de ton pays, dis-le-moi : on branchera un
   autre courtier.
2. Dans ton espace OANDA, va dans **Gérer l'accès API** (*Manage API
   Access*) et génère un **jeton** (*token*).
3. Note ton **numéro de compte**, de la forme `101-004-1234567-001`.
4. Dans Termux, range-les dans un fichier que toi seul peux lire :
   ```bash
   cat > ~/.oanda <<'FIN'
   export OANDA_TOKEN=colle-ton-jeton-ici
   export OANDA_COMPTE=101-004-1234567-001
   FIN
   chmod 600 ~/.oanda
   source ~/.oanda
   ```

> **Le jeton est comme un mot de passe.** Ne le mets jamais dans le dépôt
> git, ne le colle jamais dans une conversation (y compris avec moi), ne
> l'envoie à personne. Si tu penses qu'il a fuité, révoque-le sur OANDA et
> crées-en un autre.

Puis lance le bot sur EURUSD :

```bash
source ~/.oanda
python bot.py --courtier oanda --marche EUR_USD --unite H1
```

Ici le stop et l'objectif sont **chez OANDA** : même si ton téléphone
s'éteint, ils restent actifs. Tu vois les trades dans l'appli ou le site
OANDA.

## Exercices

1. Lance le bot en mode papier sur BTCUSDT H1 et laisse-le tourner 24 h.
   Envoie-moi le fichier `.log`.
2. Lance un deuxième bot papier en même temps, sur `ETHUSDT` en `H4` (un autre
   terminal Termux : glisse depuis le bord gauche > *New session*). Les deux
   ont-ils des fichiers séparés dans `donnees/` ?
3. Télécharge 2 ans de BTCUSDT H1 avec `telecharger.py` et fais le backtest.
   Combien de trades par mois en moyenne ? Est-ce cohérent avec ce que le
   bot papier fait en une semaine ?
4. Ouvre ton compte démo OANDA et lance le bot sur EUR_USD avec `--une-fois`.
   Le message doit indiquer « compte OANDA démo ».
5. **Amélioration à coder** : ajoute un filtre de tendance longue, à savoir
   n'acheter que si le prix est au-dessus de la moyenne mobile 200, et ne
   vendre qu'en dessous. Indice : dans `decision()` (`strategie.py`), calcule
   `moyenne_mobile(closes, 200)` et compare-la à `closes[i]`. Fais la même
   chose dans `backtester()`, puis compare les résultats avant et après.

## Corrigés

1. Tu dois voir une ligne par heure. Des trous de plusieurs heures signifient
   qu'Android a endormi Termux : revois les réglages de batterie.
2. Oui : chaque combinaison courtier + marché + unité de temps a ses propres
   fichiers. On peut donc faire tourner plusieurs bots sans qu'ils se gênent.
3. Divise le nombre de trades par 24 mois. En H1, la stratégie fait en général
   quelques trades par semaine. Si le bot papier en fait beaucoup plus ou
   beaucoup moins, envoie-moi les deux fichiers.
4. Si tu vois `HTTP 401`, le jeton est faux ou mal copié. Si tu vois
   `HTTP 403` ou une erreur sur le compte, le numéro de compte est faux.
5. Pistes pour le code :
   ```python
   # dans decision(), après avoir calculé s :
   filtre = moyenne_mobile(closes, 200)[i]
   if filtre is None or (s == 1 and closes[i] < filtre) or (s == -1 and closes[i] > filtre):
       return 0, None
   ```
   Il faut aussi au moins 201 bougies : dans `bot.py`, augmente `nombre`.
   Vérifie avec le backtest si le filtre améliore vraiment le R moyen. Envoie-
   moi ta version, je la relis.

## Et MetaTrader 5 ?

L'ancienne version du bot pour MT5 sur ordinateur est conservée dans
[l'annexe](annexe-bot-mt5.md), au cas où tu aurais un jour un ordinateur ou
un VPS Windows.
