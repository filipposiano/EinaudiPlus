// Adapter verso le funzioni SQL della lavanderia (via PostgREST).
//
// Nessuna logica qui dentro, solo la traduzione fra il linguaggio del
// dominio e le funzioni RPC esistenti — è quello che rende gli use-case in
// application/ testabili con un repository finto, senza rete né database
// (vedi tests/unit/laundry.test.mjs).

import { rpc } from "../../../shared/db/rpcClient.js";

export const laundryRepository = {
  async snapshot(room) {
    return rpc("laundry_snapshot", { p_room: room || null });
  },

  async book({ room, day, slot, machine, actorRoom }) {
    return rpc("book_laundry", {
      p_room: room, p_day: day, p_slot: slot, p_machine: machine, p_actor_room: actorRoom,
    });
  },

  /** Percorso pubblico: `p_as_admin` non si manda mai da qui (default false in SQL). */
  async clear({ room, day, slot, machine }) {
    return rpc("clear_laundry", { p_room: room, p_day: day, p_slot: slot, p_machine: machine });
  },

  /** Percorso amministrativo: unico punto dove `p_as_admin: true` può comparire. */
  async clearAsAdmin({ room, day, slot, machine }) {
    return rpc("clear_laundry", {
      p_room: room, p_day: day, p_slot: slot, p_machine: machine, p_as_admin: true,
    });
  },

  async week({ laundryId, offset }) {
    return rpc("admin_week", { p_laundry_id: laundryId, p_offset: offset });
  },

  async setMachineStatus({ room, machine, oos }) {
    return rpc("set_machine_status", { p_room: room, p_machine: machine, p_oos: oos });
  },

  async deleteBooking({ id }) {
    return rpc("admin_delete_booking", { p_id: id });
  },

  async forceBook({ laundryId, day, slot, machine, room }) {
    return rpc("admin_force_book", {
      p_laundry_id: laundryId, p_day: day, p_slot: slot, p_machine: machine, p_room: room,
    });
  },

  async bookAsDirezione({ laundryId, day, slot, machine }) {
    return rpc("book_as_direzione", { p_laundry_id: laundryId, p_day: day, p_slot: slot, p_machine: machine });
  },

  async addRecurringRule({ laundryId, day, slot, machine, room, note }) {
    return rpc("recurring_add_laundry", {
      p_laundry_id: laundryId, p_day: day, p_slot: slot,
      p_machine: machine, p_room: room, p_note: note,
    });
  },
};
