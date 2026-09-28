/**
 * Traduction des libelles renvoyes en anglais par le fournisseur.
 * Les pays absents de la table sont affiches tels quels : mieux vaut
 * un nom anglais qu'une competition sans origine.
 */

const COUNTRIES = {
  World: 'International',
  England: 'Angleterre',
  Spain: 'Espagne',
  Italy: 'Italie',
  Germany: 'Allemagne',
  France: 'France',
  Portugal: 'Portugal',
  Netherlands: 'Pays-Bas',
  Belgium: 'Belgique',
  Scotland: 'Ecosse',
  Wales: 'Pays de Galles',
  Ireland: 'Irlande',
  'Northern-Ireland': 'Irlande du Nord',
  Switzerland: 'Suisse',
  Austria: 'Autriche',
  Turkey: 'Turquie',
  Greece: 'Grece',
  Russia: 'Russie',
  Ukraine: 'Ukraine',
  Poland: 'Pologne',
  Czech: 'Tchequie',
  'Czech-Republic': 'Tchequie',
  Croatia: 'Croatie',
  Serbia: 'Serbie',
  Romania: 'Roumanie',
  Bulgaria: 'Bulgarie',
  Hungary: 'Hongrie',
  Denmark: 'Danemark',
  Sweden: 'Suede',
  Norway: 'Norvege',
  Finland: 'Finlande',
  Iceland: 'Islande',
  Brazil: 'Bresil',
  Argentina: 'Argentine',
  Uruguay: 'Uruguay',
  Chile: 'Chili',
  Colombia: 'Colombie',
  Peru: 'Perou',
  Ecuador: 'Equateur',
  Mexico: 'Mexique',
  USA: 'Etats-Unis',
  Canada: 'Canada',
  Japan: 'Japon',
  'South-Korea': 'Coree du Sud',
  China: 'Chine',
  Australia: 'Australie',
  'Saudi-Arabia': 'Arabie saoudite',
  Qatar: 'Qatar',
  'United-Arab-Emirates': 'Emirats arabes unis',
  Egypt: 'Egypte',
  Morocco: 'Maroc',
  Algeria: 'Algerie',
  Tunisia: 'Tunisie',
  Senegal: 'Senegal',
  'Ivory-Coast': "Cote d'Ivoire",
  Nigeria: 'Nigeria',
  Ghana: 'Ghana',
  Cameroon: 'Cameroun',
  'South-Africa': 'Afrique du Sud',
  India: 'Inde',
  Israel: 'Israel',
  Cyprus: 'Chypre',
  Slovakia: 'Slovaquie',
  Slovenia: 'Slovenie',
};

export const countryName = (name) => COUNTRIES[name] || name || '';

/** Lettres de forme : le fournisseur renvoie W/D/L, on affiche V/N/D. */
const FORM_LETTERS = { W: 'V', D: 'N', L: 'D' };

export const formLetter = (letter) => FORM_LETTERS[letter] || letter;
