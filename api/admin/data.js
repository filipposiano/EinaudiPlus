// Operazioni del pannello amministrativo.
//
// Ogni azione passa da currentAdmin(): senza cookie valido si esce con 401
// prima di toccare il database.

import { rpc } from "../_lib/db.js";
import { readBody, json, fail, methodOk } from "../_lib/http.js";
import { currentAdmin, isSysadmin } from "../_lib/auth.js";

// Le azioni che modificano qualcosa finiscono nell'audit log. Le letture no,
// sarebbero solo rumore.
const MUTATIONS = new Set([
  "setMachineStatus", "deleteBooking", "forceBook",
  "markFeedback", "deleteSpaceBooking",
  "recurringAddLaundry", "recurringAddSpace", "recurringSetActive",
  "recurringDelete", "applyRecurring", "purge",
]);

// Riservate al sistemista. La portineria non le vede nel pannello, ma il
// controllo sta qui: nascondere un pulsante non e' un'autorizzazione.
const SOLO_SISTEMISTA = new Set([
  "recurringList", "recurringAddLaundry", "recurringAddSpace",
  "recurringSetActive", "recurringDelete", "applyRecurring", "purge",
]);

export default async function handler(req, res) {
  if (!methodOk(req, res, ["POST"])) return;

  const me = currentAdmin(req);
  if (!me) return json(res, 401, { ok: false, error: "non autenticato" });

  const body = readBody(req);
  const action = String(body.action || "");

  if (SOLO_SISTEMISTA.has(action) && !isSysadmin(me)) {
    return json(res, 403, { ok: false, error: "riservato al sistemista" });
  }

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

      // ── Sistemista: regole ricorrenti ────────────────────────────────────
      case "recurringList":
        result = await rpc("recurring_list");
        break;

      case "recurringAddLaundry":
        result = await rpc("recurring_add_laundry", {
          p_laundry_id: Number(body.laundry_id),
          p_day: Number(body.day),
          p_slot: Number(body.slot),
          p_machine: String(body.machine || ""),
          p_room: String(body.room || ""),
          p_note: body.note ? String(body.note) : null,
        });
        // Una regola creata a metà settimana si applica subito, altrimenti
        // resterebbe inerte fino al lunedì successivo.
        if (result?.ok) await rpc("apply_recurring", { p_offset: 0 });
        break;

      case "recurringAddSpace":
        result = await rpc("recurring_add_space", {
          p_space_id: Number(body.space_id),
          p_day: Number(body.day),
          p_start: Number(body.start),
          p_end: Number(body.end),
          p_name: String(body.name || ""),
          p_type: body.type ? String(body.type) : null,
          p_note: body.note ? String(body.note) : null,
        });
        if (result?.ok) await rpc("apply_recurring", { p_offset: 0 });
        break;

      case "recurringSetActive":
        result = await rpc("recurring_set_active", {
          p_id: Number(body.id), p_active: body.active !== false,
        });
        break;

      case "recurringDelete":
        // Toglie la regola, non le prenotazioni già create da essa: quelle
        // restano finché la settimana non finisce, e si cancellano a mano.
        result = await rpc("recurring_delete", { p_id: Number(body.id) });
        break;

      case "applyRecurring":
        result = await rpc("apply_recurring", { p_offset: Number(body.offset || 0) });
        break;

      // ── Sistemista: pulizia ──────────────────────────────────────────────
      case "purge":
        result = await rpc("sysadmin_purge", { p_scope: String(body.scope || "") });
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

    // Qui l'errore vero si restituisce, a differenza degli endpoint pubblici.
    //
    // Chi arriva a questo punto ha gia' superato l'autenticazione admin, quindi
    // non stiamo rivelando nulla a un estraneo. E il messaggio di PostgREST e'
    // quasi sempre gia' la diagnosi: "DELETE requires a WHERE clause" diceva
    // esattamente cosa fosse rotto, ma il generico "errore del server" lo
    // nascondeva e il pulsante sembrava semplicemente non funzionare.
    return fail(res, "errore del server: " + err.message, { rpc: err.rpc }, 500);
  }
}
