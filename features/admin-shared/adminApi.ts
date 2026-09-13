// La chiamata verso /api/admin/data, condivisa da ogni scheda del pannello:
// tutte parlano con lo stesso endpoint, distinte solo dall'`action` che
// mandano.

export async function call<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/admin/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-requested-with": "admin" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (res.status === 401) throw new Error("SESSIONE_SCADUTA");
  const data = await res.json();
  if (!data.ok) {
    // I campi oltre `error` restano attaccati all'eccezione: alcune funzioni
    // SQL spiegano il rifiuto invece di limitarsi a nominarlo — `con` e
    // `quando` dicono con quale evento e in che data una programmazione si
    // sovrappone. Buttarli via lasciava all'utente il compito di cercarlo.
    const err = Object.assign(new Error(data.error || "errore"), data);
    throw err;
  }
  return data;
}
