// Operazioni del pannello amministrativo.
//
// Ogni azione passa da currentAdmin(): senza cookie valido si esce con 401
// prima di toccare il database.
//
// L'autorizzazione per-azione non vive più in due Set() centrali
// (SOLO_SISTEMISTA/VIETATE_A_STAFF) mantenuti a mano qui: ogni modulo
// possiede la policy delle proprie azioni tramite la propria authorize()
// (vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md, audit finding #3).
// Un'azione nuova non finisce esposta per dimenticanza: se il modulo che la
// possiede non decide la sua policy, authorizeAction() la lascia semplicemente
// non riconosciuta, e non è questo il file dove si decide se un'azione è
// permessa o no.
//
// Allo stesso motivo, la validazione dei campi numerici non passa più dal
// dizionario LIMITI condiviso fra domini migrati e non (audit finding #4):
// ogni modulo valida i propri (day/slot in Laundry, day/start/end in Common
// Spaces, giorno in Conference Room, id ovunque serva...).

import { readBody, json, fail, methodOk } from "../_lib/http.js";
import { logAdminAction } from "../../src/shared/audit/auditLog.js";
import { wrapHandler } from "../../src/shared/errors/wrapHandler.js";

import {
  currentAdmin, accountByUsername,
  authorize as identityAuthorize,
  listAccounts, createAccount, resetAccountPassword, setAccountActive, deleteAccount,
  changeOwnPassword,
} from "../../src/modules/identity/index.js";
import {
  authorize as laundryAuthorize,
  adminWeek, adminSetMachineStatus, adminDeleteBooking, adminForceBook,
  adminBookAsDirezione, adminClearAsDirezione, adminAddRecurringRule,
} from "../../src/modules/laundry/index.js";
import {
  authorize as commonSpacesAuthorize,
  adminGetSpacesOverview, adminDeleteSpaceBooking,
  adminBookAsDirezione as adminBookSpaceAsDirezione,
  adminAddRecurringRule as adminAddSpaceRecurringRule,
} from "../../src/modules/common-spaces/index.js";
import { authorize as themeAuthorize, getTheme, setTheme } from "../../src/modules/theme/index.js";
import {
  authorize as notificationsAuthorize,
  adminListPushSubs, adminDeletePushSub, adminListTelegramSubs, adminDeleteTelegramSub, adminBroadcast,
} from "../../src/modules/notifications/index.js";
import {
  authorize as bikesAuthorize,
  adminListBikes, adminPurgeBikes, adminDeleteBikeRoom, adminAddBikeRoom,
} from "../../src/modules/bikes/index.js";
import {
  authorize as feedbackAuthorize,
  adminListFeedback, adminMarkFeedback,
} from "../../src/modules/feedback/index.js";
import {
  authorize as conferenceAuthorize,
  listRules as conferenceListRules, addRule as conferenceAddRule, updateRule as conferenceUpdateRule,
  skipOccurrence as conferenceSkipOccurrence, moveOccurrence as conferenceMoveOccurrence,
  resetOccurrence as conferenceResetOccurrence, deleteRule as conferenceDeleteRule,
} from "../../src/modules/conference-room/index.js";
import {
  authorize as opsAuthorize,
  getOverview, listRecurringRules, setRecurringRuleActive, deleteRecurringRule,
  applyRecurringRules, purgeData, getCounts,
} from "../../src/modules/ops/index.js";

// Le azioni che modificano qualcosa finiscono nell'audit log. Le letture no,
// sarebbero solo rumore.
const MUTATIONS = new Set([
  "setMachineStatus", "deleteBooking", "forceBook",
  "markFeedback", "deleteSpaceBooking",
  "recurringAddLaundry", "recurringAddSpace", "recurringSetActive",
  "recurringDelete", "applyRecurring", "purge",
  "deletePushSub", "deleteTelegramSub", "broadcastPush",
  "bookDirezione", "bookSpaceDirezione", "clearDirezione",
  "conferenzaAdd", "conferenzaUpdate", "conferenzaDelete",
  "conferenzaSkip", "conferenzaMove", "conferenzaResetOccorrenza",
  "accountCreate", "accountSetPassword", "accountSetActive", "accountDelete",
  "accountChangeOwnPassword", "biciPurge", "biciDeleteRoom", "biciAddRoom", "temaSet",
]);

