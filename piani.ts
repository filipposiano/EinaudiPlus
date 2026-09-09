// piani.ts — a quale piano appartiene una camera, e con che colore la si
// riconosce a colpo d'occhio.
//
// Puramente convenzionale, come machinesFor() in modello.ts: non c'è una
// tabella "camere" nel database (vedi README, "L'identità è autodichiarata")
// — il piano si legge dalla prima cifra del numero, esattamente come
// machinesFor() distingue Manica da Valentino guardando se è sotto o sopra
// 100.
//
// Il colore qui è un aiuto visivo, non uno stato: per questo resta fisso
// (non una coppia chiaro/scuro come GREEN/GREEN_T in tema.ts). Quei colori
// sono personalizzabili dal pannello Accessibilità perché portano un
// significato (libera/occupata/guasta) che deve restare leggibile anche a
// chi non distingue i colori; il piano di una camera non porta quel peso —
// è un raggruppamento, non un giudizio sullo stato di qualcosa.

export type Piano = "manica" | "1" | "2" | "3" | "4" | "basso";

/** In quest'ordine, dal basso in su: Manica prima perché è un edificio a
 *  parte, poi i piani del Valentino dal primo al quarto, poi il basso
 *  fabbricato. */
export const PIANI: Piano[] = ["manica", "1", "2", "3", "4", "basso"];

const NOMI: Record<Piano, string> = {
  manica: "Manica",
  "1":    "1° piano",
  "2":    "2° piano",
  "3":    "3° piano",
  "4":    "4° piano",
  basso:  "Basso fabbricato",
};

const COLORI: Record<Piano, string> = {
  manica: "#f97316",   // arancione
  "1":    "#eab308",   // giallo
  "2":    "#22c55e",   // verde
  "3":    "#ef4444",   // rosso
  "4":    "#3b82f6",   // blu
  basso:  "#a855f7",   // viola
};

/**
 * Il piano di una camera, o null se il numero non rientra in nessuno schema
 * noto (DIREZIONE, un formato imprevisto, ecc.).
 *
 * "Camere che iniziano per 1" si legge alla lettera: è la prima cifra del
 * numero, non il centinaio — 101 e 199 sono entrambe primo piano allo stesso
 * modo in cui lo sono per chi ci abita.
 */
export function pianoDi(room: string | null | undefined): Piano | null {
  const m = String(room ?? "").match(/^(\d+)/);
  if (!m) return null;
  const numero = m[1];
  if (parseInt(numero, 10) < 100) return "manica";
  const cifra = numero[0];
  if (cifra >= "1" && cifra <= "4") return cifra as "1" | "2" | "3" | "4";
  if (cifra === "5") return "basso";
  return null;
}

export const nomePiano   = (p: Piano) => NOMI[p];
export const colorePiano = (p: Piano) => COLORI[p];
