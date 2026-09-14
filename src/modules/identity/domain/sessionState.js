// Una sessione firmata resta valida per 12 ore, ma l'account a cui appartiene
// può cambiare stato nel frattempo. Questa è la regola che dice quando un
// cookie ancora tecnicamente valido non vale più.
//
// Vive nel dominio e non nei due adapter che la usano (api/admin/auth.js per
// rispondere "non loggato", api/admin/data.js per rifiutare l'azione) perché
// è una decisione sola: se le due copie divergessero, il pannello direbbe una
// cosa e il server ne farebbe un'altra.

/**
 * La sessione è ancora spendibile, vista la riga dell'account?
 *
 * @param {object|null|undefined} row la riga di `admin_account`, o null/undefined
 *   se l'account non esiste più
 * @returns {boolean} false se l'account è stato eliminato o disattivato
 *
 * `attivo === false` e non `!attivo`: una riga senza quel campo (una lettura
 * parziale, una colonna aggiunta domani) non deve far sloggiare nessuno —
 * si nega solo davanti a un "no" esplicito del database.
 */
export function sessioneAncoraValida(row) {
  if (!row?.id) return false;         // account eliminato
  return row.attivo !== false;        // account disattivato
}
