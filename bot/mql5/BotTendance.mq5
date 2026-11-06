//+------------------------------------------------------------------+
//| BotTendance.mq5                                                  |
//| Croisement de moyennes mobiles + stop ATR + risque fixe.         |
//| Meme logique que bot/python/strategie.py.                        |
//|                                                                  |
//| A UTILISER D'ABORD DANS LE TESTEUR DE STRATEGIE, PUIS EN DEMO.   |
//| Par defaut, le bot refuse de trader sur un compte reel.          |
//+------------------------------------------------------------------+
#property copyright "Projet d'apprentissage"
#property version   "1.00"

#include <Trade/Trade.mqh>

//--- Parametres modifiables dans la fenetre du bot
input group "Strategie"
input int             InpMaRapide      = 20;          // Moyenne mobile rapide
input int             InpMaLente       = 50;          // Moyenne mobile lente
input ENUM_MA_METHOD  InpMaMethode     = MODE_SMA;    // Type de moyenne
input int             InpAtrPeriode    = 14;          // Periode ATR
input double          InpStopAtr       = 1.5;         // Stop = X fois l'ATR
input double          InpRatioObjectif = 2.0;         // Objectif = X fois le stop

input group "Gestion du risque"
input double          InpRisquePct       = 1.0;       // % du capital risque par trade
input double          InpPerteMaxJourPct = 3.0;       // Arret pour la journee apres X % de perte
input int             InpSpreadMaxPoints = 30;        // Pas d'entree si le spread depasse (points)

input group "Securite"
input bool            InpAutoriserReel = false;       // Autoriser un compte REEL (deconseille)
input ulong           InpMagic         = 20261106;    // Numero d'identification du bot

