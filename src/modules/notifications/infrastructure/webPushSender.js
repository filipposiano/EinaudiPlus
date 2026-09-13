// Invio Web Push — invariato rispetto a api/_lib/push.js originale, solo
// riorganizzato come "sender" iniettabile (i test possono passare un sender
// finto senza importare la libreria web-push né configurare VAPID).

import webpush from "web-push";
import { endpointAllowed } from "../domain/channels.js";

let configured = false;
function configure() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    VAPID_SUBJECT || "mailto:admin@example.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
  configured = true;
  return true;
}

export const webPushSender = {
  configured() {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  },

  /**
   * @returns 'ok' | 'gone' | 'err'
   *   'gone' = 404/410: l'utente ha disinstallato o revocato il permesso.
   *            La subscription non servirà mai più e va cancellata.
   */
  async send(subscription, payload) {
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
  },
};
