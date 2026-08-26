// notifiche.ts — lo storico delle notifiche ricevute, sul dispositivo.
//
// Le push arrivano al service worker anche quando l'app è chiusa, e finora
// vivevano solo nel centro notifiche del sistema: chi scorreva via l'avviso
// "il turno inizia alle 14:30" non aveva più modo di rileggerlo. Qui ogni push
// viene anche SCRITTA, e la schermata Notifiche la ripesca.
//
// Perché IndexedDB e non localStorage: chi scrive è il service worker, e un
// service worker localStorage non ce l'ha. IndexedDB è l'unico archivio che
// entrambi — pagina e worker — sanno aprire.
//
// Perché non sul server: sarebbe uno storico condiviso fra i dispositivi della
// stessa camera, ma vorrebbe una tabella, un endpoint e una migrazione per una
// cosa che qui si legge sempre e solo sul telefono su cui la notifica è
// arrivata. Il prezzo è dichiarato: cambiando telefono lo storico non segue.
//
// Il gemello di questo file è la parte finale di public/sw.js, che scrive le
// stesse chiavi in JavaScript semplice. Se cambia il nome di un campo qui,
// cambia lì.

export const DB_NOME    = "einaudiplus";
export const DB_VERSION = 1;
export const STORE      = "notifiche";

/** Quante se ne tengono: oltre, si buttano le più vecchie. */
export const MAX_STORICO = 60;

export interface Notifica {
  /** Millisecondi epoch: fa da chiave e da ordinamento. */
  ts: number;
  title: string;
  body: string;
  /** 'pre' | 'washerend' | 'dryerend' | altro: la stessa etichetta della push. */
  kind: string;
  url: string;
  read: boolean;
}

function apri(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "ts" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Tutte le notifiche salvate, dalla più recente.
 *
 * Non lancia mai: in navigazione privata (o su un browser che nega IndexedDB)
 * torna una lista vuota, e la schermata mostra il suo "ancora niente" invece
 * di un errore. Uno storico è una comodità, non un dato di cui si abbia
 * bisogno per prenotare.
 */
export async function listNotifiche(): Promise<Notifica[]> {
  try {
    const db = await apri();
    const out = await new Promise<Notifica[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []) as Notifica[]);
      req.onerror   = () => reject(req.error);
    });
    db.close();
    return out.sort((a, b) => b.ts - a.ts);
  } catch { return []; }
}

/** Quante non sono ancora state lette: il pallino sulla campanella. */
export async function contaNonLette(): Promise<number> {
  return (await listNotifiche()).filter((n) => !n.read).length;
}

/** Segna lette tutte quelle salvate. Si chiama aprendo la schermata. */
export async function segnaTutteLette(): Promise<void> {
  try {
    const db = await apri();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const req = st.getAll();
      req.onsuccess = () => {
        for (const n of (req.result || []) as Notifica[]) if (!n.read) st.put({ ...n, read: true });
      };
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
    db.close();
  } catch { /* niente storico, niente da segnare */ }
}

/** Svuota lo storico. */
export async function svuotaStorico(): Promise<void> {
  try {
    const db = await apri();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
    db.close();
  } catch { /* idem */ }
}

/**
 * Avvisa quando arriva una push mentre l'app è aperta.
 *
 * Il service worker, dopo aver scritto, manda un messaggio a tutte le finestre
 * aperte: senza, la campanella resterebbe muta fino al ricaricamento proprio
 * nel caso in cui l'utente sta guardando lo schermo.
 *
 * Torna la funzione per smettere di ascoltare.
 */
export function ascoltaNotifiche(cb: () => void): () => void {
  if (!("serviceWorker" in navigator)) return () => {};
  const h = (e: MessageEvent) => { if (e.data && e.data.tipo === "notifica") cb(); };
  navigator.serviceWorker.addEventListener("message", h);
  return () => navigator.serviceWorker.removeEventListener("message", h);
}
