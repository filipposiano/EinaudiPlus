// Use-case: iscrizione push pubblica (dalle Impostazioni dell'app).

import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";
import { endpointAllowed } from "../domain/channels.js";

export async function subscribePush({ room, endpoint, p256dh, auth }, { notificationsRepository }) {
  if (!endpointAllowed(endpoint)) throw new ValidationError("endpoint di notifica non riconosciuto");

  // La DIREZIONE non è una camera vera (niente cifre: parseRoomNumber la
  // respinge), ma prenota per davvero e i suoi turni scadono come tutti gli
  // altri — chi la usa da portineria deve poter ricevere i promemoria
  // esattamente come un residente.
  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom && room !== "DIREZIONE") throw new ValidationError("camera non valida");

  return notificationsRepository.upsertPushSub({
    room: parsedRoom || room,
    endpoint,
    p256dh: String(p256dh || ""),
    auth: String(auth || ""),
  });
}
