// i18n.ts — mette insieme le lingue e decide quale mostrare.
//
// I testi veri stanno in lingue/, uno per file. Qui c'è solo l'assemblaggio,
// così aggiungere una lingua significa scrivere un file e aggiungere una riga
// a `LINGUE` — nient'altro.
//
// L'italiano è la lingua di riferimento: da lui TypeScript ricava il tipo
// `Testi`, e ogni altra lingua deve avere esattamente le stesse chiavi. Una
// traduzione dimenticata ferma la build invece di arrivare in produzione come
// una stringa vuota.

import it from "./lingue/it";
import en from "./lingue/en";
import fr from "./lingue/fr";
import de from "./lingue/de";
import es from "./lingue/es";
import nap from "./lingue/nap";
import type { Testi } from "./lingue/it";

export type { Testi };
export type Lang = "it" | "en" | "fr" | "de" | "es" | "nap";

/**
 * Il napoletano è parziale di proposito: ciò che non è tradotto ricade
 * sull'italiano. Per un dialetto è la ricaduta giusta — una frase non tradotta
 * resta comprensibile — e permette di riempirlo una riga alla volta.
 */
const napCompleto: Testi = { ...it, ...nap };

export const T: Record<Lang, Testi> = { it, en, fr, de, es, nap: napCompleto };

// ─── L'elenco per il selettore ───────────────────────────────────────────────

/**
 * `etichetta` è nella lingua stessa: chi cerca il tedesco cerca "Deutsch", non
 * "Tedesco" — e chi si ritrova l'app in una lingua che non capisce riconosce
 * solo l'endonimo.
 */
export const LINGUE: { id: Lang; etichetta: string; bandiera: string }[] = [
  { id: "it",  etichetta: "Italiano",   bandiera: "🇮🇹" },
  { id: "en",  etichetta: "English",    bandiera: "🇬🇧" },
  { id: "fr",  etichetta: "Français",   bandiera: "🇫🇷" },
  { id: "de",  etichetta: "Deutsch",    bandiera: "🇩🇪" },
  { id: "es",  etichetta: "Español",    bandiera: "🇪🇸" },
  { id: "nap", etichetta: "Napulitano", bandiera: "🍕" },
];

// ─── Preferenza salvata ──────────────────────────────────────────────────────

const CHIAVE_LINGUA = "einaudiplus.lingua";

/**
 * La lingua da usare all'avvio.
 *
 * Prima quella scelta a mano, poi quella del browser se la conosciamo, poi
 * l'italiano. Il napoletano non si prende mai dal browser — non ha un codice
 * che un browser mandi — quindi ci si arriva solo scegliendolo.
 */
export function linguaIniziale(): Lang {
  try {
    const salvata = localStorage.getItem(CHIAVE_LINGUA) as Lang | null;
    if (salvata && T[salvata]) return salvata;
  } catch { /* modalità privata: si continua col rilevamento */ }

  const dal = (navigator.language || "it").slice(0, 2).toLowerCase();
  return (["it", "en", "fr", "de", "es"] as const).find((l) => l === dal) ?? "it";
}

export function salvaLingua(l: Lang) {
  try { localStorage.setItem(CHIAVE_LINGUA, l); } catch { /* niente da fare */ }
}

// ─── Scorciatoie ─────────────────────────────────────────────────────────────

export const fmtTime = (d: Date, lang: Lang) => T[lang].fmtTime(d);
export const fmtDay  = (d: Date, lang: Lang) => T[lang].fmtDay(d);

/**
 * Traduce un errore del server in una frase leggibile.
 *
 * Il server manda stringhe fisse ("occupata", "altra lavanderia") proprio
 * perché vengano riconosciute qui: sono un protocollo, non un messaggio. Non
 * cambiarle di là senza cambiarle anche di qua.
 */
export function errMsg(e: any, lang: Lang) {
  const t = T[lang];
  const msg = String(e?.message ?? e ?? "");
  if (msg.includes("occupata") || msg.toLowerCase().includes("taken")) return t.taken(e?.by);
  if (msg.includes("altra lavanderia")) return t.altraLavanderia;
  if (msg.includes("riservata alla direzione")) return t.soloDirezione;
  return t.genericError;
}
