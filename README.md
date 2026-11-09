# Trading : cours, exercices et bot

Ce dépôt sert à apprendre le trading pas à pas, puis à construire un vrai bot
en **Python** qui tourne sur un téléphone Android dans **Termux** (puis sur un
petit serveur). Il est testé d'abord sur des données historiques, ensuite en
**compte papier**, puis en **compte démo**.

> **Règle n° 1 : pas d'argent réel tant que tu n'as pas fini le cours ET tenu
> au moins 3 mois rentables en démo avec le bot.** La majorité des traders
> particuliers perdent de l'argent, surtout avec le levier (CFD, forex). Ce
> dépôt est un outil d'apprentissage, pas un conseil en investissement.

## Le plan

Le plan d'attaque complet, étape par étape et avec les critères pour passer à
la suite : [`PLAN.md`](PLAN.md).

## Le parcours

| Étape | Contenu | Où |
|---|---|---|
| 0 | Termux, MT5 et TradingView, compte démo | [`cours/00-mise-en-place.md`](cours/00-mise-en-place.md) |
| 1 | Les marchés, les bougies, le spread | [`cours/01-marches-et-bougies.md`](cours/01-marches-et-bougies.md) |
| 2 | Tendance, supports/résistances, moyennes mobiles | [`cours/02-tendance-et-indicateurs.md`](cours/02-tendance-et-indicateurs.md) |
| 3 | Gestion du risque : la compétence n° 1 | [`cours/03-gestion-du-risque.md`](cours/03-gestion-du-risque.md) |
| 4 | Écrire une stratégie et la tester (backtest, journal) | [`cours/04-strategie-et-backtest.md`](cours/04-strategie-et-backtest.md) |
| 5 | Le bot : le lancer dans Termux, en papier puis en démo | [`cours/05-le-bot-termux.md`](cours/05-le-bot-termux.md) |
| 6 | Du démo au réel : la checklist | [`cours/06-demo-vers-reel.md`](cours/06-demo-vers-reel.md) |
| Annexe | La version du bot pour MetaTrader 5 sur ordinateur | [`cours/annexe-bot-mt5.md`](cours/annexe-bot-mt5.md) |

Chaque module se termine par des **exercices**, avec les corrigés à la fin du
module (essaie avant de regarder).

## Le bot (`bot/python/`, aucune dépendance à installer)

| Fichier | Rôle |
|---|---|
| `bot.py` | Le bot en direct : mode **papier** (prix réels, argent fictif, sans compte) ou **OANDA** (compte démo) |
| `backtest.py` | Teste la stratégie sur l'historique |
| `telecharger.py` | Télécharge l'historique (Binance pour la crypto, OANDA pour le forex) |
| `strategie.py` | Les règles, partagées par le bot et le backtest |

### La stratégie (volontairement simple)

1. **Filtre de tendance** : on n'achète que si la moyenne mobile rapide est
   au-dessus de la lente, on ne vend que dans le cas inverse.
2. **Entrée** : au croisement des deux moyennes, à la clôture de la bougie.
3. **Stop** : à `1,5 × ATR` du prix d'entrée (il s'adapte à la volatilité).
4. **Objectif** : `2 × la distance du stop` (ratio 1:2).
5. **Taille de position** : calculée pour risquer **1 % du capital** par trade.
6. **Sécurités** : une seule position à la fois, arrêt pour la journée après
   3 % de perte, et **refus du compte réel** sauf autorisation explicite.

Ce n'est pas une stratégie miracle : c'est une base propre que tu vas
apprendre à tester, comprendre et améliorer.

### Démarrage rapide dans Termux

```bash
pkg install python git
cd batscores/bot/python
python -m unittest discover tests                        # vérifier que tout marche
python telecharger.py binance BTCUSDT H1 2 btc_h1.csv     # 2 ans d'historique
python backtest.py btc_h1.csv --spread 20
python bot.py --marche BTCUSDT --unite H1                 # le bot, en papier
```

Une version pour MetaTrader 5 sur ordinateur existe aussi
(`bot/mql5/BotTendance.mq5`, voir l'annexe).
