# Module 4 : écrire une stratégie et la tester

## Une stratégie = des règles écrites, sans interprétation

Si deux personnes appliquent tes règles sur le même graphique, elles doivent
prendre **exactement les mêmes trades**. Sinon, ce n'est pas encore une
stratégie, et on ne peut pas en faire un bot.

Une stratégie complète répond à 5 questions :
1. **Quel marché et quelle unité de temps ?** (EURUSD, H1)
2. **Quand j'entre ?** (croisement MM 20 / MM 50, à la clôture de la bougie)
3. **Où est mon stop ?** (1,5 × ATR 14)
4. **Où je sors en gain ?** (2 × la distance du stop)
5. **Combien je risque ?** (1 % ; arrêt pour la journée à −3 %)

## Le backtest

Un **backtest** rejoue la stratégie sur des prix passés pour voir ce
qu'elle aurait donné.

### Récupérer de vraies données (dans Termux)

```bash
cd bot/python
# Crypto : aucun compte nécessaire
python telecharger.py binance BTCUSDT H1 2 btc_h1.csv
# Forex : il faut le compte démo OANDA du module 5
python telecharger.py oanda EUR_USD H1 2 eurusd_h1.csv
```

Le dernier nombre avant le nom du fichier est le nombre d'années
d'historique.

### Lancer le backtester Python

```bash
cd bot/python
python backtest.py eurusd_h1.csv --spread 0.00015
python backtest.py eurusd_h1.csv --spread 0.00015 --trades   # liste des trades
python backtest.py btc_h1.csv --spread 20                   # Bitcoin : spread en dollars
```

Mets toujours un **spread réaliste** : sans frais, presque tout a l'air
rentable.

### Lire les résultats

| Statistique | Ce qu'elle dit | Repère |
|---|---|---|
| Nombre de trades | Taille de l'échantillon | Moins de 100 : on ne peut rien conclure |
| Taux de réussite | % de trades gagnants | Avec un ratio 1:2, au-dessus de 33 % pour être rentable |
| Profit factor | Gains totaux / pertes totales | > 1,3 est intéressant ; > 3 est suspect (vérifie ton test) |
| R moyen | Espérance par trade | > 0,1 R après frais |
| Drawdown max | Pire baisse du capital | Est-ce que tu le supporterais sans tout arrêter ? |

### Le piège n° 1 : la sur-optimisation

Si tu essaies 200 combinaisons de paramètres et que tu gardes la meilleure,
tu as surtout trouvé celle qui colle **au hasard** de ces données passées.
Elle échouera sur la suite.

Méthode honnête :
1. Coupe tes données en deux : **2 premiers tiers** pour chercher les
   paramètres, **dernier tiers** pour vérifier (sans toucher à rien).
2. Préfère des paramètres « ronds » et robustes : si 20/50 marche mais que
   18/50 et 22/50 s'effondrent, c'est de la chance.
3. Teste sur **plusieurs marchés** (EURUSD, GBPUSD, l'or).

## Le journal de trading

Pour chaque trade (manuel ou bot), note :

| Date | Marché | Sens | Entrée | Stop | Objectif | Lots | Résultat (R) | Raison de l'entrée | Ai-je respecté mes règles ? | Émotion |
|---|---|---|---|---|---|---|---|---|---|---|

La colonne « Ai-je respecté mes règles ? » est la plus importante au début.

## Exercices

1. Écris ta propre version de la stratégie en répondant aux 5 questions,
   sans regarder la nôtre.
2. Génère des données fictives et lance le backtest :
   `python3 generer_donnees.py fictif.csv` puis `python3 backtest.py fictif.csv`.
   Change la graine (`python3 generer_donnees.py fictif2.csv 5000 7`) : les
   résultats changent-ils beaucoup ? Qu'en conclus-tu ?
3. Télécharge 2 ans de BTCUSDT H1 (et d'EURUSD H1 quand tu auras ton compte
   OANDA) et fais le backtest avec un spread réaliste. Note les 5 statistiques.
4. Teste `--rapide 10 --lente 30`, `--rapide 50 --lente 200` et
   `--stop-atr 2`. Garde la meilleure, puis vérifie-la sur le dernier tiers
   des données seulement (copie la fin du fichier dans un autre `.csv`, en
   gardant la ligne d'en-tête).
5. En TradingView Replay, prends 20 trades à la main avec les règles du bot
   et remplis ton journal.

## Corrigés

1. Compare avec la nôtre : as-tu oublié le stop ou la taille de position ?
   C'est l'oubli le plus fréquent.
2. Les résultats varient beaucoup d'une graine à l'autre : sur des prix
   aléatoires, la stratégie n'a pas d'avantage réel, les gains et les pertes
   viennent du hasard. **Un bon backtest ne prouve rien s'il n'est pas répété
   sur des données réelles et variées.**
3. Pas de réponse unique ; garde ces chiffres, ce sont tes références.
4. Le plus souvent, les résultats sur le dernier tiers sont moins bons que sur
   la partie où tu as choisi les paramètres. Plus l'écart est grand, plus tu
   as sur-optimisé.
5. Compare tes 20 trades manuels avec la liste `--trades` du backtester sur la
   même période. Les différences montrent où tu as « interprété » les règles.
