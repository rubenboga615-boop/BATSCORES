/**
 * Web Push : le chiffrement est verifie par aller-retour, et la signature
 * VAPID par verification cryptographique.
 *
 * On ne peut pas joindre un vrai service de push depuis les tests. En
 * revanche, un message qu'on rechiffre et redechiffre avec les cles d'un faux
 * abonnement prouve exactement ce qui compte : que la derivation de cles suit
 * la specification et qu'un navigateur saura lire le message.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const {
  generateVapidKeys, encryptPayload, decryptPayload,
  vapidHeader, verifyVapid, sendNotification, PushError,
} = await import('../server/webpush.js');

/** Faux abonnement : la paire de cles qu'un navigateur produirait. */
function fakeSubscription(endpoint = 'https://push.exemple.fr/envoi/abc123') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    subscription: {
      endpoint,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: auth.toString('base64url'),
      },
    },
    secrets: {
      privateKey: ecdh.getPrivateKey().toString('base64url'),
      publicKey: ecdh.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    },
  };
}

describe('chiffrement du message', () => {
  test('un message chiffre se redechiffre a l\'identique', () => {
    const { subscription, secrets } = fakeSubscription();
    const message = JSON.stringify({ title: 'But !', body: 'PSG 1 - 0 Marseille' });

    const body = encryptPayload(subscription.keys, message);
    assert.equal(decryptPayload(body, secrets), message);
  });

  test('les accents et emoji survivent au transport', () => {
    const { subscription, secrets } = fakeSubscription();
    const message = 'Début de match ⚽ — Olympique Lyonnais reçoit Saint-Étienne';
    const body = encryptPayload(subscription.keys, message);
    assert.equal(decryptPayload(body, secrets), message);
  });

  test('chaque envoi utilise une paire ephemere differente', () => {
    const { subscription } = fakeSubscription();
    const a = encryptPayload(subscription.keys, 'x');
    const b = encryptPayload(subscription.keys, 'x');
    // Meme message, corps differents : sinon la cle serait reutilisee et deux
    // messages identiques seraient reconnaissables sur le reseau.
    assert.notEqual(a.toString('base64'), b.toString('base64'));
    assert.notEqual(a.subarray(0, 16).toString('hex'), b.subarray(0, 16).toString('hex'));
  });

  test('le corps respecte la structure attendue par la specification', () => {
    const { subscription } = fakeSubscription();
    const body = encryptPayload(subscription.keys, 'bonjour');
    assert.equal(body.readUInt32BE(16), 4096, 'taille de record annoncee');
    assert.equal(body.readUInt8(20), 65, 'longueur de la cle publique du serveur');
    assert.equal(body.readUInt8(21), 4, 'point non compresse');
    // 16 (sel) + 5 (en-tete) + 65 (cle) + texte + 1 (delimiteur) + 16 (tag)
    assert.equal(body.length, 16 + 5 + 65 + 'bonjour'.length + 1 + 16);
  });

  test('les cles d\'un autre abonnement ne dechiffrent rien', () => {
    const alice = fakeSubscription();
    const bob = fakeSubscription();
    const body = encryptPayload(alice.subscription.keys, 'secret');
    assert.throws(() => decryptPayload(body, bob.secrets));
  });

  test('un abonnement malforme est refuse avant tout envoi', () => {
    assert.throws(
      () => encryptPayload({ p256dh: 'trop-court', auth: 'x'.repeat(22) }, 'x'),
      /p256dh/,
    );
    const { subscription } = fakeSubscription();
    assert.throws(
      () => encryptPayload({ p256dh: subscription.keys.p256dh, auth: 'court' }, 'x'),
      /auth/,
    );
  });
});

