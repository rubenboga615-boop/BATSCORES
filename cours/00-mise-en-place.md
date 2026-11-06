# Module 0 : mise en place

Objectif : avoir tes outils prêts et un **compte démo** (argent fictif) pour
t'entraîner sans rien risquer.

## Les deux applis que tu as

| Appli | À quoi elle sert | Usage dans ce cours |
|---|---|---|
| **TradingView** | Analyser les graphiques (le meilleur outil pour ça) | Lire les bougies, tracer, tester des idées à la main avec le **mode Replay** |
| **MetaTrader 5** | Passer des ordres chez un courtier, faire tourner des bots | Compte démo, et le **bot** (Expert Advisor) |

## 1. Ouvrir un compte démo MT5

Sur téléphone :
1. Ouvre MetaTrader 5, puis **Paramètres > Nouveau compte**.
2. Choisis un courtier (par exemple `MetaQuotes-Demo`, ou un courtier régulé
   par l'AMF, la FCA ou la CySEC si tu comptes passer en réel plus tard).
3. Choisis **Ouvrir un compte démo**, avec **10 000** de capital et un levier
   **1:30 maximum** (c'est la limite légale en Europe pour le forex).

> Le bot (Expert Advisor) ne tourne **que sur MT5 pour ordinateur** (Windows,
> ou Mac avec la version officielle). Sur téléphone, tu peux trader à la main
> et suivre le bot, mais pas le lancer. Pour qu'il tourne 24 h/24, il faudra un
> ordinateur allumé ou un VPS (un serveur loué) ; on en parle au module 6.

## 2. Préparer TradingView

1. Ouvre le graphique **EURUSD**, en unité de temps **1 heure (1h)**.
2. Passe en **bougies japonaises** (c'est l'affichage par défaut).
3. Repère le bouton **Replay** (en haut) : il permet de revenir dans le passé
   et de faire avancer le graphique bougie par bougie. C'est ton simulateur.

## 3. Tes règles de sécurité (à recopier et à garder)

1. Je ne mets **pas d'argent réel** avant la fin du module 6.
2. Je ne risque **jamais plus de 1 %** de mon capital sur un trade.
3. **Chaque trade a un stop** (un niveau de sortie en cas de perte), placé
   avant d'entrer.
4. Je **note chaque trade** dans mon journal (modèle au module 4).
5. Je me méfie de quiconque promet des gains garantis (« signaux VIP »,
   « robot à 30 % par mois ») : c'est presque toujours une arnaque.

## Exercices

1. Ouvre ton compte démo MT5 et note : le nom du courtier, le capital, le levier.
2. Dans MT5, ouvre la **Cotation** d'EURUSD et note le prix **Bid** et le prix
   **Ask**. Calcule la différence.
3. Dans TradingView, lance le **Replay** sur EURUSD 1h, il y a un mois, et fais
   avancer 20 bougies. Note ce que tu observes en une phrase.

## Corrigés

1. Pas de bonne réponse unique ; vérifie seulement que le compte est bien
   marqué **Démo** dans MT5.
2. La différence Ask − Bid, c'est le **spread** : le coût que tu paies à chaque
   trade. Sur EURUSD, il est souvent autour de 0,00010 à 0,00020 (1 à 2 pips).
   On le détaille au module 1.
3. L'idée est d'observer sans trader : le prix fait-il des vagues ? Monte-t-il
   ou descend-il globalement ? C'est la notion de **tendance**, vue au module 2.
