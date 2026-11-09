# Plan d'attaque

## L'objectif final

> **Avoir un bot de trading en Python qui tourne seul (dans Termux, puis sur un
> petit serveur), testé sur au moins 2 ans de données réelles, puis validé par 3 mois en compte démo avec
> des résultats proches du test. Ensuite seulement, décider (ou non) de passer
> en réel avec une petite somme.**

Durée réaliste : **environ 6 mois**. On ne saute pas d'étape : chaque phase a
un **critère de passage**. Tant qu'il n'est pas rempli, on reste sur la phase.

Personne ne peut garantir qu'un bot sera rentable. Le but du plan est de le
savoir **avant** de risquer de l'argent, pas après.

---

## Vue d'ensemble

| Phase | Quoi | Durée | Critère pour passer à la suite |
|---|---|---|---|
| 0 | Préparer les outils | Semaine 1 | Compte démo MT5 ouvert, les tests passent dans Termux |
| 1 | Apprendre les bases | Semaines 1 à 3 | Exercices des modules 1 à 3 faits, 20 trades manuels notés |
| 2 | Récupérer les données et faire le premier test | Semaines 3 à 5 | Résultats de référence sur 3 marchés |
| 3 | Lancer le bot : papier, puis démo OANDA | Semaines 5 à 7 | 1 semaine de papier sans incident, bot connecté au compte démo |
| 4 | Améliorer la stratégie | Semaines 7 à 10 | Une version validée sur des données jamais utilisées |
| 5 | Démo en continu | Mois 3 à 6 | 3 mois de démo proches du test, règles respectées |
| 6 | Décision : réel ou pas | Mois 6 et après | Checklist du module 6 entièrement cochée |

**Qui fait quoi :** toi, tu fais les manipulations sur tes applis et les
exercices. Moi, j'écris et je corrige le code, j'analyse tes résultats et je
réponds à tes questions. Tu m'envoies tes captures, tes fichiers et tes
chiffres à chaque étape.

---

## Phase 0 : préparer les outils (semaine 1)

- [ ] Ouvrir un compte **démo** MT5 sur le téléphone (10 000, levier 1:30
      maximum), pour t'entraîner à la main — module 0
- [ ] Dans Termux : installer Python et git, récupérer le dépôt, lancer les
      tests (`python -m unittest discover tests` doit finir par `OK`)
- [ ] Sur TradingView : graphique EURUSD en H1, trouver le bouton **Replay**
- [ ] Recopier les 5 règles de sécurité du module 0

**Livrable :** ce qu'affichent les tests dans Termux.

## Phase 1 : apprendre les bases (semaines 1 à 3)

- [ ] Module 1 et ses exercices (bougies, spread, pips, lots)
- [ ] Module 2 et ses exercices (tendance, moyennes mobiles, ATR)
- [ ] Module 3 et ses exercices (risque de 1 %, taille de position)
- [ ] **20 trades à la main** en mode Replay de TradingView, avec les règles
      du bot, notés dans le journal (module 4)

**Livrable :** tes réponses aux exercices et ton journal de 20 trades. Je
corrige et je te dis ce qu'il faut revoir.

## Phase 2 : données et premier test (semaines 3 à 5)

- [ ] Télécharger **2 ans au minimum** de bougies H1 avec `telecharger.py` :
      BTCUSDT et ETHUSDT tout de suite, puis EUR_USD et XAU_USD (l'or) une
      fois le compte OANDA ouvert — module 4
- [ ] Lancer le test Python sur chaque fichier, avec un spread réaliste
- [ ] Couper chaque fichier : les **2 premiers tiers** pour chercher, le
      **dernier tiers** mis de côté pour la vérification finale (on n'y
      touche pas avant la phase 4)
- [ ] Noter les résultats de référence : nombre de trades, taux de réussite,
      R moyen, drawdown max

**Livrable :** le tableau des résultats. Je vérifie qu'il n'y a pas
d'erreur de données.

## Phase 3 : lancer le bot (semaines 5 à 7) — module 5

- [ ] Lancer le bot en **mode papier** sur BTCUSDT H1 (prix réels, argent
      fictif, aucun compte)
- [ ] Régler Android pour que Termux ne soit pas endormi, et vérifier qu'il
      tourne **une semaine** sans trou dans le fichier `.log`
- [ ] Vérifier que ses trades ressemblent à ceux du backtest sur la même
      période
- [ ] Ouvrir un compte **démo OANDA**, créer le jeton, lancer le bot sur
      EUR_USD et vérifier que l'ordre apparaît chez OANDA

**Livrable :** le `.log` et le journal `.csv` de la semaine. Si quelque chose
ne marche pas, j'en corrige le code.

## Phase 4 : améliorer la stratégie (semaines 7 à 10)

Règle d'or : **une seule modification à la fois**, testée sur les 2 premiers
tiers. On ne la garde que si elle améliore le R moyen **et** ne fait pas
exploser le drawdown.

Pistes, dans l'ordre :
- [ ] Filtre de tendance longue : MM 200 (exercice 4 du module 5)
- [ ] Ne trader qu'aux heures actives (sessions de Londres et New York)
- [ ] Tester d'autres réglages de stop et d'objectif (stop 2 × ATR, ratio 1:1,5 ou 1:3)
- [ ] Choisir les marchés où la stratégie tient le mieux
- [ ] **Vérification finale** sur le dernier tiers mis de côté, une seule fois

**Livrable :** un tableau « modification → résultat ». La version gagnante
est dans `strategie.py`, donc le bot et le backtest l'utilisent tous les deux.

## Phase 5 : démo en continu (mois 3 à 6)

- [ ] Faire tourner le bot 24 h/24 sur un **petit serveur Linux** (VPS,
      environ 4 à 5 € par mois) : je t'aide à l'installer depuis ton téléphone
- [ ] **Ne pas toucher** au bot pendant la période, sauf bug
- [ ] Faire un **bilan chaque mois** : résultats démo comparés au test, et journal
- [ ] Règle d'arrêt : drawdown supérieur à 1,5 fois celui du test → on arrête
      et on analyse

**Livrable :** 3 bilans mensuels. On les analyse ensemble.

## Phase 6 : décision (mois 6 et après)

- [ ] Passer la checklist du module 6, case par case
- [ ] Si elle est entièrement cochée : réel avec une **petite somme** que tu
      peux perdre en entier, et **0,5 %** de risque par trade
- [ ] Sinon : on retourne à la phase 4 ou 5, sans honte, c'est le plan qui
      fonctionne

---

## Le rythme

- **Chaque semaine :** tu me donnes où tu en es (cases cochées, blocages,
  questions).
- **À chaque fin de phase :** on vérifie le critère de passage ensemble avant
  d'avancer.
- **Ce plan est vivant :** on coche les cases dans ce fichier au fur et à
  mesure.
