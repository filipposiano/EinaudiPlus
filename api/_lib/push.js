// Invio Web Push. Estratto da api/push.js per essere richiamato in-process dal
// cron, senza il salto HTTP e senza RELAY_SECRET.
//
// api/push.js resta in piedi come relay firmato: durante la finestra di rollback
// i trigger Apps Script devono poter continuare a spedire.

import webpush from "web-push";

// Difesa in profondita': si spedisce solo verso i servizi push noti, mai verso
// URL arbitrari. Conta perche' l'endpoint arriva dal client.
const PUSH_HOSTS = [
  "fcm.googleapis.com", "android.googleapis.com",  // Chrome / Android
  ".push.apple.com",                                // Safari / iOS
  ".notify.windows.com",                            // Edge / Windows
  ".push.services.mozilla.com",                     // Firefox
];

export function endpointAllowed(endpoint) {
  let host;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return false;
  }
  return PUSH_HOSTS.some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));
}

let configured = false;
function configure() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    VAPID_SUBJECT || "mailto:admin@example.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Spedisce una notifica.
 * @returns 'ok' | 'gone' | 'err'
 *   'gone' = 404/410: l'utente ha disinstallato o revocato il permesso.
 *            La subscription non servira' mai piu' e va cancellata.
 */
export async function sendWebPush(subscription, payload) {
  if (!configure()) return "err";
  if (!subscription?.endpoint || !endpointAllowed(subscription.endpoint)) return "err";

  const text = JSON.stringify(payload || {});
  if (text.length > 3500) return "err"; // le push hanno comunque un tetto ~4KB

  try {
    await webpush.sendNotification(subscription, text);
    return "ok";
  } catch (err) {
    const code = err?.statusCode;
    return code === 404 || code === 410 ? "gone" : "err";
  }
}
