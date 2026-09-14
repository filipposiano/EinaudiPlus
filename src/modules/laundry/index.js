// Superficie pubblica del modulo Laundry — l'UNICO file che un altro modulo
// o un adapter in api/ può importare (vedi identity/index.js per lo stesso
// principio, applicato per primo).
//
// Dominio coperto: prenotazione turni, stato macchine, regole ricorrenti
// PROPRIE della lavanderia. NON coperto (deliberatamente, per ora): bici,
// segnalazioni e iscrizioni push — nel codice attuale vivono dentro
// api/laundry.js "perché è l'unico endpoint pubblico già legato a una
// camera" (ammissione esplicita nel commento originale), non perché siano
// affari della lavanderia. Restano dove sono finché non nascono i moduli
// bikes/feedback/notifications. Nemmeno recurringList/SetActive/Delete/
// applyRecurring: sono un concetto trasversale (valgono per lavanderia E
// sale insieme) che appartiene a un futuro modulo "ops".

import { laundryRepository } from "./infrastructure/laundryRepository.js";
import { getSnapshot as _getSnapshot } from "./application/getSnapshot.js";
import { bookSlot as _bookSlot } from "./application/bookSlot.js";
import { clearSlot as _clearSlot } from "./application/clearSlot.js";
import { adminWeek as _adminWeek } from "./application/adminWeek.js";
import { adminSetMachineStatus as _adminSetMachineStatus } from "./application/adminSetMachineStatus.js";
import { adminDeleteBooking as _adminDeleteBooking } from "./application/adminDeleteBooking.js";
import { adminForceBook as _adminForceBook } from "./application/adminForceBook.js";
import { adminBookAsDirezione as _adminBookAsDirezione } from "./application/adminBookAsDirezione.js";
import { adminClearAsDirezione as _adminClearAsDirezione } from "./application/adminClearAsDirezione.js";
import { adminAddRecurringRule as _adminAddRecurringRule } from "./application/adminAddRecurringRule.js";

export { authorize } from "./domain/policy.js";
export { DAY_MIN, DAY_MAX, SLOT_MIN, SLOT_MAX } from "./domain/slots.js";

// Le dipendenze reali (repository su Supabase) sono cablate qui una volta
// sola. I test invece chiamano gli use-case in application/ direttamente,
// iniettando un repository finto — questo file serve all'adapter HTTP.
const deps = { laundryRepository };

export async function getSnapshot(room) {
  return _getSnapshot({ room }, deps);
}

export async function bookSlot(input) {
  return _bookSlot(input, deps);
}

export async function clearSlot(input) {
  return _clearSlot(input, deps);
}

export async function adminWeek(input) {
  return _adminWeek(input, deps);
}

export async function adminSetMachineStatus(input) {
  return _adminSetMachineStatus(input, deps);
}

export async function adminDeleteBooking(input) {
  return _adminDeleteBooking(input, deps);
}

export async function adminForceBook(input) {
  return _adminForceBook(input, deps);
}

export async function adminBookAsDirezione(input) {
  return _adminBookAsDirezione(input, deps);
}

export async function adminClearAsDirezione(input) {
  return _adminClearAsDirezione(input, deps);
}

export async function adminAddRecurringRule(input) {
  return _adminAddRecurringRule(input, deps);
}
