// Policy di autorizzazione del modulo Bikes.
//
// Lettura: FDO e sistemista, non staff. Cancellazione totale (reset
// annuale) e assegnazione/rimozione per camera: solo sistemista.

import { isSysadmin, isStaff } from "../../identity/index.js";

const AZIONI_BIKES = new Set(["biciList", "biciPurge", "biciDeleteRoom", "biciAddRoom"]);
const SOLO_SISTEMISTA = new Set(["biciPurge", "biciDeleteRoom", "biciAddRoom"]);
const VIETATE_A_STAFF = new Set(["biciList"]);

export function authorize(claims, action) {
  if (!AZIONI_BIKES.has(action)) return null;
  if (!claims) return false;
  if (SOLO_SISTEMISTA.has(action)) return isSysadmin(claims);
  if (VIETATE_A_STAFF.has(action) && isStaff(claims)) return false;
  return true;
}
