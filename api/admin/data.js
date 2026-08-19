// Operazioni del pannello amministrativo.
//
// Ogni azione passa da currentAdmin(): senza cookie valido si esce con 401
// prima di toccare il database.

import { rpc } from "../_lib/db.js";
import { readBody, json, fail, methodOk } from "../_lib/http.js";
import { currentAdmin } from "../_lib/auth.js";

// Le azioni che modificano qualcosa finiscono nell'audit log. Le letture no,
// sarebbero solo rumore.
const MUTATIONS = new Set([
  "setMachineStatus", "deleteBooking", "forceBook",
  "markFeedback", "deleteSpaceBooking",
]);

export default async function handler(req, res) {
  if (!methodOk(req, res, ["POST"])) return;

  const me = currentAdmin(req);
  if (!me) return json(res, 401, { ok: false, error: "non autenticato" });

  const body = readBody(req);
  const action = String(body.action || "");

  try {
    let result;

    switch (action) {
      // ── Letture ──────────────────────────────────────────────────────────
      case "overview":
        result = await rpc("admin_overview");
        break;

      case "week":
        result = await rpc("admin_week", {
          p_laundry_id: Number(body.laundry_id),
          p_offset: Number(body.offset || 0),
        });
        break;

      case "feedback":
        result = await rpc("admin_feedback", {
          p_only_open: body.only_open !== false,
          p_limit: Math.min(Number(body.limit || 100), 500),
        });
        break;

      case "spaces":
        result = await rpc("admin_spaces");
        break;

      // ── Scritture ────────────────────────────────────────────────────────
      case "setMachineStatus":
        // Il fuori servizio rende lo stato visibile a tutti, ma NON blocca le
        // prenotazioni: chi prenota vede un avviso e decide.
        result = await rpc("set_machine_status", {
          p_room: String(body.room || ""),
          p_machine: String(body.machine || ""),
          p_oos: Boolean(body.oos),
        });
        break;

      case "deleteBooking":
        result = await rpc("admin_delete_booking", { p_id: Number(body.id) });
        break;

      case "forceBook":
        result = await rpc("admin_force_book", {
          p_laundry_id: Number(body.laundry_id),
          p_day: Number(body.day),
          p_slot: Number(body.slot),
          p_machine: String(body.machine || ""),
          p_room: String(body.room || ""),
        });
        break;

      case "markFeedback":
        result = await rpc("admin_mark_feedback", {
          p_id: Number(body.id),
          p_handled: body.handled !== false,
        });
        break;

      case "deleteSpaceBooking":
        result = await rpc("admin_delete_space_booking", { p_id: Number(body.id) });
        break;

      default:
        return fail(res, "azione sconosciuta");
    }

    if (MUTATIONS.has(action)) {
      const { action: _drop, ...detail } = body;
      try {
        await rpc("admin_log", { p_actor: me.u, p_action: action, p_detail: detail });
      } catch { /* il log non deve far fallire l'operazione */ }
    }

    return json(res, 200, result);
  } catch (err) {
    console.error("[admin]", err.rpc || "", err.message);
    return fail(res, "errore del server", {}, 500);
  }
}