//--- Variables internes
CTrade   trade;
int      hMaRapide = INVALID_HANDLE;
int      hMaLente  = INVALID_HANDLE;
int      hAtr      = INVALID_HANDLE;
datetime derniereBougie   = 0;
datetime jourCourant      = 0;
double   capitalDebutJour = 0.0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpMaRapide >= InpMaLente)
   {
      Print("Erreur : la moyenne rapide doit etre plus courte que la lente.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(InpRisquePct <= 0.0 || InpRisquePct > 5.0)
   {
      Print("Erreur : le risque par trade doit etre entre 0 et 5 %.");
      return INIT_PARAMETERS_INCORRECT;
   }

   bool estDemo = (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO);
   bool estTesteur = (bool)MQLInfoInteger(MQL_TESTER);
   if(!estDemo && !estTesteur && !InpAutoriserReel)
   {
      Alert("BotTendance : compte REEL detecte. Le bot s'arrete. ",
            "Teste-le d'abord en demo (voir cours/06-demo-vers-reel.md).");
      return INIT_FAILED;
   }

   hMaRapide = iMA(_Symbol, _Period, InpMaRapide, 0, InpMaMethode, PRICE_CLOSE);
   hMaLente  = iMA(_Symbol, _Period, InpMaLente,  0, InpMaMethode, PRICE_CLOSE);
   hAtr      = iATR(_Symbol, _Period, InpAtrPeriode);
   if(hMaRapide == INVALID_HANDLE || hMaLente == INVALID_HANDLE || hAtr == INVALID_HANDLE)
   {
      Print("Erreur : impossible de creer les indicateurs.");
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(10);
   Print("BotTendance demarre sur ", _Symbol, " ", EnumToString(_Period),
         estDemo ? " (compte demo)" : (estTesteur ? " (testeur)" : " (COMPTE REEL)"));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(hMaRapide != INVALID_HANDLE) IndicatorRelease(hMaRapide);
   if(hMaLente  != INVALID_HANDLE) IndicatorRelease(hMaLente);
   if(hAtr      != INVALID_HANDLE) IndicatorRelease(hAtr);
}

//+------------------------------------------------------------------+
//| Vrai une seule fois par nouvelle bougie                          |
//+------------------------------------------------------------------+
bool NouvelleBougie()
{
   datetime t = iTime(_Symbol, _Period, 0);
   if(t == 0 || t == derniereBougie)
      return false;
   derniereBougie = t;
   return true;
}

//+------------------------------------------------------------------+
//| Position ouverte par CE bot sur CE symbole ?                     |
//+------------------------------------------------------------------+
bool PositionOuverte()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Limite de perte du jour (sur l'equity, positions comprises)      |
//+------------------------------------------------------------------+
bool PerteDuJourDepassee()
{
   MqlDateTime d;
   TimeToStruct(TimeCurrent(), d);
   d.hour = 0; d.min = 0; d.sec = 0;
   datetime aujourdhui = StructToTime(d);
   if(aujourdhui != jourCourant)
   {
      jourCourant = aujourdhui;
      capitalDebutJour = AccountInfoDouble(ACCOUNT_BALANCE);
   }
   if(capitalDebutJour <= 0.0) return true;
   double perte = (capitalDebutJour - AccountInfoDouble(ACCOUNT_EQUITY)) / capitalDebutJour * 100.0;
   return perte >= InpPerteMaxJourPct;
}

//+------------------------------------------------------------------+
//| Taille de position pour risquer InpRisquePct % sur ce stop       |
//+------------------------------------------------------------------+
double CalculerLots(double distanceStop)
{
   double tickValeur = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickValeur <= 0.0) tickValeur = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickTaille = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double pas        = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double lotMin     = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double lotMax     = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(tickValeur <= 0.0 || tickTaille <= 0.0 || pas <= 0.0 || distanceStop <= 0.0)
      return 0.0;

   double argentRisque  = AccountInfoDouble(ACCOUNT_BALANCE) * InpRisquePct / 100.0;
   double perteParLot   = distanceStop / tickTaille * tickValeur;
   double lots          = MathFloor(argentRisque / perteParLot / pas) * pas;

   // Si meme le lot minimum risque plus que prevu, on ne trade pas.
   if(lots < lotMin)
   {
      PrintFormat("Trade ignore : le lot minimum (%.2f) risquerait plus de %.1f %%.", lotMin, InpRisquePct);
      return 0.0;
   }
   return MathMin(lots, lotMax);
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(!NouvelleBougie())   return;   // on ne decide qu'a la cloture d'une bougie
   if(PositionOuverte())   return;   // une seule position a la fois
   if(PerteDuJourDepassee())
   {
      Print("Limite de perte du jour atteinte : pas de nouveau trade aujourd'hui.");
      return;
   }

   // Valeurs des bougies 1 (derniere cloturee) et 2 (celle d'avant)
   double rapide[], lente[], atr[];
   ArraySetAsSeries(rapide, true);
   ArraySetAsSeries(lente, true);
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(hMaRapide, 0, 1, 2, rapide) != 2) return;
   if(CopyBuffer(hMaLente,  0, 1, 2, lente)  != 2) return;
   if(CopyBuffer(hAtr,      0, 1, 1, atr)    != 1) return;

   int sens = 0;
   if(rapide[1] <= lente[1] && rapide[0] > lente[0]) sens = 1;    // croisement haussier
   if(rapide[1] >= lente[1] && rapide[0] < lente[0]) sens = -1;   // croisement baissier
   if(sens == 0) return;

   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > InpSpreadMaxPoints)
   {
      PrintFormat("Signal ignore : spread trop large (%d points).", (int)spread);
      return;
   }

   double distance = InpStopAtr * atr[0];
   double lots = CalculerLots(distance);
   if(lots <= 0.0) return;

   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   bool   ok;
   if(sens == 1)
   {
      double prix = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double sl   = NormalizeDouble(prix - distance, digits);
      double tp   = NormalizeDouble(prix + distance * InpRatioObjectif, digits);
      ok = trade.Buy(lots, _Symbol, prix, sl, tp, "BotTendance achat");
   }
   else
   {
      double prix = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double sl   = NormalizeDouble(prix + distance, digits);
      double tp   = NormalizeDouble(prix - distance * InpRatioObjectif, digits);
      ok = trade.Sell(lots, _Symbol, prix, sl, tp, "BotTendance vente");
   }

   if(!ok)
      PrintFormat("Ordre refuse : %d - %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
   else
      PrintFormat("%s %.2f lots, stop a %.1f x ATR", sens == 1 ? "ACHAT" : "VENTE", lots, InpStopAtr);
}
//+------------------------------------------------------------------+
