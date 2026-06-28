// push.ts — client per le notifiche Web Push (promemoria turni lavanderia).
//
// Flusso: registra il Service Worker → chiede il permesso notifiche → crea la
// subscription push firmata con la chiave VAPID pubblica → la manda al backend
// (Apps Script) insieme al numero di camera. Il backend, quando un turno di
// quella camera sta per iniziare, invia la push tramite il relay su Vercel.

import * as api from "./api";

// Chiave VAPID PUBBLICA (non è un segreto: può stare nel frontend).
// La privata corrispondente va impostata SOLO come variabile d'ambiente su Vercel.
const VAPID_PUBLIC_KEY =
  "BLG2P3_gpSsGhGi9vrVKD_Kr2-Ql6S-8bh3xDaB8s5U-aA3o59LMtPjRAoww6DzbJ_Gkl7So00O_o0DOQPSuVWg";

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
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await api.subscribePush(room, sub.toJSON());
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
