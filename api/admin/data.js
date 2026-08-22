// Operazioni del pannello amministrativo.
//
// Ogni azione passa da currentAdmin(): senza cookie valido si esce con 401
// prima di toccare il database.

import { rpc } from "../_lib/db.js";
import { readBody, json, fail, methodOk, intero } from "../_lib/http.js";
import { currentAdmin, isSysadmin, isStaff, hashPassword, verifyPassword } from "../_lib/auth.js";

// Le azioni che modificano qualcosa finiscono nell'audit log. Le letture no,
// sarebbero solo rumore.
const MUTATIONS = new Set([
  "setMachineStatus", "deleteBooking", "forceBook",
  "markFeedback", "deleteSpaceBooking",
  "recurringAddLaundry", "recurringAddSpace", "recurringSetActive",
  "recurringDelete", "applyRecurring", "purge",
  "bookDirezione", "bookSpaceDirezione", "clearDirezione",
  "conferenzaAdd", "conferenzaDelete",
  "accountCreate", "accountSetPassword", "accountSetActive", "accountDelete",
  "accountChangeOwnPassword",
]);

// Riservate al sistemista. La portineria non le vede nel pannello, ma il
// controllo sta qui: nascondere un pulsante non e' un'autorizzazione.
const SOLO_SISTEMISTA = new Set([
  "recurringList", "recurringAddLaundry", "recurringAddSpace",
  "recurringSetActive", "recurringDelete", "applyRecurring", "purge",
  "accountList", "accountCreate", "accountSetPassword",
  "accountSetActive", "accountDelete",
]);

// Macchine e segnalazioni restano affari di FDO e sistemista: lo staff
// prenota e libera turni per conto della Direzione come l'FDO, ma non deve
// vedere ne' toccare lo stato guasto/funzionante delle macchine ne' le
// segnalazioni dei residenti.
const VIETATE_A_STAFF = new Set([
  "overview", "setMachineStatus", "feedback", "markFeedback",
]);

