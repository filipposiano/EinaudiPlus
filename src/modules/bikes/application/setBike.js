import { ValidationError } from "../../../shared/errors/AppError.js";
import { parseRoomNumber } from "../../../shared/validation/room.js";

export async function setBike({ room, hasBike }, { bikeRepository }) {
  const parsedRoom = parseRoomNumber(room);
  if (!parsedRoom) throw new ValidationError("camera non valida");
  return bikeRepository.set(parsedRoom, Boolean(hasBike));
}
