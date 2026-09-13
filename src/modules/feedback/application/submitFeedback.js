// Use-case: segnalazione pubblica (es. "lavatrice guasta").
//
// Fedele all'originale: nessuna validazione JS sul testo oltre alla
// coercizione a stringa — è la funzione SQL a respingere un testo vuoto
// (verificato dalla suite di test esistente).

export async function submitFeedback({ room, text }, { feedbackRepository }) {
  return feedbackRepository.add(String(room ?? "").trim(), String(text || ""));
}
