/**
 * Web Push, ecrit directement sur node:crypto.
 *
 * La bibliotheque habituelle apporte quatorze paquets transitifs a un projet
 * qui en compte trois. Le protocole, lui, tient en deux specifications :
 * RFC 8291 pour le chiffrement du message et RFC 8292 pour l'authentification
 * du serveur (VAPID). Les ecrire ici evite d'imposer une chaine de
 * dependances a mettre a jour sur le serveur de l'utilisateur.
 *
 * Rien n'est invente : chaque etape ci-dessous cite la section correspondante.
 */
import crypto from 'node:crypto';

const CURVE = 'prime256v1';

/* ------------------------------ Encodages --------------------------------- */

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (str) => Buffer.from(String(str), 'base64url');

/** Point P-256 non compresse (65 octets) -> cle publique utilisable. */
function publicKeyFromRaw(raw) {
  const point = Buffer.from(raw);
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error('Cle publique P-256 invalide (65 octets non compresses attendus).');
  }
  return crypto.createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(point.subarray(1, 33)),
      y: b64url(point.subarray(33, 65)),
    },
    format: 'jwk',
  });
}

/** Scalaire prive (32 octets) + point public -> cle privee utilisable. */
function privateKeyFromRaw(rawPrivate, rawPublic) {
  const point = Buffer.from(rawPublic);
  return crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(point.subarray(1, 33)),
      y: b64url(point.subarray(33, 65)),
      d: b64url(rawPrivate),
    },
    format: 'jwk',
  });
}

/** Paire de cles VAPID, au format que le navigateur attend (base64url). */
export function generateVapidKeys() {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(ecdh.getPrivateKey()),
  };
}

/* --------------------------- Chiffrement (RFC 8291) ------------------------ */

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** HKDF tel qu'utilise par la specification : extraction puis expansion courte. */
function hkdf(salt, ikm, info, length) {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, length);
}

/** Taille de record annoncee dans l'en-tete. 4096 est la valeur usuelle. */
const RECORD_SIZE = 4096;

/**
 * Chiffre une charge utile pour un abonnement donne (content-encoding aes128gcm).
 *
 * @param {{p256dh: string, auth: string}} keys cles publiees par le navigateur
 * @param {Buffer|string} payload
 * @returns {Buffer} corps de la requete POST
 */
export function encryptPayload(keys, payload) {
  const uaPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  if (uaPublic.length !== 65) throw new Error('Cle p256dh invalide.');
  if (authSecret.length < 16) throw new Error('Secret auth invalide.');

  // Paire ephemere du serveur : une par message, jamais reutilisee.
  const server = crypto.createECDH(CURVE);
  server.generateKeys();
  const serverPublic = server.getPublicKey();
  const sharedSecret = server.computeSecret(uaPublic);

  // RFC 8291 section 3.3 : le contexte lie la cle derivee aux deux parties,
  // ce qui empeche de rejouer un message chiffre vers un autre abonnement.
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    uaPublic,
    serverPublic,
  ]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12);

  // Un seul record : l'octet 0x02 marque la fin des donnees (RFC 8188).
  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(5);
  header.writeUInt32BE(RECORD_SIZE, 0);
  header.writeUInt8(serverPublic.length, 4);

  return Buffer.concat([salt, header, serverPublic, ciphertext]);
}

/**
 * Dechiffre un corps aes128gcm avec la cle privee de l'abonnement.
 *
 * Cette fonction n'a pas d'usage en production — c'est le navigateur qui
 * dechiffre. Elle existe pour que les tests verifient le chiffrement par
 * aller-retour plutot que de comparer des octets a une valeur figee.
 */
export function decryptPayload(body, { privateKey, publicKey, auth }) {
  const buffer = Buffer.from(body);
  const salt = buffer.subarray(0, 16);
  const idlen = buffer.readUInt8(20);
  const serverPublic = buffer.subarray(21, 21 + idlen);
  const ciphertext = buffer.subarray(21 + idlen);

  const ua = crypto.createECDH(CURVE);
  ua.setPrivateKey(fromB64url(privateKey));
  const sharedSecret = ua.computeSecret(serverPublic);

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    fromB64url(publicKey),
    serverPublic,
  ]);
  const ikm = hkdf(fromB64url(auth), sharedSecret, keyInfo, 32);
  const cek = hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // On retire l'octet de fin de record.
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

/* ---------------------------- VAPID (RFC 8292) ----------------------------- */

/**
 * Jeton prouvant au service de push que le message vient bien de ce serveur.
 * Duree volontairement courte : un jeton intercepte ne sert pas longtemps.
 */
export function vapidHeader(endpoint, { publicKey, privateKey, subject }) {
  const audience = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 11 * 3600,
    sub: subject,
  }));
  const signingInput = `${header}.${claims}`;

  const key = privateKeyFromRaw(fromB64url(privateKey), fromB64url(publicKey));
  // Les JWT ES256 attendent la signature brute r||s, pas l'encodage DER que
  // Node produit par defaut. L'oubli donne un jeton refuse sans explication.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  });

  return {
    Authorization: `vapid t=${signingInput}.${b64url(signature)}, k=${publicKey}`,
  };
}

/** Verifie un en-tete VAPID. Utilise par les tests, et par personne d'autre. */
export function verifyVapid(authorization, publicKey) {
  const token = /t=([^,\s]+)/.exec(authorization)?.[1];
  if (!token) return null;
  const [header, claims, signature] = token.split('.');
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    { key: publicKeyFromRaw(fromB64url(publicKey)), dsaEncoding: 'ieee-p1363' },
    fromB64url(signature),
  );
  return ok ? JSON.parse(fromB64url(claims).toString('utf8')) : null;
}

/* ------------------------------- Envoi ------------------------------------- */

export class PushError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'PushError';
    this.status = status;
    // 404 et 410 signifient que l'abonnement n'existe plus cote navigateur :
    // il faut l'oublier, sinon on reessaie indefiniment.
    this.gone = status === 404 || status === 410;
  }
}

/**
 * Envoie une notification a un abonnement.
 * @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscription
 */
export async function sendNotification(subscription, payload, vapid, { ttl = 3600 } = {}) {
  const body = encryptPayload(subscription.keys, JSON.stringify(payload));
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      ...vapidHeader(subscription.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'normal',
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().then((t) => t.slice(0, 200), () => '');
    throw new PushError(`Le service de push a refuse l'envoi (HTTP ${response.status}). ${detail}`, response.status);
  }
  return true;
}
