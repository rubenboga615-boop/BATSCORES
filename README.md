# Trading : cours, exercices et bot

Ce dépôt sert à apprendre le trading pas à pas, puis à construire un vrai bot
pour **MetaTrader 5**, testé d'abord sur des données historiques, puis sur un
**compte démo**.

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
| 0 | Installer MT5 et TradingView, ouvrir un compte démo | [`cours/00-mise-en-place.md`](cours/00-mise-en-place.md) |
| 1 | Les marchés, les bougies, le spread | [`cours/01-marches-et-bougies.md`](cours/01-marches-et-bougies.md) |
| 2 | Tendance, supports/résistances, moyennes mobiles | [`cours/02-tendance-et-indicateurs.md`](cours/02-tendance-et-indicateurs.md) |
| 3 | Gestion du risque : la compétence n° 1 | [`cours/03-gestion-du-risque.md`](cours/03-gestion-du-risque.md) |
| 4 | Écrire une stratégie et la tester (backtest, journal) | [`cours/04-strategie-et-backtest.md`](cours/04-strategie-et-backtest.md) |
| 5 | Le bot : l'installer et le tester dans MT5 | [`cours/05-le-bot-mt5.md`](cours/05-le-bot-mt5.md) |
| 6 | Du démo au réel : la checklist | [`cours/06-demo-vers-reel.md`](cours/06-demo-vers-reel.md) |

Chaque module se termine par des **exercices**, avec les corrigés à la fin du
module (essaie avant de regarder).

## Le bot

Deux parties qui appliquent **la même stratégie** :

- [`bot/mql5/BotTendance.mq5`](bot/mql5/BotTendance.mq5) : l'Expert Advisor
  (le bot) qui tourne dans MetaTrader 5.
- [`bot/python/`](bot/python/) : un backtester en Python (sans aucune
  dépendance) pour tester et modifier la stratégie sur un fichier de prix
  exporté de MT5, même sur un ordinateur sans MT5.

### La stratégie (volontairement simple)

1. **Filtre de tendance** : on n'achète que si la moyenne mobile rapide est
   au-dessus de la lente, on ne vend que dans le cas inverse.
2. **Entrée** : au croisement des deux moyennes, à la clôture de la bougie.
3. **Stop** : à `1,5 × ATR` du prix d'entrée (il s'adapte à la volatilité).
4. **Objectif** : `2 × la distance du stop` (ratio 1:2).
5. **Taille de position** : calculée pour risquer **1 % du capital** par trade.
6. **Sécurités** : une seule position à la fois, arrêt pour la journée après
   3 % de perte, et **refus de tourner sur un compte réel** sauf si tu
   l'autorises explicitement.

Ce n'est pas une stratégie miracle : c'est une base propre que tu vas
apprendre à tester, comprendre et améliorer dans les modules 4 et 5.

### Essai rapide du backtester

```bash
cd bot/python
python3 generer_donnees.py donnees_exemple.csv   # prix fictifs pour s'entraîner
python3 backtest.py donnees_exemple.csv
python3 -m unittest discover tests              # vérifier que tout marche
```
