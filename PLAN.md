# Plan d'attaque

## L'objectif final

> **Avoir un bot de trading qui tourne seul sur MetaTrader 5, testé sur au
> moins 2 ans de données réelles, puis validé par 3 mois en compte démo avec
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
| 0 | Préparer les outils | Semaine 1 | Compte démo ouvert, MT5 installé sur ordinateur |
| 1 | Apprendre les bases | Semaines 1 à 3 | Exercices des modules 1 à 3 faits, 20 trades manuels notés |
| 2 | Récupérer les données et faire le premier test | Semaines 3 à 5 | Résultats de référence sur 3 marchés |
| 3 | Mettre le bot dans MT5 | Semaines 5 à 7 | Bot compilé, résultats MT5 cohérents avec le test Python |
| 4 | Améliorer la stratégie | Semaines 7 à 10 | Une version validée sur des données jamais utilisées |
| 5 | Démo en continu | Mois 3 à 6 | 3 mois de démo proches du test, règles respectées |
| 6 | Décision : réel ou pas | Mois 6 et après | Checklist du module 6 entièrement cochée |

**Qui fait quoi :** toi, tu fais les manipulations sur tes applis et les
exercices. Moi, j'écris et je corrige le code, j'analyse tes résultats et je
réponds à tes questions. Tu m'envoies tes captures, tes fichiers et tes
chiffres à chaque étape.

---

## Phase 0 : préparer les outils (semaine 1)

- [ ] Ouvrir un compte **démo** MT5 (10 000, levier 1:30 maximum) — module 0
- [ ] Installer **MT5 sur ordinateur** (le bot ne tourne pas sur téléphone)
- [ ] Se connecter au même compte démo sur le téléphone, pour suivre
- [ ] Sur TradingView : graphique EURUSD en H1, trouver le bouton **Replay**
- [ ] Recopier les 5 règles de sécurité du module 0

**Livrable :** une capture du compte démo dans MT5 sur ordinateur.

## Phase 1 : apprendre les bases (semaines 1 à 3)

- [ ] Module 1 et ses exercices (bougies, spread, pips, lots)
- [ ] Module 2 et ses exercices (tendance, moyennes mobiles, ATR)
- [ ] Module 3 et ses exercices (risque de 1 %, taille de position)
- [ ] **20 trades à la main** en mode Replay de TradingView, avec les règles
      du bot, notés dans le journal (module 4)

**Livrable :** tes réponses aux exercices et ton journal de 20 trades. Je
corrige et je te dis ce qu'il faut revoir.

## Phase 2 : données et premier test (semaines 3 à 5)

- [ ] Exporter **2 ans au minimum** de bougies H1 depuis MT5 pour EURUSD,
      GBPUSD et l'or (XAUUSD) — module 4
- [ ] Lancer le test Python sur chaque fichier, avec un spread réaliste
- [ ] Couper chaque fichier : les **2 premiers tiers** pour chercher, le
      **dernier tiers** mis de côté pour la vérification finale (on n'y
      touche pas avant la phase 4)
- [ ] Noter les résultats de référence : nombre de trades, taux de réussite,
      R moyen, drawdown max

**Livrable :** les 3 fichiers CSV et le tableau des résultats. Je vérifie
qu'il n'y a pas d'erreur de données.

## Phase 3 : le bot dans MT5 (semaines 5 à 7)

- [ ] Installer et compiler `BotTendance.mq5` dans MetaEditor — module 5
- [ ] Faire le test dans le **testeur de stratégie** sur les mêmes 2 ans
- [ ] Comparer avec le test Python : les résultats doivent aller dans le même
      sens (écart de 10 à 30 % acceptable)
- [ ] Le lancer sur le compte démo quelques jours pour vérifier qu'il passe
      bien ses ordres (onglet *Experts*)

**Livrable :** le rapport du testeur MT5 (capture ou export). Si la
compilation échoue ou si les chiffres divergent trop, je corrige le code.

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
est intégrée au bot MT5 **et** au test Python.

## Phase 5 : démo en continu (mois 3 à 6)

- [ ] Faire tourner le bot 24 h/24 : ordinateur allumé ou **VPS** (serveur loué)
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
