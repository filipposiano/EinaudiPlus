// Hook condivisi fra la shell dell'app (LoginScreen, DesktopSidebar) e le
// feature (es. BookModal in features/laundry): non appartengono a una sola,
// quindi vivono qui invece che dentro una cartella feature.

import { useState, useEffect, useRef } from "react";

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );
  useEffect(() => {
    const m = window.matchMedia(query);
    const handler = () => setMatches(m.matches);
    handler();
    m.addEventListener("change", handler);
    return () => m.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

// I tasti accettati, gli stessi disegnati a schermo. Costante di modulo e non
// letterale dentro il componente: una regex scritta nel corpo e' un oggetto
// NUOVO a ogni render, quindi finirebbe per staccare e riattaccare
// l'ascoltatore in continuazione — ed e' cosi' che una tastiera "a volte non
// risponde".
export const TASTI_CAMERA = /^[0-9abAB-]$/;

/**
 * Rende un tastierino su schermo digitabile anche da tastiera vera.
 *
 * Sta in un hook perché i tastierini sono due — quello della schermata camera e
 * quello dentro il modale di prenotazione — e prima solo il primo rispondeva
 * alla tastiera. Chi da computer arrivava a "per qualcun altro" si ritrovava a
 * dover tornare al mouse a metà operazione, senza capire perché lì non
 * funzionasse più.
 *
 * L'ascoltatore sta sulla finestra perché in nessuno dei due c'è un campo da
 * mettere a fuoco: le cifre le raccolgono i pulsanti disegnati. `attivo` lo
 * monta e lo smonta insieme al tastierino, così quando il modale è chiuso —
 * o quando sopra c'è il foglio di accesso amministratore — i tasti non li
 * intercetta nessuno.
 *
 * @param max  quante cifre accetta (6 per la camera, 4 nel modale)
 */
export function useTastieraFisica(
  attivo: boolean,
  set: React.Dispatch<React.SetStateAction<string>>,
  onInvio: () => void,
  max: number,
  ammessi: RegExp,
) {
  // In un ref, non fra le dipendenze: `onInvio` è una funzione nuova a ogni
  // render, e usarla come dipendenza staccherebbe e riattaccherebbe
  // l'ascoltatore in continuazione.
  const invio = useRef(onInvio);
  invio.current = onInvio;

  useEffect(() => {
    if (!attivo) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;   // scorciatoie del browser

      // Se si sta scrivendo in un campo, i tasti sono suoi e basta. Senza
      // questo, ogni cifra della password di accesso finiva ANCHE nella
      // casella della camera e preventDefault ne rubava una parte all'input:
      // la password si poteva solo incollare.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
                t.tagName === "SELECT" || t.isContentEditable)) return;

      if (e.key === "Enter")     { e.preventDefault(); invio.current(); return; }
      if (e.key === "Backspace") { e.preventDefault(); set((r) => r.slice(0, -1)); return; }
      if (e.key === "Escape")    { set(""); return; }
      if (ammessi.test(e.key))   { e.preventDefault(); set((r) => (r.length < max ? r + e.key : r)); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attivo, set, max, ammessi]);
}
