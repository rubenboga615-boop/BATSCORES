#!/usr/bin/env node
/**
 * Genere une paire de cles VAPID et affiche les lignes a coller dans .env.
 *
 * A executer une seule fois. Changer de cles invalide tous les abonnements
 * existants : les appareils deja abonnes cessent de recevoir quoi que ce soit
 * et doivent se reabonner.
 */
import { generateVapidKeys } from '../server/webpush.js';

const { publicKey, privateKey } = generateVapidKeys();

console.log(`
Cles VAPID generees. Ajoutez ces trois lignes a votre fichier .env :

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:votre-adresse@exemple.fr

Remplacez l'adresse par la votre : les services de push l'utilisent pour vous
joindre en cas de probleme.

La cle privee ne doit jamais quitter le serveur ni entrer dans git.
Ne regenerez pas ces cles sans raison : tous les appareils deja abonnes
devraient se reabonner.
`);
