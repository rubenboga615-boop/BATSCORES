# Module 1 : les marchés et les bougies

## Ce que tu achètes vraiment

- **Forex** : une paire de devises. Acheter `EURUSD` à 1,0850, c'est parier
  que l'euro va monter face au dollar.
- **Indices** (US500, GER40…), **matières premières** (or = `XAUUSD`),
  **crypto**, **actions**.
- Dans MT5, tu trades le plus souvent des **CFD** : tu ne possèdes pas l'actif,
  tu encaisses ou paies la variation de prix. Tu peux donc gagner à la hausse
  (**achat**, *buy*, *long*) comme à la baisse (**vente**, *sell*, *short*).

## Le vocabulaire indispensable

| Mot | Sens |
|---|---|
| **Bid** | Prix auquel tu **vends** |
| **Ask** | Prix auquel tu **achètes** (toujours un peu plus haut) |
| **Spread** | Ask − Bid : ton coût d'entrée, payé à chaque trade |
| **Pip** | Le 4e chiffre après la virgule sur EURUSD (0,0001) |
| **Lot** | La taille d'une position. 1 lot standard en forex = 100 000 unités ; 0,01 lot = 1 000 unités (micro-lot) |
| **Levier** | Te permet d'ouvrir une position plus grosse que ton capital. Il **multiplie les pertes autant que les gains** |
| **Stop loss (SL)** | Ordre qui ferme le trade automatiquement à un prix de perte fixé d'avance |
| **Take profit (TP)** | Ordre qui ferme le trade à un prix de gain fixé |

Repère utile : sur EURUSD, **1 pip pour 1 lot = environ 10 $** ; pour 0,10 lot,
environ 1 $ ; pour 0,01 lot, environ 0,10 $.

## Lire une bougie

Chaque bougie résume une période (1 minute, 1 heure, 1 jour…) avec 4 prix :

```
      |   <- plus haut (high)
    ┌───┐ <- clôture (close)        bougie VERTE : clôture > ouverture (ça a monté)
    │   │
    └───┘ <- ouverture (open)
      |   <- plus bas (low)
```

Pour une bougie **rouge**, c'est l'inverse : l'ouverture est en haut du corps
et la clôture en bas.

- **Corps** long : un camp (acheteurs ou vendeurs) a dominé.
- **Mèche** longue : le prix est allé loin, puis a été repoussé. Une longue
  mèche basse montre que des acheteurs sont intervenus.

## Les unités de temps

Plus l'unité est petite (M1, M5), plus il y a de « bruit » et de spread payé
proportionnellement. Pour apprendre, travaille en **H1 (1 heure) ou H4**, et
regarde le **D1 (journalier)** pour avoir le contexte.

## Exercices

1. Tu achètes EURUSD à 1,08500 et tu revends à 1,08750. Combien de pips
   as-tu gagné ? Combien d'argent avec 0,10 lot ?
2. Le Bid est à 1,08500 et l'Ask à 1,08515. Quel est le spread en pips ?
   Combien te coûte-t-il sur un trade de 1 lot ?
3. Une bougie H1 a ouvert à 1,0850, clôturé à 1,0830, avec un plus haut à
   1,0855 et un plus bas à 1,0825. Est-elle verte ou rouge ? Dessine-la.
4. Dans TradingView (Replay, EURUSD H1), trouve 3 bougies avec une longue
   mèche basse. Que fait le prix dans les 5 bougies suivantes ?

## Corrigés

1. 1,08750 − 1,08500 = 0,00250 → **25 pips**. Avec 0,10 lot (1 $ par pip) :
   **25 $**.
2. 0,00015 → **1,5 pip**. Pour 1 lot (10 $/pip) : **15 $** de coût dès
   l'ouverture. Le trade démarre toujours légèrement perdant.
3. Clôture (1,0830) < ouverture (1,0850) : **rouge**. Corps de 1,0850 à 1,0830,
   mèche haute jusqu'à 1,0855, mèche basse jusqu'à 1,0825.
4. Pas de réponse unique. Tu verras que parfois le prix remonte et parfois
   non : **aucun signal ne marche à tous les coups**. C'est pour ça que la
   gestion du risque (module 3) compte plus que l'entrée.
