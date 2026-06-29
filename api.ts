// api.ts

const API_URL = "https://script.google.com/macros/s/AKfycbzjbXMoG5fvS_VaWdZ-8Gde7PQebS2j7ShiIHv8rlXz660XaJuTcGeAPKtwtbkYJYNiRA/exec";
const TOKEN = "filipposiano";

export type WeekData = Record<string, Record<string, Record<string, string>>>;
export type StatusData = Record<string, string>;

// Ottiene i dati iniziali (Snapshot)
export async function getSnapshot(): Promise<{ week: WeekData; status: StatusData }> {
  const res = await fetch(`${API_URL}?token=${TOKEN}`);
  if (!res.ok) throw new Error("Errore di rete durante il caricamento");
  
  const data = await res.json();
  if (!data.ok) throw new Error("Errore restituito dal server");
  
  return { 
    week: data.week || {}, 
    status: data.status || {} 
  };
}

// Helper generico per le azioni di scrittura (Post) verso Google Apps Script
// Usiamo text/plain per aggirare i fastidiosi problemi di CORS preflight di Google.
// IMPORTANTE: il doPost del backend legge `token` e `action` dal CORPO JSON,
// non dalla query string (a differenza del doGet). Vanno quindi inseriti nel body,
// altrimenti la scrittura viene rifiutata con {ok:false, error:"unauthorized"}.
async function postAction(action: string, payload: any) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({ token: TOKEN, action, ...payload }),
  });
  
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "Errore durante l'operazione");
  }
  return data;
}

// Prenota una macchina
export async function book(day: number, slot: number, machine: string, room: string) {
  return postAction("book", { day, slot, machine, room });
}

// Cancella una prenotazione
export async function clearBooking(day: number, slot: number, machine: string) {
  return postAction("clear", { day, slot, machine });
}

// Imposta lo stato (Fuori Servizio / Operativa)
export async function setStatus(machine: string, isOos: boolean) {
  const res = await postAction("status", { machine, status: isOos ? "oos" : "ok" });
  return res.status; // Ritorna l'oggetto status aggiornato
}

// ─── Notifiche push ────────────────────────────────────────────────────────────
// Registra (o aggiorna) la subscription push di questo dispositivo, legandola al
// numero di camera: il backend userà la camera per sapere quali turni ricordare.
export async function subscribePush(room: string, sub: PushSubscriptionJSON) {
  return postAction("subscribe", { room, sub });
}

// Rimuove la subscription (identificata dall'endpoint) dal backend.
export async function unsubscribePush(endpoint: string) {
  return postAction("unsubscribe", { endpoint });
}

// Invia un feedback/segnalazione (salvato su foglio "Feedback" lato Apps Script).
export async function sendFeedback(room: string | null, text: string) {
  return postAction("feedback", { room: room || "", text });
}