// Superficie pubblica del modulo Grigliata — l'UNICO file che un altro
// modulo o un adapter in api/ può importare.
//
// Dominio coperto: far partire una grigliata (delegato/sistemista), aderire
// e dichiarare il pagamento (residenti, pubblico), confermare i pagamenti e
// chiudere l'evento (delegato/sistemista).
//
// Dipende da Notifications solo per avvisare una camera (notifyRoom) quando
// un pagamento viene confermato — stessa dipendenza cross-modulo già vista
// fra Bikes e Notifications: Grigliata non sa nulla di push/Telegram.

import { grigliataRepository } from "./infrastructure/grigliataRepository.js";
import { notifyRoom as notifyRoomChannel } from "../notifications/index.js";

import { getStatoPubblico as _getStatoPubblico } from "./application/getStatoPubblico.js";
import { iscriviti as _iscriviti } from "./application/iscriviti.js";
import { dichiaraPagamento as _dichiaraPagamento } from "./application/dichiaraPagamento.js";
import { adminCreaEvento as _adminCreaEvento } from "./application/adminCreaEvento.js";
import { adminOverview as _adminOverview } from "./application/adminOverview.js";
import { adminConfermaPagamento as _adminConfermaPagamento } from "./application/adminConfermaPagamento.js";
import { adminChiudiEvento as _adminChiudiEvento } from "./application/adminChiudiEvento.js";
import { adminModificaEvento as _adminModificaEvento } from "./application/adminModificaEvento.js";
import { adminAggiungiAdesione as _adminAggiungiAdesione } from "./application/adminAggiungiAdesione.js";
import { adminRimuoviAdesione as _adminRimuoviAdesione } from "./application/adminRimuoviAdesione.js";
import { adminRiapriEvento as _adminRiapriEvento } from "./application/adminRiapriEvento.js";
import { adminEliminaEvento as _adminEliminaEvento } from "./application/adminEliminaEvento.js";

export { authorize } from "./domain/policy.js";
export { controllaMenu, MENU_MAX, MENU_NOME_MAX } from "./domain/validazione.js";

const deps = { grigliataRepository, notifyRoom: notifyRoomChannel };

// ── Percorso pubblico (residenti, camera autodichiarata) ─────────────────────

export async function getStatoPubblico(room) {
  return _getStatoPubblico({ room }, deps);
}

export async function iscriviti(room, menuId, dieta, senzaGlutine, note) {
  return _iscriviti({ room, menuId, dieta, senzaGlutine, note }, deps);
}

export async function dichiaraPagamento(room) {
  return _dichiaraPagamento({ room }, deps);
}

// ── Percorso amministrativo (delegato/sistemista) ────────────────────────────

export async function adminCreaEvento(input) {
  return _adminCreaEvento(input, deps);
}

export async function adminOverview() {
  return _adminOverview({}, deps);
}

export async function adminConfermaPagamento(adesioneId, attore) {
  return _adminConfermaPagamento({ adesioneId, attore }, deps);
}

export async function adminChiudiEvento(eventoId) {
  return _adminChiudiEvento({ eventoId }, deps);
}

export async function adminModificaEvento(eventoId, titolo, scadenza, menu) {
  return _adminModificaEvento({ eventoId, titolo, scadenza, menu }, deps);
}

export async function adminAggiungiAdesione(eventoId, room, menuId, dieta) {
  return _adminAggiungiAdesione({ eventoId, room, menuId, dieta }, deps);
}

export async function adminRimuoviAdesione(adesioneId) {
  return _adminRimuoviAdesione({ adesioneId }, deps);
}

export async function adminRiapriEvento(eventoId) {
  return _adminRiapriEvento({ eventoId }, deps);
}

export async function adminEliminaEvento(eventoId) {
  return _adminEliminaEvento({ eventoId }, deps);
}
