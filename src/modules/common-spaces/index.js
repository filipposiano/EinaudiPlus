// Superficie pubblica del modulo Common Spaces (cinema, sala musica) —
// l'UNICO file che un altro modulo o un adapter in api/ può importare.
//
// Dominio coperto: prenotazione/cancellazione pubblica, panoramica e
// override amministrativi per le sale comuni. NON coperto (deliberatamente):
// recurringList/SetActive/Delete/applyRecurring (concetto trasversale a
// lavanderia e sale, rimandato a un futuro modulo "ops") e la sala
// conferenze, che è un dominio a sé (conference-room), non ancora scaffoldato.

import { commonSpacesRepository } from "./infrastructure/commonSpacesRepository.js";
import { getBookings as _getBookings } from "./application/getBookings.js";
import { bookSpace as _bookSpace } from "./application/bookSpace.js";
import { clearBooking as _clearBooking } from "./application/clearBooking.js";
import { adminGetSpacesOverview as _adminGetSpacesOverview } from "./application/adminGetSpacesOverview.js";
import { adminDeleteSpaceBooking as _adminDeleteSpaceBooking } from "./application/adminDeleteSpaceBooking.js";
import { adminBookAsDirezione as _adminBookAsDirezione } from "./application/adminBookAsDirezione.js";
import { adminAddRecurringRule as _adminAddRecurringRule } from "./application/adminAddRecurringRule.js";
import { adminSetSpaceChiuso as _adminSetSpaceChiuso } from "./application/adminSetSpaceChiuso.js";

export { authorize } from "./domain/policy.js";
export { SPACES, isValidSpace } from "./domain/spaces.js";

const deps = { commonSpacesRepository };

export async function getBookings(space) {
  return _getBookings({ space }, deps);
}

export async function bookSpace(input) {
  return _bookSpace(input, deps);
}

export async function clearBooking(input) {
  return _clearBooking(input, deps);
}

export async function adminGetSpacesOverview() {
  return _adminGetSpacesOverview({}, deps);
}

export async function adminDeleteSpaceBooking(input) {
  return _adminDeleteSpaceBooking(input, deps);
}

export async function adminBookAsDirezione(input) {
  return _adminBookAsDirezione(input, deps);
}

export async function adminAddRecurringRule(input) {
  return _adminAddRecurringRule(input, deps);
}

export async function adminSetSpaceChiuso(input) {
  return _adminSetSpaceChiuso(input, deps);
}
