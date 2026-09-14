// Superficie pubblica del modulo Bikes — l'UNICO file che un altro modulo o
// un adapter in api/ può importare.
//
// Dipende da Notifications solo per avvisare una camera (notifyRoom):
// Bikes non sa nulla di push/Telegram, tramite la superficie pubblica di
// quel modulo — la stessa dipendenza cross-modulo già vista fra Laundry e
// Identity (per isStaff/isSysadmin).

import { bikeRepository } from "./infrastructure/bikeRepository.js";
import { notifyRoom as notifyRoomChannel } from "../notifications/index.js";

import { getBike as _getBike } from "./application/getBike.js";
import { setBike as _setBike } from "./application/setBike.js";
import { adminListBikes as _adminListBikes } from "./application/adminListBikes.js";
import { adminPurgeBikes as _adminPurgeBikes } from "./application/adminPurgeBikes.js";
import { adminDeleteBikeRoom as _adminDeleteBikeRoom } from "./application/adminDeleteBikeRoom.js";
import { adminAddBikeRoom as _adminAddBikeRoom } from "./application/adminAddBikeRoom.js";

export { authorize } from "./domain/policy.js";

const deps = { bikeRepository, notifyRoom: notifyRoomChannel };

export async function getBike(room) {
  return _getBike({ room }, deps);
}

export async function setBike(room, hasBike) {
  return _setBike({ room, hasBike }, deps);
}

export async function adminListBikes() {
  return _adminListBikes({}, deps);
}

export async function adminPurgeBikes() {
  return _adminPurgeBikes({}, deps);
}

export async function adminDeleteBikeRoom(room) {
  return _adminDeleteBikeRoom({ room }, deps);
}

export async function adminAddBikeRoom(room) {
  return _adminAddBikeRoom({ room }, deps);
}
