# Module 5 : le bot dans MetaTrader 5

Le bot est le fichier [`bot/mql5/BotTendance.mq5`](../bot/mql5/BotTendance.mq5).
Dans MT5, un bot s'appelle un **Expert Advisor (EA)**. Il est écrit en
**MQL5**, un langage proche du C++.

> Il faut **MT5 sur ordinateur** (Windows, ou Mac avec la version officielle).

## 1. Installer le bot

1. Dans MT5 : **Fichier > Ouvrir le dossier des données**.
2. Va dans `MQL5/Experts/` et copie-y `BotTendance.mq5`.
3. Ouvre **MetaEditor** (touche F4), ouvre le fichier, puis **Compiler** (F7).
   Il doit afficher `0 errors`. Un fichier `BotTendance.ex5` est créé.
4. Dans MT5, le bot apparaît dans le **Navigateur**, rubrique *Experts
   Consultants* (clic droit > Actualiser si besoin).

## 2. Le tester dans le testeur de stratégie (obligatoire)

1. **Affichage > Testeur de stratégie** (Ctrl+R).
2. Expert : `BotTendance`, symbole `EURUSD`, période `H1`, dates : les 2
   dernières années.
3. Modélisation : **Every tick based on real ticks** (le plus réaliste).
4. Dépôt : 10 000, levier 1:30.
5. **Démarrer**, puis regarde les onglets **Backtest** (statistiques) et
   **Graphique** (courbe du capital).

Compare avec le backtester Python sur les mêmes dates : les chiffres ne seront
pas identiques (MT5 utilise les vrais ticks et le vrai spread), mais ils
doivent aller dans le même sens.

## 3. Comprendre le code

| Partie du code | Rôle |
|---|---|
| `input ...` | Les paramètres que tu règles dans MT5 sans toucher au code |
| `OnInit()` | Démarrage : vérifie les paramètres, **refuse un compte réel**, crée les indicateurs |
| `OnTick()` | Appelée à chaque variation de prix ; le bot n'agit qu'**une fois par nouvelle bougie** |
| `NouvelleBougie()` | Détecte l'ouverture d'une nouvelle bougie |
| `PositionOuverte()` | Une seule position à la fois (repérée par le numéro `InpMagic`) |
| `PerteDuJourDepassee()` | Stoppe les entrées après −3 % dans la journée |
| `CalculerLots()` | La formule du module 3 : lots = argent risqué / perte par lot |
| `CopyBuffer(...)` | Lit les valeurs des MM et de l'ATR sur les bougies clôturées |

Le stop et l'objectif sont envoyés **avec l'ordre** : même si ton ordinateur
s'éteint, ils sont chez le courtier.

## 4. Le lancer sur le compte démo

1. Ouvre un graphique EURUSD H1.
2. Glisse `BotTendance` du Navigateur sur le graphique.
3. Onglet *Commun* : coche **Autoriser le trading algorithmique**.
4. Active le bouton **Trading algo** dans la barre d'outils (il devient vert).
5. Les messages du bot apparaissent dans l'onglet **Experts** de la boîte à
   outils (Ctrl+T).

Laisse-le tourner plusieurs semaines. Suis les trades depuis l'appli MT5 de
ton téléphone (même compte démo).

## Exercices

1. Installe et compile le bot. Corrige toute erreur éventuelle (copie le
   message si tu bloques).
2. Fais le backtest dans MT5 sur 2 ans. Note les statistiques et compare-les
   au backtester Python.
3. Optimisation encadrée : dans le testeur, onglet *Paramètres*, coche
   l'optimisation de `InpMaRapide` (de 10 à 30 par pas de 5) et `InpMaLente`
   (de 40 à 100 par pas de 20). Les meilleurs résultats sont-ils entourés de
   bons résultats, ou isolés ?
4. **Amélioration à coder** : ajoute un filtre qui n'autorise les achats que
   si le prix est au-dessus d'une MM 200 (et les ventes seulement en
   dessous). Indice : crée un troisième `iMA` dans `OnInit`, lis-le avec
   `CopyBuffer` et compare-le à `iClose(_Symbol, _Period, 1)`. Fais la même
   modification dans `strategie.py`, puis compare avant et après.
5. Lance le bot en démo et tiens ton journal pendant 1 mois.

## Corrigés

1. Erreur fréquente : le fichier est dans le mauvais dossier
   (`MQL5/Experts/`, pas `MQL5/Scripts/`).
2. Des écarts de 10 à 30 % entre les deux outils sont normaux (spread
   variable, ticks réels, heures de clôture).
3. Si le meilleur réglage est isolé (ses voisins perdent), c'est du hasard :
   garde un réglage au milieu d'une zone stable.
4. Pistes pour le code MQL5 :
   ```mql5
   // dans les variables globales
   int hMaFiltre = INVALID_HANDLE;
   // dans OnInit()
   hMaFiltre = iMA(_Symbol, _Period, 200, 0, MODE_SMA, PRICE_CLOSE);
   // dans OnTick(), après le calcul de "sens"
   double filtre[];
   if(CopyBuffer(hMaFiltre, 0, 1, 1, filtre) != 1) return;
   double cloture = iClose(_Symbol, _Period, 1);
   if(sens == 1  && cloture < filtre[0]) return;
   if(sens == -1 && cloture > filtre[0]) return;
   ```
   N'oublie pas `IndicatorRelease(hMaFiltre)` dans `OnDeinit`. Le filtre
   réduit le nombre de trades et élimine surtout des trades à contre-tendance ;
   vérifie avec le backtest s'il améliore vraiment le R moyen.
5. Compare les résultats en démo avec le backtest : s'ils sont très
   inférieurs, cherche pourquoi (spread, glissement, heures d'activité) avant
   d'aller plus loin.
