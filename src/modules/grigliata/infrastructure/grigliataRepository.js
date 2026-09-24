// Adapter verso le funzioni SQL della grigliata (via PostgREST).
// Nessuna logica qui dentro — stesso principio di ogni altro repository.

import { rpc } from "../../../shared/db/rpcClient.js";

export const grigliataRepository = {
  /** Percorso pubblico: cosa vede un residente (evento attivo + la propria adesione, se c'è). */
  async statoPubblico(room) {
    return rpc("grigliata_stato_pubblico", { p_room: room || null });
  },

  /** Percorso pubblico: aderisce, con un menu — vedi la nota in application/iscriviti.js. */
  async iscrivi({ room, menu, senzaGlutine, note }) {
    return rpc("grigliata_iscrivi", {
      p_room: room, p_menu: menu, p_senza_glutine: senzaGlutine, p_note: note,
    });
  },

  /** Percorso pubblico: "ho pagato". */
  async dichiaraPagamento(room) {
    return rpc("grigliata_dichiara_pagamento", { p_room: room });
  },

  /** Admin (delegato/sistemista): fa partire una nuova grigliata. */
  async adminCrea({ titolo, scadenza, paypal, satispay, attore }) {
    return rpc("grigliata_admin_crea", {
      p_titolo: titolo, p_scadenza: scadenza, p_paypal: paypal, p_satispay: satispay, p_attore: attore,
    });
  },

  /** Admin: l'evento più recente (attivo o l'ultimo chiuso) + tutte le adesioni. */
  async adminOverview() {
    return rpc("grigliata_admin_overview");
  },

  /** Admin: conferma il pagamento di una singola adesione. */
  async adminConfermaPagamento({ id, attore }) {
    return rpc("grigliata_admin_conferma_pagamento", { p_adesione_id: id, p_attore: attore });
  },

  /** Admin: chiude un evento a mano, prima della scadenza naturale. */
  async adminChiudi(id) {
    return rpc("grigliata_admin_chiudi", { p_evento_id: id });
  },

  /** Admin: cambia titolo e scadenza di un evento esistente, senza toccare altro. */
  async adminModifica({ id, titolo, scadenza }) {
    return rpc("grigliata_admin_modifica", { p_evento_id: id, p_titolo: titolo, p_scadenza: scadenza });
  },

  /** Admin: aggiunge (o corregge) a mano l'adesione di una camera. */
  async adminAggiungiAdesione({ eventoId, room, menu }) {
    return rpc("grigliata_admin_aggiungi_adesione", { p_evento_id: eventoId, p_room: room, p_menu: menu });
  },

  /** Admin: toglie un'adesione — la camera torna come se non avesse mai risposto. */
  async adminRimuoviAdesione(id) {
    return rpc("grigliata_admin_rimuovi_adesione", { p_adesione_id: id });
  },

  /** Admin: riapre un evento chiuso (chiude prima qualunque altro ancora attivo). */
  async adminRiapri(id) {
    return rpc("grigliata_admin_riapri", { p_evento_id: id });
  },

  /** Admin: elimina un evento già chiuso, e le sue adesioni per cascata. */
  async adminElimina(id) {
    return rpc("grigliata_admin_elimina", { p_evento_id: id });
  },
};
