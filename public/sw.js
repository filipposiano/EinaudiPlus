/* Service Worker — gestisce le notifiche push della lavanderia. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Handler 'fetch' di passaggio: non fa caching offline, ma la sua PRESENZA è
// richiesta da Chrome per considerare la PWA installabile (beforeinstallprompt).
self.addEventListener("fetch", () => { /* lascia gestire la richiesta al browser */ });

// Un'icona per ciascuno dei tre passi del ciclo.
//
// I tre promemoria condividono il `tag` — serve a farli SOSTITUIRE nel centro
// notifiche invece di accumularsi — quindi l'icona è l'unica cosa che dice a
// colpo d'occhio a che punto si è, prima ancora di leggere.
//
// Le tre sagome sono diverse fra loro, non tre varianti della stessa: a 48px,
// la dimensione a cui il sistema disegna davvero l'icona, un dettaglio dentro
// l'oblò non si vede. Prima "sposta in asciugatrice" e "ritira i vestiti"
// usavano lo stesso file, e l'asciugatrice differiva dalla lavatrice per tre
// righine invisibili.
function iconFor(kind) {
  if (kind === "washerend") return "/icon-dryer.svg";   // sposta in asciugatrice
  if (kind === "dryerend")  return "/icon-ritiro.svg";  // vieni a prendere il bucato
  return "/icon-washer.svg";                            // 'pre': inizia il turno
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
