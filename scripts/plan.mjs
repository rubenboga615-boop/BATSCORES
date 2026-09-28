#!/usr/bin/env node
/**
 * Dit quel abonnement API-Football repond a votre cle.
 *
 * Pourquoi cette commande existe : quand le fournisseur refuse une saison, il
 * repond « Free plans do not have access to this season ». Le message arrive
 * jusqu'a l'ecran tel quel, et on croit alors que l'application bride quelque
 * chose. Elle ne bride rien : c'est la cle qui est vue comme gratuite.
 *
 * Deux causes possibles, que cette commande separe :
 *   - la cle du .env n'est pas celle du compte abonne ;
 *   - l'abonnement a ete pris sur RapidAPI, mais le .env pointe sur
 *     api-football.com (ou l'inverse) : ce sont deux comptes distincts, avec
 *     deux cles distinctes.
 *
 * L'endpoint /status ne coute rien au quota et ne renvoie aucune donnee de
 * match. Rien d'identifiant n'est affiche ici : ni la cle, ni le nom, ni
 * l'adresse du compte.
 */
import { config, hasApiKey, isPlaceholderKey } from '../server/config.js';

const PROVIDER_LABELS = {
  apisports: 'api-football.com (tableau de bord direct)',
  rapidapi: 'RapidAPI',
};

function bail(message, hint) {
  console.error(`\n  ${message}\n`);
  if (hint) console.error(`  ${hint}\n`);
  process.exit(1);
}

if (!config.apiKey) {
  bail(
    'Aucune cle dans le fichier .env.',
    'Copiez .env.example vers .env et renseignez API_FOOTBALL_KEY.',
  );
}

if (isPlaceholderKey()) {
  bail(
    "Le fichier .env contient encore la valeur d'exemple.",
    'Remplacez « votre_cle_api_ici » par votre vraie cle.',
  );
}

if (!hasApiKey()) bail('Cle inutilisable.');

const url = `${config.baseUrl}/status`;
let payload;
try {
  const response = await fetch(url, { headers: config.authHeaders });
  payload = await response.json();
  if (!response.ok) {
    bail(
      `Le fournisseur a repondu ${response.status}.`,
      'Une cle refusee (401 ou 403) vient presque toujours du mauvais fournisseur : '
      + "verifiez API_FOOTBALL_PROVIDER dans .env.",
    );
  }
} catch (err) {
  bail(`Impossible de joindre ${url} : ${err.message}`, 'Verifiez la connexion du serveur.');
}

// Le fournisseur signale ses refus dans le corps, pas par le code HTTP.
const errors = payload.errors;
const errorList = Array.isArray(errors) ? errors : Object.values(errors || {});
if (errorList.length) {
  bail(
    `Le fournisseur refuse la cle : ${errorList.join(' · ')}`,
    'Si votre abonnement est sur RapidAPI, mettez API_FOOTBALL_PROVIDER=rapidapi dans .env.',
  );
}

const data = payload.response || {};
const plan = data.subscription?.plan || 'inconnu';
const active = data.subscription?.active;
const end = data.subscription?.end || null;
const used = data.requests?.current ?? null;
const limit = data.requests?.limit_day ?? null;

console.log(`
  Fournisseur interroge : ${PROVIDER_LABELS[config.provider] || config.provider}
  Abonnement            : ${plan}${active === false ? ' (INACTIF)' : ''}${end ? ` · jusqu'au ${end}` : ''}
  Appels aujourd'hui    : ${used ?? '?'} / ${limit ?? '?'}`);

/**
 * Le verdict, en clair. Le plan gratuit plafonne a 100 appels par jour et ne
 * donne acces qu'a trois saisons : c'est ce plafond qui trahit un compte
 * gratuit, meme quand on croit avoir souscrit.
 */
const looksFree = /free/i.test(plan) || (limit !== null && limit <= 100);

if (looksFree) {
  console.log(`
  ⚠  Cette cle est vue comme GRATUITE par le fournisseur.

     C'est ce qui produit le message « Free plans do not have access to this
     season » et laisse des pages vides. L'application n'y est pour rien.

     Deux verifications, dans cet ordre :

     1. La cle du .env est-elle bien celle du compte qui porte l'abonnement ?
        Sur api-football.com, la cle est dans le tableau de bord du compte.

     2. Ou avez-vous souscrit ?
        - sur api-football.com   -> API_FOOTBALL_PROVIDER=apisports
        - sur RapidAPI           -> API_FOOTBALL_PROVIDER=rapidapi
        Les deux comptes sont separes : un abonnement pris sur RapidAPI ne
        rend pas payante la cle du tableau de bord, et inversement.

     Actuellement le .env demande : ${config.provider}
`);
} else if (active === false) {
  console.log(`
  ⚠  L'abonnement « ${plan} » est signale INACTIF (paiement en attente ou expire).
`);
} else {
  console.log(`
  ✓  Abonnement payant actif. Toutes les saisons couvertes par ce plan sont
     accessibles ; une page vide vient alors d'autre chose, pas du plan.
`);
}
