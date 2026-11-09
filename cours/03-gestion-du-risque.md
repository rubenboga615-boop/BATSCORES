# Module 3 : la gestion du risque

C'est **le module le plus important**. Une bonne entrée avec un mauvais
risque finit par ruiner un compte ; une entrée moyenne avec un bon risque
peut survivre et progresser.

## La règle des 1 %

Sur chaque trade, tu ne perds **au maximum que 1 % de ton capital** si le
stop est touché. Avec 10 000 €, ta perte maximale est donc de 100 € par trade.

Pourquoi ? Même 10 pertes d'affilée (ça arrive) ne coûtent qu'environ 10 %.
À 10 % par trade, 10 pertes d'affilée te laissent 35 % du compte.

## Le « R »

**1 R = la somme que tu risques sur un trade** (la distance jusqu'au stop).
On mesure tout en R :
- stop touché : −1 R ;
- objectif à 2 fois la distance du stop touché : +2 R.

## Calculer la taille de position

```
lots = argent risqué / (distance du stop en pips × valeur du pip pour 1 lot)
```

Exemple : capital 10 000 €, risque 1 % = 100 €, stop à 20 pips, EURUSD
(environ 10 € par pip pour 1 lot) :
`100 / (20 × 10) = 0,50 lot`.

**Le stop se place d'abord** (là où l'idée du trade devient fausse), et la
taille de position en découle. Jamais l'inverse.

Le bot fait exactement ce calcul au moment d'ouvrir un trade (`ouvrir` dans
`bot/python/courtiers.py`).

## L'espérance : pourquoi on peut gagner en perdant souvent

```
espérance (en R) = taux de réussite × gain moyen − taux d'échec × perte moyenne
```

Avec un ratio 1:2 (on gagne 2 R, on perd 1 R) :
- 40 % de réussite : 0,4 × 2 − 0,6 × 1 = **+0,2 R** par trade → rentable ;
- 33 % de réussite : 0,33 × 2 − 0,67 × 1 ≈ **0** → à l'équilibre ;
- 30 % de réussite : **négatif**.

## Le drawdown

Le **drawdown** est la baisse entre le plus haut de ton capital et le creux
qui suit. Il faut le prévoir : une stratégie à 40 % de réussite connaît
régulièrement des séries de 6 à 8 pertes d'affilée.

Pour récupérer d'un drawdown, il faut plus que la perte :
| Perte | Gain nécessaire pour revenir |
|---|---|
| −10 % | +11 % |
| −25 % | +33 % |
| −50 % | +100 % |

## Exercices

1. Capital 5 000 €, risque 1 %, stop à 25 pips sur EURUSD. Quelle taille de
   position ?
2. Même capital et même risque, mais stop à 50 pips. Quelle taille ? Que
   remarques-tu ?
3. Une stratégie gagne 35 % du temps avec un ratio 1:2,5. Est-elle rentable ?
   Quelle est son espérance par trade ?
4. Tu as 10 000 € et tu enchaînes 8 pertes à 1 %. Combien te reste-t-il ? Et
   avec 5 % par trade ?
5. Lance le backtester (`bot/python`) avec `--risque 1` puis `--risque 5`.
   Compare le drawdown maximal.

## Corrigés

1. 50 € / (25 × 10) = **0,20 lot**.
2. 50 € / (50 × 10) = **0,10 lot**. Le stop est deux fois plus loin, donc la
   position est deux fois plus petite : **la perte reste 50 €**. C'est tout
   l'intérêt.
3. 0,35 × 2,5 − 0,65 × 1 = 0,875 − 0,65 = **+0,225 R** par trade → rentable
   (avant frais).
4. À 1 % : 10 000 × 0,99⁸ ≈ **9 227 €**. À 5 % : 10 000 × 0,95⁸ ≈ **6 634 €**.
5. Le drawdown est environ 5 fois plus grand avec 5 %, alors que la stratégie
   est la même. Le risque par trade se choisit, pas la chance.