describe('authentification VAPID', () => {
  test('le jeton se verifie avec la cle publique annoncee', () => {
    const keys = generateVapidKeys();
    const vapid = { ...keys, subject: 'mailto:admin@exemple.fr' };
    const { Authorization } = vapidHeader('https://push.exemple.fr/envoi/abc', vapid);

    assert.match(Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    const claims = verifyVapid(Authorization, keys.publicKey);
    assert.ok(claims, 'la signature doit etre valide');
    assert.equal(claims.aud, 'https://push.exemple.fr', "l'audience est l'origine du service");
    assert.equal(claims.sub, 'mailto:admin@exemple.fr');
    assert.ok(claims.exp > Math.floor(Date.now() / 1000));
    assert.ok(claims.exp < Math.floor(Date.now() / 1000) + 12 * 3600, 'jeton de courte duree');
  });

  test('une autre cle publique ne valide pas le jeton', () => {
    const keys = generateVapidKeys();
    const autre = generateVapidKeys();
    const { Authorization } = vapidHeader('https://push.exemple.fr/e/1', { ...keys, subject: 'mailto:a@b.fr' });
    assert.equal(verifyVapid(Authorization, autre.publicKey), null);
  });

  test('la signature est au format brut r||s, pas en DER', () => {
    const keys = generateVapidKeys();
    const { Authorization } = vapidHeader('https://push.exemple.fr/e/1', { ...keys, subject: 'mailto:a@b.fr' });
    const signature = Buffer.from(/t=[^.]+\.[^.]+\.([\w-]+)/.exec(Authorization)[1], 'base64url');
    // Un encodage DER commencerait par 0x30 et ferait 70 a 72 octets ; les
    // services de push refusent alors le jeton sans expliquer pourquoi.
    assert.equal(signature.length, 64);
    assert.notEqual(signature[0], 0x30);
  });

  test('l\'audience suit le service, pas le chemin de l\'abonnement', () => {
    const keys = generateVapidKeys();
    const vapid = { ...keys, subject: 'mailto:a@b.fr' };
    const un = verifyVapid(vapidHeader('https://fcm.exemple/x/1', vapid).Authorization, keys.publicKey);
    const deux = verifyVapid(vapidHeader('https://fcm.exemple/y/2', vapid).Authorization, keys.publicKey);
    assert.equal(un.aud, deux.aud);
  });
});

describe('envoi', () => {
  /** Faux service de push : renvoie le code demande et retient la requete. */
  async function withPushService(status, run) {
    const http = await import('node:http');
    const received = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(status);
        res.end(status >= 400 ? 'abonnement inconnu' : '');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/envoi/abc`;
    try {
      return await run(url, received);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  test('la requete porte les en-tetes attendus et un corps chiffre', async () => {
    const keys = generateVapidKeys();
    await withPushService(201, async (url, received) => {
      const { subscription, secrets } = fakeSubscription(url);
      await sendNotification(
        subscription,
        { title: 'Mi-temps', body: '1 - 0' },
        { ...keys, subject: 'mailto:a@b.fr' },
        { ttl: 900 },
      );

      assert.equal(received.length, 1);
      const { headers, body } = received[0];
      assert.equal(headers['content-encoding'], 'aes128gcm');
      assert.equal(headers.ttl, '900');
      assert.match(headers.authorization, /^vapid t=/);

      const clair = JSON.parse(decryptPayload(body, secrets));
      assert.equal(clair.title, 'Mi-temps');
    });
  });

  test('un abonnement expire est signale comme tel, pas comme une panne', async () => {
    const keys = generateVapidKeys();
    await withPushService(410, async (url) => {
      const { subscription } = fakeSubscription(url);
      await assert.rejects(
        sendNotification(subscription, { title: 'x' }, { ...keys, subject: 'mailto:a@b.fr' }),
        (err) => {
          assert.ok(err instanceof PushError);
          assert.equal(err.gone, true, 'un 410 doit conduire a oublier l\'abonnement');
          return true;
        },
      );
    });
  });

  test('une panne du service n\'est pas confondue avec un abonnement perime', async () => {
    const keys = generateVapidKeys();
    await withPushService(500, async (url) => {
      const { subscription } = fakeSubscription(url);
      await assert.rejects(
        sendNotification(subscription, { title: 'x' }, { ...keys, subject: 'mailto:a@b.fr' }),
        (err) => {
          assert.equal(err.gone, false, 'un 500 est passager : on reessaiera');
          return true;
        },
      );
    });
  });
});
