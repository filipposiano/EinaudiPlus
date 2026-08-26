/* Service Worker — gestisce le notifiche push della lavanderia. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Handler 'fetch' di passaggio: non fa caching offline, ma la sua PRESENZA è
// richiesta da Chrome per considerare la PWA installabile (beforeinstallprompt).
self.addEventListener("fetch", () => { /* lascia gestire la richiesta al browser */ });

// L'URL su cui portare chi tocca la notifica, ricondotto sempre a questa origine.
//
// Oggi chi spedisce e' solo /api/cron, che manda "/" fisso: il payload non e'
// scrivibile da fuori (per firmare una push serve la chiave VAPID privata).
// Il controllo c'e' lo stesso perche' la fiducia qui e' mal riposta per
// costruzione — una notifica che l'utente legge come "dell'app" e che apre un
// sito altrui e' phishing perfetto, e basterebbe un mittente nuovo, o una
// regressione, per aprirla. Costa tre righe e chiude la categoria.
function urlSicuro(raw) {
  try {
    const u = new URL(String(raw || "/"), self.location.origin);
    if (u.origin !== self.location.origin) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

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

// ─── Storico locale ──────────────────────────────────────────────────────────
//
// Il gemello di notifiche.ts, in JavaScript semplice perché qui non passa il
// compilatore: stesso database, stesso store, stessi campi. Se cambia un nome
// di là, cambia anche qua.
//
// Tutto è avvolto in try/catch e in promesse che non rifiutano mai: se
// IndexedDB non c'è (navigazione privata, impostazioni restrittive) la
// notifica deve comunque comparire. Lo storico è un di più, non la notifica.

const DB_NOME = "einaudiplus";
const DB_VERSION = 1;
const STORE = "notifiche";
const MAX_STORICO = 60;

function apriDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "ts" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function salvaNotifica(n) {
  return apriDb().then((db) => new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    st.put(n);
    // Potatura: si tengono le MAX_STORICO piu' recenti. Senza, un anno di
    // promemoria resterebbe sul telefono per sempre.
    const tutte = st.getAll();
    tutte.onsuccess = () => {
      const list = (tutte.result || []).sort((a, b) => b.ts - a.ts);
      for (const vecchia of list.slice(MAX_STORICO)) st.delete(vecchia.ts);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  })).catch(() => {});
}

/** Sveglia le finestre aperte: la campanella si accende senza ricaricare. */
function avvisaFinestre() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then((list) => { for (const c of list) c.postMessage({ tipo: "notifica" }); })
    .catch(() => {});
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || "Lavanderia";
  const options = {
    body: data.body || "",
    // `icon` (grande, a destra) e `badge` (piccola, nella barra di stato)
    // sono due file diversi apposta. Il badge, su Android, il sistema lo
    // legge SOLO dal canale alpha e lo ridipinge lui — motivo per cui
    // icon-badge.svg ha lo sfondo trasparente e nient'altro che il glifo:
    // con lo sfondo rosso PIENO di icon.svg (usato qui fino a poco fa)
    // l'intero quadrato risultava opaco, senza trasparenza da cui
    // distinguere la lavatrice dal fondo, e compariva un blob pieno — "un
    // pallino bianco" invece dell'icona, su alcuni dispositivi.
    icon: iconFor(data.kind),
    badge: "/icon-badge.svg",
    tag: data.tag || "laundry-reminder",
    renotify: true,
    data: { url: urlSicuro(data.url) },

    // AGGIUNTE PER RISOLVERE IL PROBLEMA DEL SILENZIO:
    vibrate: [200, 100, 200, 100, 200, 100, 200], // Pattern di vibrazione (vibra-pausa-vibra...)
    requireInteraction: true // Evita che la notifica sparisca da sola dopo pochi secondi
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    salvaNotifica({
      ts: Date.now(),
      title,
      body: options.body,
      kind: data.kind || "",
      url: options.data.url,
      read: false,
    }).then(avvisaFinestre),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Ricontrollato anche qui: la notifica potrebbe essere stata creata da una
  // versione precedente del service worker, quando il campo non era filtrato.
  const url = urlSicuro(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.navigate(url); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
