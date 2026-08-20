/* Service Worker — gestisce le notifiche push della lavanderia. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Handler 'fetch' di passaggio: non fa caching offline, ma la sua PRESENZA è
// richiesta da Chrome per considerare la PWA installabile (beforeinstallprompt).
self.addEventListener("fetch", () => { /* lascia gestire la richiesta al browser */ });

// Quale icona mostrare a seconda del passo del ciclo: prima del "kind" indicava
// solo il tag, che ora è uguale per tutti e tre i promemoria di una stessa
// prenotazione (serve a farli sostituire in tray invece di accumularsi).
// "pre" riguarda la lavatrice, gli altri due l'asciugatrice.
function iconFor(kind) {
  if (kind === "washerend" || kind === "dryerend") return "/icon-dryer.svg";
  return "/icon-washer.svg";
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || "Lavanderia";
  const options = {
    body: data.body || "",
    // `icon` (grande, a destra) e `badge` (piccola, mascherata in monocromo
    // dal sistema) erano lo stesso file: sulla stessa notifica comparivano
    // due volte la stessa immagine colorata. Ora l'icona grande mostra
    // lavatrice o asciugatrice a seconda del promemoria, la badge resta il
    // logo dell'app — il sistema la trasforma comunque in una sagoma bianca.
    icon: iconFor(data.kind),
    badge: "/icon.svg",
    tag: data.tag || "laundry-reminder",
    renotify: true,
    data: { url: data.url || "/" },

    // AGGIUNTE PER RISOLVERE IL PROBLEMA DEL SILENZIO:
    vibrate: [200, 100, 200, 100, 200, 100, 200], // Pattern di vibrazione (vibra-pausa-vibra...)
    requireInteraction: true // Evita che la notifica sparisca da sola dopo pochi secondi
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.navigate(url); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
