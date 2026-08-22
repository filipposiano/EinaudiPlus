// conferenzeApi.ts — la sala conferenze, vista dal browser.
//
// Due porte diverse, di proposito:
//   leggere  -> /api/conferenze, aperta a tutti
//   scrivere -> /api/admin/data, che verifica il cookie di sessione
//
// Non c'è una funzione "prenota" che i residenti possano chiamare, perché non
// esiste proprio: la sala la programma la direzione, gli altri la guardano.

const TOKEN = import.meta.env.VITE_SECRET_TOKEN;

/** Una data in cui la sala è occupata, con l'orario. */
export interface Occorrenza {
  id: number;
  titolo: string;
  note?: string;
  data: string;        // "2026-10-07"
  inizio: string;      // "14:00"
  fine: string;        // "18:00"
  ricorrente: boolean; // fa parte di una regola che si ripete
  // I campi della REGOLA da cui questa occorrenza nasce, ripetuti su ognuna.
  // Servono a precompilare il modulo di modifica senza un secondo giro di rete.
  dal?: string;
  al?: string;
  /** 0 = lunedì … 6 = domenica. null = tutti i giorni del periodo. */
  giorno?: number | null;
}

export interface Agenda {
  occupata_adesso: boolean;
  /** L'ora in cui si libera, se occupata adesso. */
  libera_dalle?: string;
  /** Che cosa la sta occupando. Viene dalla stessa riga di `occupata_adesso`,
   *  quindi non può contraddirla. */
  evento_adesso?: string;
  note_adesso?: string;
  occorrenze: Occorrenza[];
}

/** Una REGOLA di programmazione, com'è stata scritta. Solo per il pannello. */
export interface Regola {
  id: number;
  titolo: string;
  note?: string;
  inizio: string;
  fine: string;
  dal: string;
  al: string;
  /** 0 = lunedì … 6 = domenica. null = tutti i giorni del periodo. */
  giorno: number | null;
}

export async function agenda(giorni = 30): Promise<Agenda> {
  const res = await fetch(`/api/conferenze?token=${TOKEN}&giorni=${giorni}`);
  if (!res.ok) throw new Error("network");
  const d = await res.json();
  if (!d.ok) throw new Error(d.error || "error");
  return {
    occupata_adesso: Boolean(d.occupata_adesso),
    libera_dalle: d.libera_dalle ?? undefined,
    evento_adesso: d.evento_adesso ?? undefined,
    note_adesso: d.note_adesso ?? undefined,
    occorrenze: (d.occorrenze || []) as Occorrenza[],
  };
}
