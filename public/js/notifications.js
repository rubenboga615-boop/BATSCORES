/**
 * Notifications : negociation avec le navigateur, puis synchronisation des
 * rencontres suivies avec le serveur.
 *
 * Le principe est de ne rien demander tant que l'utilisateur n'a rien
 * demande. Une application qui reclame l'autorisation d'envoyer des
 * notifications des la premiere visite se la fait refuser une fois pour
 * toutes, et ce refus est difficile a revenir dessus.
 */
import { store } from './store.js';

const state = {
  supported: false,
  serverEnabled: null,
  publicKey: null,
  subscription: null,
};

/** La cle publique voyage en base64url ; l'API du navigateur veut des octets. */
function keyToBytes(base64url) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function notificationsSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** Etat complet, sans jamais declencher de demande d'autorisation. */
export async function notificationState() {
  state.supported = notificationsSupported();
  if (!state.supported) {
    return {
      supported: false,
      reason: "Ce navigateur ne gere pas les notifications web. Sur iPhone, il faut d'abord ajouter BATSCORES a l'ecran d'accueil.",
    };
  }

  if (state.serverEnabled === null) {
    try {
      const response = await fetch('/api/push/key');
      const payload = await response.json();
      state.serverEnabled = Boolean(payload.enabled);
      state.publicKey = payload.publicKey || null;
      state.serverReason = payload.reason || null;
    } catch {
      state.serverEnabled = false;
      state.serverReason = 'Serveur injoignable.';
    }
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  state.subscription = subscription;

  return {
    supported: true,
    serverEnabled: state.serverEnabled,
    serverReason: state.serverReason,
    permission: Notification.permission,
    active: Boolean(subscription) && Notification.permission === 'granted',
  };
}

/**
 * Active les notifications : autorisation, abonnement, puis envoi de la liste
 * des rencontres suivies.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function enableNotifications() {
  const current = await notificationState();
  if (!current.supported) return { ok: false, reason: current.reason };
  if (!current.serverEnabled) return { ok: false, reason: current.serverReason };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      ok: false,
      reason: permission === 'denied'
        ? "Les notifications sont bloquees pour ce site. Il faut les reautoriser dans les reglages du navigateur."
        : "Autorisation non accordee.",
    };
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      // Obligatoire sur tous les navigateurs actuels : un abonnement muet,
      // qui ne montrerait rien a l'utilisateur, est refuse.
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(state.publicKey),
    });
  }
  state.subscription = subscription;

  await syncFollowedFixtures();
  return { ok: true };
}

export async function disableNotifications() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return { ok: true };

  // On previent le serveur avant de rompre l'abonnement : dans l'autre ordre,
  // le point de terminaison ne serait plus lisible pour l'identifier.
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});

  await subscription.unsubscribe().catch(() => {});
  state.subscription = null;
  return { ok: true };
}

/**
 * Transmet au serveur la liste des matchs favoris.
 * Sans abonnement actif, c'est un non-evenement : inutile de tenir une liste
 * a jour pour un appareil qui ne recevra rien.
 */
export async function syncFollowedFixtures() {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return false;

  const body = JSON.stringify({
    subscription: subscription.toJSON(),
    fixtures: store.favoriteFixtures(),
  });
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(() => null);
  return Boolean(response?.ok);
}
