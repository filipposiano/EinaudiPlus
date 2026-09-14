import { rpc } from "../../../shared/db/rpcClient.js";

export const bikeRepository = {
  async get(room) {
    return rpc("bike_get", { p_room: room });
  },
  async set(room, hasBike) {
    return rpc("bike_set", { p_room: room, p_has_bike: hasBike });
  },
  async adminList() {
    return rpc("bike_admin_list");
  },
  async purge() {
    return rpc("bike_purge");
  },
  async deleteRoom(room) {
    return rpc("bike_delete_room", { p_room: room });
  },
  async adminSet(room) {
    return rpc("bike_admin_set", { p_room: room });
  },
};