/**
 * Prova ogni modulo finché uno non riconosce l'azione come propria.
 * `false` = negato da chi possiede l'azione; `true` = concesso; `undefined`
 * = nessun modulo la reclama (l'azione probabilmente non esiste nemmeno —
 * lo scoprirà lo switch più sotto con "azione sconosciuta").
 */
function authorizeAction(me, action) {
  return identityAuthorize(me, action)
    ?? laundryAuthorize(me, action)
    ?? commonSpacesAuthorize(me, action)
    ?? themeAuthorize(me, action)
    ?? notificationsAuthorize(me, action)
    ?? bikesAuthorize(me, action)
    ?? feedbackAuthorize(me, action)
    ?? conferenceAuthorize(me, action)
    ?? opsAuthorize(me, action);
}

export default wrapHandler("admin/data", async (req, res) => {
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

  if (authorizeAction(me, action) === false) {
    return json(res, 403, { ok: false, error: "permesso negato" });
  }

  // Chi ha ancora la password provvisoria non puo' fare altro che cambiarla.
  //
  // Il pannello lo impedisce gia' con una schermata che sostituisce qualunque
  // scheda, ma quella e' una cortesia verso chi il pannello lo usa: `curl` o
  // la console del browser parlano a questo endpoint direttamente, e finivano
  // per lavorare benissimo. Il divieto sembrava esserci e non c'era —
  // verificato creando un account e facendogli fare un'azione senza cambiare
  // la password: 200, riuscita.
  //
  // Conta perche' la provvisoria e' la password piu' debole del sistema: la
  // detta un admin a voce o per messaggio, ed era proprio quella a restare
  // buona a tempo indeterminato per chi non apriva il pannello.
  if (action !== "accountChangeOwnPassword") {
    let deveCambiare = false;
    try {
      const row = await accountByUsername(me.u);
      deveCambiare = Boolean(row?.deve_cambiare_password);
    } catch {
      // Database muto: si lascia passare, ma non e' una falla — ogni azione
      // qui sotto finisce comunque sul database e fallira' da sola.
    }
    if (deveCambiare) {
      return json(res, 403, {
        ok: false,
        error: "cambia la password provvisoria prima di continuare",
        deve_cambiare_password: true,
      });
    }
  }

  let result;

  switch (action) {
    // ── Letture ──────────────────────────────────────────────────────────
    case "overview":
      result = await getOverview();
      break;

    case "week":
      result = await adminWeek({ laundryId: body.laundry_id, offset: body.offset });
      break;

    case "feedback":
      result = await adminListFeedback({ onlyOpen: body.only_open, limit: body.limit });
      break;

    case "spaces":
      result = await adminGetSpacesOverview();
      break;

    // ── Scritture ────────────────────────────────────────────────────────
    case "setMachineStatus":
      // Il fuori servizio rende lo stato visibile a tutti, ma NON blocca le
      // prenotazioni: chi prenota vede un avviso e decide.
      result = await adminSetMachineStatus({ room: body.room, machine: body.machine, oos: body.oos });
      break;

    case "deleteBooking":
      result = await adminDeleteBooking({ id: body.id });
      break;

    case "forceBook":
      result = await adminForceBook({
        laundryId: body.laundry_id, day: body.day, slot: body.slot,
        machine: body.machine, room: body.room,
      });
      break;

    case "markFeedback":
      result = await adminMarkFeedback({ id: body.id, handled: body.handled });
      break;

    case "deleteSpaceBooking":
      result = await adminDeleteSpaceBooking({ id: body.id });
      break;

    // ── Azioni a nome della DIREZIONE, usate dall'app principale ─────────
    case "bookDirezione":
      result = await adminBookAsDirezione({ laundryId: body.laundry_id, day: body.day, slot: body.slot, machine: body.machine });
      break;

    case "bookSpaceDirezione":
      result = await adminBookSpaceAsDirezione({
        space: body.space, day: body.day, start: body.start, end: body.end, type: body.type,
      });
      break;

    // Liberare un turno, compresi quelli della DIREZIONE che dal percorso
    // pubblico sono protetti. `p_as_admin: true` si può scrivere qui e solo
    // qui: currentAdmin() ha già verificato il cookie in cima all'handler.
    case "clearDirezione":
      result = await adminClearAsDirezione({ room: body.room, day: body.day, slot: body.slot, machine: body.machine });
      break;

    // ── Sala conferenze ─────────────────────────────────────────────────
    // La programmano solo gli amministratori: i residenti la leggono da
    // /api/conferenze, che di scrivere non sa proprio.
    case "conferenzaList":
      result = await conferenceListRules();
      break;

    case "conferenzaAdd":
      result = await conferenceAddRule({
        titolo: body.titolo, inizio: body.inizio, fine: body.fine, dal: body.dal, al: body.al,
        giorno: body.giorno, note: body.note, attore: me.u,
      });
      break;

    case "conferenzaUpdate":
      result = await conferenceUpdateRule({
        id: body.id, titolo: body.titolo, inizio: body.inizio, fine: body.fine,
        dal: body.dal, al: body.al, giorno: body.giorno, note: body.note,
      });
      break;

    // ── Un singolo incontro di una serie ricorrente ──────────────────────
    // `data` è la data che la REGOLA produce (RECURRENCE-ID), non quella a
    // cui l'incontro si vede: è il suo nome per sempre, anche dopo che è
    // stato spostato. Mandare quella visibile creerebbe una seconda
    // eccezione invece di correggere la prima.
    case "conferenzaSkip":
      result = await conferenceSkipOccurrence({ id: body.id, data: body.data, attore: me.u });
      break;

    case "conferenzaMove":
      result = await conferenceMoveOccurrence({
        id: body.id, data: body.data, nuovaData: body.nuova_data,
        inizio: body.inizio, fine: body.fine, titolo: body.titolo, note: body.note, attore: me.u,
      });
      break;

    case "conferenzaResetOccorrenza":
      result = await conferenceResetOccurrence({ id: body.id, data: body.data });
      break;

    case "conferenzaDelete":
      result = await conferenceDeleteRule(body.id);
      break;

    // ── Sistemista: account amministrativi ───────────────────────────────
    // Prima c'erano solo le tre variabili d'ambiente su Vercel; ora il
    // sistemista crea, disattiva e reimposta gli account da qui. Le
    // password non toccano mai il database in chiaro: si cifrano subito,
    // esattamente come per gli account storici.
    case "accountList":
      result = await listAccounts();
      break;

    case "accountCreate": {
      const password = String(body.password || "");
      if (password.length < 8) return fail(res, "la password deve avere almeno 8 caratteri");
      result = await createAccount(String(body.username || "").trim(), password, String(body.ruolo || ""), me.u);
      break;
    }

    case "accountSetPassword": {
      const password = String(body.password || "");
      if (password.length < 8) return fail(res, "la password deve avere almeno 8 caratteri");
      result = await resetAccountPassword(Number(body.id), password);
      break;
    }

    case "accountSetActive":
      result = await setAccountActive(Number(body.id), body.attivo !== false);
      break;

    case "accountDelete":
      result = await deleteAccount(Number(body.id));
      break;

    // Cambio password fatto dal titolare per se' stesso: nessuna sessione
    // sistemista richiesta, ma serve la password attuale (quella data
    // dall'admin alla creazione o al reset) per dimostrare di essere lui.
    //
    // E' l'unica azione ammessa a chi ha ancora la password provvisoria:
    // la guardia in testa all'handler lascia passare solo questa.
    case "accountChangeOwnPassword": {
      const attuale = String(body.password_attuale || "");
      const nuova = String(body.password_nuova || "");
      // Le tre validazioni (password corta, account non trovato, password
      // attuale sbagliata) vivono dentro changeOwnPassword() e arrivano qui
      // come AppError — wrapHandler le traduce nella stessa forma
      // { ok:false, error } di sempre.
      result = await changeOwnPassword(me.u, attuale, nuova);
      break;
    }

    // ── Sistemista: regole ricorrenti ────────────────────────────────────
    case "recurringList":
      result = await listRecurringRules();
      break;

    case "recurringAddLaundry":
      // Non si applica subito: resta inerte fino alla notte fra domenica e
      // lunedì, quando il cron la materializza per la settimana che sta per
      // iniziare. Vale anche per il resto della settimana in corso: niente
      // occupazioni a sorpresa a metà settimana.
      result = await adminAddRecurringRule({
        laundryId: body.laundry_id, day: body.day, slot: body.slot,
        machine: body.machine, room: body.room, note: body.note,
      });
      break;

    case "recurringAddSpace":
      result = await adminAddSpaceRecurringRule({
        spaceId: body.space_id, day: body.day, start: body.start, end: body.end,
        name: body.name, type: body.type, note: body.note,
      });
      break;

    case "recurringSetActive":
      result = await setRecurringRuleActive({ id: body.id, active: body.active });
      break;

    case "recurringDelete":
      // Toglie la regola, non le prenotazioni già create da essa: quelle
      // restano finché la settimana non finisce, e si cancellano a mano.
      result = await deleteRecurringRule(body.id);
      break;

    case "applyRecurring":
      result = await applyRecurringRules(body.offset);
      break;

    // ── Sistemista: pulizia ──────────────────────────────────────────────
    case "purge":
      // `sala` assente = tutte, cioe' il comportamento storico. Il controllo
      // su quali sale esistono sta nella funzione SQL, non qui.
      result = await purgeData({ scope: body.scope, sala: body.sala });
      break;

    // Conteggio delle prenotazioni vive, per sala. Il pannello lo rilegge da
    // solo: e' quello che va a zero quando la pulizia ha funzionato davvero.
    case "counts":
      result = await getCounts();
      break;

    // Quali camere hanno le notifiche attive, canale per canale: push (web
    // app) e Telegram sono liste separate, ciascuna con l'id di ogni riga
    // per poterla cancellare singolarmente.
    case "pushSubs":
      result = await adminListPushSubs();
      break;

    case "deletePushSub":
      result = await adminDeletePushSub(body.id);
      break;

    case "telegramSubs":
      result = await adminListTelegramSubs();
      break;

    case "deleteTelegramSub":
      result = await adminDeleteTelegramSub(body.id);
      break;

    // Notifica manuale ai dispositivi push iscritti — a tutti, o a una sola
    // camera se `body.room` e' valorizzato: usata per comunicazioni del
    // sistemista, non per i promemoria automatici (affari del cron).
    case "broadcastPush":
      result = await adminBroadcast({ actor: me.u, title: body.title, body: body.body, room: body.room });
      break;

    // ── Tema stagionale ──────────────────────────────────────────────────
    case "temaGet":
      result = await getTheme();
      break;

    case "temaSet":
      result = await setTheme(body.tema);
      break;

    // ── Bici ──────────────────────────────────────────────────────────────
    // Lettura: FDO e sistemista. Cancellazione totale (reset annuale) e
    // assegnazione/rimozione per camera: solo sistemista — vedi
    // src/modules/bikes/domain/policy.js.
    case "biciList":
      result = await adminListBikes();
      break;

    case "biciPurge":
      result = await adminPurgeBikes();
      break;

    case "biciDeleteRoom":
      result = await adminDeleteBikeRoom(body.room);
      break;

    case "biciAddRoom":
      result = await adminAddBikeRoom(body.room);
      break;

    default:
      return fail(res, "azione sconosciuta");
  }

  // Solo qui siamo certi che l'azione sia davvero avvenuta (nessun "return
  // fail" prima l'ha intercettata): logga solo i tentativi riusciti. Non si
  // aspetta pero' che il log finisca prima di rispondere — resta best-effort,
  // come sempre: se si perde un tentativo non e' diverso da un log che
  // fallisce per un errore di rete, gia' ignorato qui sotto.
  if (MUTATIONS.has(action)) {
    logAdminAction({
      actor: me.u, action,
      detail: Object.fromEntries(
        Object.entries(body).filter(([k]) => k !== "action" && !k.toLowerCase().includes("password")),
      ),
    }); // fire-and-forget, di proposito — vedi commento sopra
  }

  return json(res, 200, result);
}, { exposeInternalErrors: true });