export default async function handler(req, res) {
  if (!methodOk(req, res, ["POST"])) return;

  // Header applicativo, contro il CSRF.
  //
  // Un modulo HTML da un altro sito puo' fare POST qui portandosi dietro i
  // cookie, ma NON puo' impostare un header inventato: servirebbe fetch/XHR, e
  // li' scatta il preflight CORS che questa API non concede. Un header custom
  // e' quindi una prova che la richiesta viene dal nostro codice.
  //
  // La difesa vera resta SameSite=Strict sul cookie di sessione, che da sola
  // basterebbe. Ma il client questo header lo mandava GIA' — api.ts e
  // AdminPanel.tsx — e nessuno lo guardava: sembrava una protezione e non lo
  // era. O si verifica o si toglie; verificarlo costa tre righe.
  if (req.headers["x-requested-with"] !== "admin") {
    return json(res, 400, { ok: false, error: "richiesta non riconosciuta" });
  }

  const me = currentAdmin(req);
  if (!me) return json(res, 401, { ok: false, error: "non autenticato" });

  const body = readBody(req);
  const action = String(body.action || "");

  if (SOLO_SISTEMISTA.has(action) && !isSysadmin(me)) {
    return json(res, 403, { ok: false, error: "riservato al sistemista" });
  }

  if (VIETATE_A_STAFF.has(action) && isStaff(me)) {
    return json(res, 403, { ok: false, error: "riservato a FDO e sistemista" });
  }

  // I campi numerici si controllano tutti qui, una volta, invece che a ogni
  // `Number(body.x)` sparso nello switch. `Number("pippo")` da' NaN, che
  // diventa `null` una volta serializzato: le guardie SQL (`not between`) su
  // NULL valgono NULL, quindi non scattano, e si finisce contro un vincolo
  // NOT NULL con un 500 addosso. Chi usa il pannello vedeva "errore del
  // server" per un campo lasciato vuoto.
  //
  // Il controllo e' "se c'e', dev'essere valido": i campi assenti restano tali
  // e ogni azione usa solo i propri.
  const LIMITI = {
    id: [1, Number.MAX_SAFE_INTEGER], laundry_id: [1, 9], space_id: [1, 9],
    day: [0, 6], slot: [0, 18], offset: [-52, 52], limit: [1, 500],
    start: [0, 1439], end: [1, 2880],
    giorno: [0, 6],   // sala conferenze: giorno della settimana della regola
  };
  for (const [campo, [min, max]] of Object.entries(LIMITI)) {
    if (body[campo] === undefined || body[campo] === null) continue;
    if (intero(body[campo], min, max) === null) {
      return json(res, 400, { ok: false, error: `campo "${campo}" non valido` });
    }
  }

  // Il log non dipende dal risultato dell'azione (usa solo i parametri della
  // richiesta, gia' qui disponibili): prima partiva DOPO l'azione principale
  // e la aspettava prima di rispondere, cioe' due andate e ritorni verso
  // Supabase in fila invece che uno solo — il pannello sembrava lento
  // proprio sulle scritture (aggiungere un incontro alla sala polivalente,
  // creare un account, ...). Partendo insieme costano quanto il piu' lento
  // dei due, non la somma. Le password non finiscono mai nel log, nemmeno
  // hashate: un filtro sul nome del campo resta valido anche se in futuro se
  // ne aggiunge un'altra ("password", "password_attuale", "password_nuova").
  const logPromise = MUTATIONS.has(action)
    ? rpc("admin_log", {
        p_actor: me.u, p_action: action,
        p_detail: Object.fromEntries(
          Object.entries(body).filter(([k]) => k !== "action" && !k.toLowerCase().includes("password"))
        ),
      }).catch(() => { /* il log non deve far fallire l'operazione */ })
    : null;

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

      // ── Azioni a nome della DIREZIONE, usate dall'app principale ─────────
      case "bookDirezione":
        result = await rpc("book_as_direzione", {
          p_laundry_id: Number(body.laundry_id),
          p_day: Number(body.day),
          p_slot: Number(body.slot),
          p_machine: String(body.machine || ""),
        });
        break;

      case "bookSpaceDirezione":
        result = await rpc("book_space_as_direzione", {
          p_slug: String(body.space || ""),
          p_day: Number(body.day),
          p_start: Number(body.start),
          p_end: Number(body.end),
          p_type: body.type ? String(body.type) : null,
        });
        break;

      // Liberare un turno, compresi quelli della DIREZIONE che dal percorso
      // pubblico sono protetti. `p_as_admin: true` si può scrivere qui e solo
      // qui: currentAdmin() ha già verificato il cookie in cima all'handler.
      case "clearDirezione":
        result = await rpc("clear_laundry", {
          p_room: String(body.room || ""),
          p_day: Number(body.day),
          p_slot: Number(body.slot),
          p_machine: String(body.machine || ""),
          p_as_admin: true,
        });
        break;

      // ── Sala conferenze ─────────────────────────────────────────────────
      // La programmano solo gli amministratori: i residenti la leggono da
      // /api/conferenze, che di scrivere non sa proprio.
      case "conferenzaList":
        result = await rpc("conference_rules");
        break;

      case "conferenzaAdd":
        result = await rpc("conference_add", {
          p_titolo: String(body.titolo || ""),
          p_ora_inizio: String(body.inizio || ""),
          p_ora_fine: String(body.fine || ""),
          p_dal: String(body.dal || ""),
          p_al: String(body.al || ""),
          // null = ogni giorno del periodo, per un convegno di più giorni
          // consecutivi; un numero = solo quel giorno della settimana.
          p_giorno_settimana: body.giorno === null || body.giorno === undefined || body.giorno === ""
            ? null : Number(body.giorno),
          p_note: body.note ? String(body.note) : null,
          p_attore: me.u,
        });
        break;

      case "conferenzaDelete":
        result = await rpc("conference_delete", { p_id: Number(body.id) });
        break;

      // ── Sistemista: account amministrativi ───────────────────────────────
      // Prima c'erano solo le tre variabili d'ambiente su Vercel; ora il
      // sistemista crea, disattiva e reimposta gli account da qui. Le
      // password non toccano mai il database in chiaro: si cifrano subito,
      // esattamente come per gli account storici.
      case "accountList":
        result = await rpc("account_list");
        break;

      case "accountCreate": {
        const password = String(body.password || "");
        if (password.length < 8) return fail(res, "la password deve avere almeno 8 caratteri");
        result = await rpc("account_create", {
          p_username: String(body.username || "").trim(),
          p_password_hash: hashPassword(password),
          p_ruolo: String(body.ruolo || ""),
          p_attore: me.u,
        });
        break;
      }

      case "accountSetPassword": {
        const password = String(body.password || "");
        if (password.length < 8) return fail(res, "la password deve avere almeno 8 caratteri");
        result = await rpc("account_set_password", {
          p_id: Number(body.id),
          p_password_hash: hashPassword(password),
        });
        break;
      }

      case "accountSetActive":
        result = await rpc("account_set_active", {
          p_id: Number(body.id), p_attivo: body.attivo !== false,
        });
        break;

      case "accountDelete":
        result = await rpc("account_delete", { p_id: Number(body.id) });
        break;

      // Cambio password fatto dal titolare per se' stesso: nessuna sessione
      // sistemista richiesta, ma serve la password attuale (quella data
      // dall'admin alla creazione o al reset) per dimostrare di essere lui.
      // Non si applica agli account storici via env var: quelli non hanno
      // una riga da aggiornare, e lo si dice chiaro invece di un generico
      // "account non trovato".
      case "accountChangeOwnPassword": {
        const attuale = String(body.password_attuale || "");
        const nuova = String(body.password_nuova || "");
        if (nuova.length < 8) return fail(res, "la nuova password deve avere almeno 8 caratteri");
        const row = await rpc("account_by_username", { p_username: me.u });
        if (!row?.id) return fail(res, "questo account non gestisce la password da qui: è configurato su Vercel");
        if (!verifyPassword(attuale, row.password_hash)) return fail(res, "password attuale non corretta");
        result = await rpc("account_set_own_password", {
          p_username: me.u,
          p_password_hash: hashPassword(nuova),
        });
        break;
      }

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

    if (logPromise) await logPromise;

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
