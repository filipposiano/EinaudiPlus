// push.ts — client per le notifiche Web Push (promemoria turni lavanderia).
//
// Flusso: registra il Service Worker → chiede il permesso notifiche → crea la
// subscription push firmata con la chiave VAPID pubblica → la manda al backend
// (Apps Script) insieme al numero di camera. Il backend, quando un turno di
// quella camera sta per iniziare, invia la push tramite il relay su Vercel.

import * as api from "./api";

// Chiave VAPID PUBBLICA (non è un segreto: può stare nel frontend).
// La privata corrispondente va impostata SOLO come variabile d'ambiente su Vercel.
//
// ATTENZIONE: cambiando questa chiave, tutte le subscription create con la
// precedente smettono di funzionare. E lo fanno in silenzio: il browser
// continua a dire che le notifiche sono attive, ma il servizio push rifiuta
// quelle firmate con la chiave nuova. Per questo sotto c'è sameKey(), che
// riconosce le subscription vecchie e le rifà.
const VAPID_PUBLIC_KEY =
  "BPzyOFozfWw5LapO8sCkE4ukqpXDiezU8unudCfDhd6e7mDUGdJVNXqm46uyVDAykZ4ilb7lKFppTTDgZ1bjo2c";

export type ReminderState = "unknown" | "unsupported" | "denied" | "on" | "off";

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js");
}

/**
 * La subscription è firmata con la chiave VAPID che usiamo adesso?
 *
 * Serve perché una subscription creata con una chiave diversa resta valida per
 * il browser ma non riceve più nulla. Senza questo controllo l'utente vedrebbe
 * i promemoria "attivi" e non gli arriverebbe niente, per sempre.
 */
function sameKey(sub: PushSubscription): boolean {
  const raw = sub.options?.applicationServerKey;
  if (!raw) return false;
  const current = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const existing = new Uint8Array(raw as ArrayBuffer);
  if (existing.length !== current.length) return false;
  return existing.every((b, i) => b === current[i]);
}

// Stato attuale del promemoria per questo dispositivo.
export async function getReminderState(): Promise<ReminderState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "off";
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}

// Attiva i promemoria: permesso + subscription + invio al backend.
export async function enableReminders(room: string): Promise<void> {
  if (!pushSupported()) throw new Error("unsupported");
  const reg = await registration();
  await navigator.serviceWorker.ready;

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("denied");

  let sub = await reg.pushManager.getSubscription();

  // Una subscription firmata con la chiave vecchia va disdetta prima: il
  // browser rifiuta subscribe() con una applicationServerKey diversa da quella
  // già registrata (InvalidStateError).
  if (sub && !sameKey(sub)) {
    try { await api.unsubscribePush(sub.endpoint); } catch { /* best effort */ }
    await sub.unsubscribe();
    sub = null;
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await api.subscribePush(room, sub.toJSON());
}

/**
 * Riallinea la subscription all'avvio dell'app, in silenzio.
 *
 * Risolve due problemi diversi:
 *  - la migrazione: il nuovo database parte senza le subscription vecchie, e
 *    chi le aveva attive smetterebbe di ricevere senza accorgersene;
 *  - il cambio camera: oggi la subscription resta legata alla camera con cui
 *    è stata creata, quindi chi trasloca continua a ricevere i promemoria
 *    della stanza vecchia.
 *
 * È idempotente lato server (upsert sull'endpoint), quindi si può chiamare a
 * ogni avvio senza effetti collaterali.
 */
export async function refreshSubscription(room: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;

    // Chiave cambiata: la rifacciamo, così l'utente non resta muto.
    if (!sameKey(sub)) {
      await enableReminders(room);
      return;
    }
    await api.subscribePush(room, sub.toJSON());
  } catch {
    /* silenzioso: è una riparazione opportunistica, non deve disturbare */
  }
}

// Disattiva i promemoria su questo dispositivo.
export async function disableReminders(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try { await api.unsubscribePush(sub.endpoint); } catch { /* best effort */ }
  await sub.unsubscribe();
}
