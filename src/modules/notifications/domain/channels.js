// Endpoint push accettati — difesa in profondità: si spedisce solo verso i
// servizi push noti, mai verso URL arbitrari (l'endpoint arriva dal client).
// Un endpoint respinto qui non finisce nemmeno salvato in tabella: prima si
// poteva scrivere in push_sub l'indirizzo dei metadati cloud
// (169.254.169.254) e la riga restava per sempre, perché la potatura scatta
// solo sul 404/410 di un servizio vero.

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
