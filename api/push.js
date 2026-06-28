// api/push.js — Vercel Serverless Function: "relay" che firma e invia una Web Push.
//
// Perché esiste: il protocollo Web Push richiede firma VAPID (ES256) e cifratura
// del payload, difficili da fare in Google Apps Script. Apps Script fa da
// SCHEDULER (trigger ogni 5 min, decide CHI avvisare) e chiama questo relay che
// fa solo la parte crittografica e l'invio.
//
// Variabili d'ambiente da impostare su Vercel (Project → Settings → Environment Variables):
//   VAPID_PUBLIC_KEY   = chiave pubblica VAPID
//   VAPID_PRIVATE_KEY  = chiave privata VAPID  (SEGRETA)
//   VAPID_SUBJECT      = "mailto:tua-email@example.com"
//   RELAY_SECRET       = una password condivisa con l'Apps Script (SEGRETA)
//
// Body atteso (POST JSON):
//   { secret, subscription: {endpoint, keys:{p256dh, auth}}, payload: {title, body, url, tag} }

import webpush from "web-push";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method-not-allowed" });
  }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, RELAY_SECRET } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(500).json({ ok: false, error: "vapid-not-configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  if (!RELAY_SECRET || body.secret !== RELAY_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const { subscription, payload } = body;
  if (!subscription || typeof subscription.endpoint !== "string") {
    return res.status(400).json({ ok: false, error: "no-subscription" });
  }

  // Anti-SSRF: invia solo verso i servizi push noti, non a URL arbitrari.
  // (difesa in profondità nel caso il RELAY_SECRET trapelasse)
  const PUSH_HOSTS = [
    "fcm.googleapis.com", "android.googleapis.com",          // Chrome/Android
    ".push.apple.com",                                        // Safari/iOS
    ".notify.windows.com",                                    // Edge/Windows
    ".push.services.mozilla.com",                             // Firefox
  ];
  let host;
  try { host = new URL(subscription.endpoint).hostname; } catch { host = ""; }
  const allowed = PUSH_HOSTS.some((h) => h.startsWith(".") ? host.endsWith(h) : host === h);
  if (!allowed) {
    return res.status(400).json({ ok: false, error: "endpoint-not-allowed" });
  }

  // Limite dimensione payload (le push hanno comunque un tetto ~4KB).
  const payloadStr = JSON.stringify(payload || {});
  if (payloadStr.length > 3500) {
    return res.status(400).json({ ok: false, error: "payload-too-large" });
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT || "mailto:admin@example.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

  try {
    await webpush.sendNotification(subscription, payloadStr);
    return res.status(200).json({ ok: true });
  } catch (err) {
    const code = err && err.statusCode;
    // 404/410 = subscription scaduta/rimossa → il chiamante può eliminarla.
    // Non esponiamo dettagli interni: solo lo stato HTTP del servizio push.
    return res.status(200).json({ ok: false, gone: code === 404 || code === 410, error: code || "send-failed" });
  }
}
