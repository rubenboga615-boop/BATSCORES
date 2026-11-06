# Module 2 : tendance, supports/résistances, moyennes mobiles

## La tendance

- **Haussière** : des sommets de plus en plus hauts et des creux de plus en
  plus hauts.
- **Baissière** : des sommets et des creux de plus en plus bas.
- **Range** (sans tendance) : le prix oscille entre deux niveaux.

Idée de base de notre bot : **suivre la tendance**, c'est-à-dire acheter
quand elle est haussière et vendre quand elle est baissière, plutôt que
d'essayer de deviner les retournements.

## Supports et résistances

- **Support** : une zone où le prix a rebondi plusieurs fois vers le haut
  (les acheteurs y reviennent).
- **Résistance** : une zone où le prix a été repoussé vers le bas.
- Une résistance cassée devient souvent un support, et inversement.

Dans TradingView, trace-les avec l'outil **ligne horizontale** sur le
graphique journalier (D1), puis redescends en H1.

## Les moyennes mobiles (MM)

La moyenne mobile 20 est la moyenne des 20 dernières clôtures, recalculée à
chaque bougie. Elle lisse le prix.

- Prix **au-dessus** d'une MM qui monte : contexte haussier.
- **Croisement** : quand la MM rapide (20) passe au-dessus de la MM lente
  (50), la tendance courte devient plus forte que la longue → signal d'achat.
  L'inverse donne un signal de vente. **C'est le signal d'entrée de notre bot.**
- Défaut : les MM sont **en retard**. En range, elles se croisent sans arrêt
  et donnent de faux signaux.

Dans TradingView : **Indicateurs > Moving Average**, ajoute-la deux fois
(longueurs 20 et 50).

## L'ATR (Average True Range)

L'ATR mesure **de combien le prix bouge en moyenne par bougie**. Il ne dit
pas la direction, seulement l'agitation du marché.

Usage dans le bot : placer le stop à `1,5 × ATR`. Quand le marché est calme,
le stop est serré ; quand il est agité, le stop s'éloigne pour ne pas être
touché par un simple mouvement normal.

## Exercices

1. Sur EURUSD D1, trace 2 supports et 2 résistances sur les 6 derniers mois.
2. Ajoute les MM 20 et 50 en H1. En Replay sur 3 mois, compte les
   croisements. Pour chacun, note si le prix a ensuite avancé d'au moins
   « 2 ATR » dans le sens du croisement.
3. Ajoute l'indicateur ATR (14). Quelle est sa valeur aujourd'hui sur
   EURUSD H1 ? À combien de pips serait un stop à 1,5 ATR ?
4. Question : pourquoi les croisements de MM marchent-ils mal en range ?

## Corrigés

1. Vérifie que tes lignes touchent au moins 2 ou 3 rebonds chacune. Ce sont
   des **zones**, pas des prix exacts.
2. Tu devrais trouver environ un tiers à la moitié de croisements gagnants.
   C'est normal : la stratégie gagne avec des gains (2 R) plus gros que les
   pertes (1 R), pas en ayant raison souvent (module 3).
3. Par exemple, ATR = 0,0012 (12 pips) → stop à 18 pips. Ta valeur dépend du
   jour.
4. En range, le prix va et vient autour des MM, qui se croisent à chaque
   aller-retour : on entre tard, juste avant que le prix reparte en sens
   inverse. C'est la principale faiblesse de la stratégie ; tu essaieras de
   l'améliorer au module 5.
