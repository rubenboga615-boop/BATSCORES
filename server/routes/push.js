import { Router } from 'express';
import express from 'express';
import { config, pushEnabled } from '../config.js';
import { MAX_FIXTURES } from '../pushStore.js';

/**
 * Abonnement aux notifications.
 *
 * Le navigateur negocie l'abonnement avec le service de push de son
 * fournisseur, puis depose ici le point de terminaison obtenu. Le serveur ne
 * connait ni compte ni identite : un abonnement est une adresse opaque et
 * deux cles publiques, rien de plus.
 */
export function createPushRouter(store) {
  const router = Router();
  router.use(express.json({ limit: '8kb' }));

  /** GET /api/push/key - de quoi s'abonner, ou la raison de ne pas proposer. */
  router.get('/key', (req, res) => {
    if (!pushEnabled()) {
      return res.json({
        enabled: false,
        reason: "Les notifications ne sont pas configurees sur ce serveur (cles VAPID absentes).",
      });
    }
    return res.json({ enabled: true, publicKey: config.vapid.publicKey });
  });

  /** Verifie la forme d'un abonnement avant de l'accepter. */
  function readSubscription(body) {
    const subscription = body?.subscription;
    if (!subscription?.endpoint || typeof subscription.endpoint !== 'string') {
      return { error: 'Abonnement invalide : point de terminaison manquant.' };
    }
    let url;
    try {
      url = new URL(subscription.endpoint);
    } catch {
      return { error: 'Abonnement invalide : point de terminaison illisible.' };
    }
    // Un point de terminaison en clair ferait transiter la notification sans
    // chiffrement de transport ; aucun service de push serieux n'en propose.
    if (url.protocol !== 'https:') {
      return { error: 'Abonnement invalide : le point de terminaison doit etre en HTTPS.' };
    }
    if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
      return { error: 'Abonnement invalide : cles de chiffrement manquantes.' };
    }
    return { subscription };
  }

  /** POST /api/push/subscribe */
  router.post('/subscribe', (req, res) => {
    if (!pushEnabled()) {
      return res.status(503).json({ error: 'Notifications non configurees sur ce serveur.' });
    }
    const { subscription, error } = readSubscription(req.body);
    if (error) return res.status(400).json({ error });

    const fixtures = Array.isArray(req.body?.fixtures) ? req.body.fixtures : [];
    const record = store.subscribe(subscription, fixtures);
    return res.status(201).json({
      ok: true,
      fixtures: record.fixtures,
      max: MAX_FIXTURES,
    });
  });

  /** POST /api/push/unsubscribe */
  router.post('/unsubscribe', (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
      return res.status(400).json({ error: 'Point de terminaison manquant.' });
    }
    // Un abonnement deja absent n'est pas une erreur : le resultat voulu est
    // atteint, et le client n'a rien a rattraper.
    store.unsubscribe(endpoint);
    return res.json({ ok: true });
  });

  /** GET /api/push/state?endpoint= - ce que le serveur sait de cet appareil. */
  router.get('/state', (req, res) => {
    const endpoint = String(req.query.endpoint || '');
    if (!endpoint) return res.status(400).json({ error: 'Point de terminaison manquant.' });
    const record = store.get(endpoint);
    return res.json({
      known: Boolean(record),
      fixtures: record?.fixtures || [],
      max: MAX_FIXTURES,
    });
  });

  return router;
}
