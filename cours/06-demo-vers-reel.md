# Module 6 : du démo au réel

Passer en réel est une **décision**, pas une étape automatique. Beaucoup de
gens restent en démo plus longtemps, et c'est très bien.

## La checklist (tout doit être coché)

- [ ] J'ai fait les exercices des modules 0 à 5.
- [ ] Mon backtest porte sur **au moins 2 ans et 100 trades**, avec un spread
      réaliste, et il est positif sur la partie « vérification » (dernier tiers).
- [ ] Le bot a tourné **au moins 3 mois en démo**, avec des résultats proches
      du backtest.
- [ ] Mon journal montre que je **respecte mes règles** (je n'ai pas coupé ou
      modifié le bot sur un coup de tête).
- [ ] L'argent que je vais mettre est de l'argent **que je peux perdre en
      entier** sans conséquence sur ma vie (loyer, factures, dettes).
- [ ] Mon courtier est **régulé** (AMF en France, ou FCA, CySEC…) et figure
      dans les registres officiels. Je vérifie la liste noire de l'AMF.

## Comment démarrer en réel

1. Commence **petit** : le plus petit capital possible et 0,5 % de risque par
   trade.
2. Le bot refuse le réel par défaut. Il faut le lancer avec
   `--reel --je-comprends-le-risque`, et un jeton OANDA du compte réel.
3. Pour qu'il tourne en continu : un **petit serveur Linux** (VPS, environ
   4 à 5 € par mois) plutôt que le téléphone. Le même code y tourne tel quel :
   `git clone`, puis la même commande que dans Termux.
4. Compare chaque mois réel / démo / backtest.

## Quand arrêter le bot

Fixe ces règles **avant** de commencer :
- drawdown supérieur à **1,5 fois** le pire drawdown du backtest → arrêt et
  analyse ;
- 3 mois consécutifs nettement en dessous du backtest → retour en démo.

## Les pièges à connaître

- **Le levier** : 1:30 te permet beaucoup, mais c'est ta règle des 1 % qui
  décide de la taille, pas le levier disponible.
- **Les week-ends et les annonces** (taux d'intérêt, emploi américain) : le
  prix peut sauter par-dessus ton stop (*gap*). La perte peut alors dépasser
  1 R.
- **Les arnaques** : faux courtiers, « gestionnaires de compte », robots
  vendus avec des résultats parfaits, demandes de virement vers des cryptos.
  Ne donne jamais tes identifiants de compte.
- **La fiscalité** : en France, les gains doivent être déclarés. Renseigne-toi
  (formulaire 2074, ou BNC selon les cas).

## Exercice final

Remplis la checklist honnêtement. Pour chaque case non cochée, écris ce qu'il
te manque et combien de temps il te faut. Si une seule case reste vide, tu
restes en démo.
