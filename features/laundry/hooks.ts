import { useEffect } from "react";

/**
 * Invio conferma.
 *
 * Da telefono non serve a niente, da PC e' il gesto naturale: si arriva alla
 * schermata di conferma, si legge, si preme Invio. Non succedeva niente, e il
 * pulsante rosso li' davanti sembrava rotto.
 *
 * `attivo` esiste perche' vada SOLO dove c'e' una cosa sola da confermare:
 * dove i pulsanti sono due o piu' (scegli la lavatrice, modifica o elimina)
 * Invio dovrebbe indovinare quale, e indovinare non e' un'opzione.
 *
 * Non intercetta l'Invio dentro un campo di testo lungo, dove va a capo.
 */
export function useInvio(attivo: boolean, azione: () => void) {
  useEffect(() => {
    if (!attivo) return;
    const onTasto = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat) return;
      const dove = e.target as HTMLElement | null;
      if (dove && (dove.tagName === "TEXTAREA" || dove.isContentEditable)) return;
      e.preventDefault();
      azione();
    };
    window.addEventListener("keydown", onTasto);
    return () => window.removeEventListener("keydown", onTasto);
  }, [attivo, azione]);
}
