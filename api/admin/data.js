// Operazioni del pannello amministrativo.
//
// Ogni azione passa da currentAdmin(): senza cookie valido si esce con 401
// prima di toccare il database.

import { rpc } from "../_lib/db.js";
import { readBody, json, fail, methodOk, intero, camera } from "../_lib/http.js";
import { sendWebPush, pushConfigured } from "../_lib/push.js";
import { sendTelegram, telegramConfigured } from "../_lib/telegram.js";

// Identity (sessioni, ruoli, account) vive per intero in src/modules/identity
// -- vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md. Il resto delle
// azioni di questo file (macchine, sale, conferenze, bici...) appartiene ad
// altri domini non ancora migrati, e resta invariato.
import {
  currentAdmin, isSysadmin, isStaff,
  listAccounts, createAccount, resetAccountPassword, setAccountActive, deleteAccount,
  changeOwnPassword,
} from "../../src/modules/identity/index.js";
import {
  adminWeek, adminSetMachineStatus, adminDeleteBooking, adminForceBook,
  adminBookAsDirezione, adminClearAsDirezione, adminAddRecurringRule,
} from "../../src/modules/laundry/index.js";
import {
  adminGetSpacesOverview, adminDeleteSpaceBooking,
  adminBookAsDirezione as adminBookSpaceAsDirezione,
  adminAddRecurringRule as adminAddSpaceRecurringRule,
} from "../../src/modules/common-spaces/index.js";
import { getTheme, setTheme } from "../../src/modules/theme/index.js";
import { AppError } from "../../src/shared/errors/AppError.js";

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

// Riservate al sistemista. La portineria non le vede nel pannello, ma il
// controllo sta qui: nascondere un pulsante non e' un'autorizzazione.
const SOLO_SISTEMISTA = new Set([
  "recurringList", "recurringAddLaundry", "recurringAddSpace",
  "recurringSetActive", "recurringDelete", "applyRecurring", "purge", "counts",
  "pushSubs", "deletePushSub", "telegramSubs", "deleteTelegramSub", "broadcastPush",
  "accountList", "accountCreate", "accountSetPassword",
  "accountSetActive", "accountDelete", "biciPurge", "biciDeleteRoom", "biciAddRoom",
  "temaGet", "temaSet",
]);

// Macchine e segnalazioni restano affari di FDO e sistemista: lo staff
// prenota e libera turni per conto della Direzione come l'FDO, ma non deve
// vedere ne' toccare lo stato guasto/funzionante delle macchine ne' le
// segnalazioni dei residenti.
const VIETATE_A_STAFF = new Set([
  "overview", "setMachineStatus", "feedback", "markFeedback", "biciList",
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
  //
  // Costa una lettura in piu' a ogni azione. Si potrebbe evitare mettendo il
  // flag nel cookie firmato, ma un reset fatto dall'admin non toccherebbe le
  // sessioni gia' aperte: qui la domanda si fa a chi la risposta ce l'ha.
  if (action !== "accountChangeOwnPassword") {
    let deveCambiare = false;
    try {
      const row = await rpc("account_by_username", { p_username: me.u });
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

  try {
    let result;

    switch (action) {
      // ── Letture ──────────────────────────────────────────────────────────
      case "overview":
        result = await rpc("admin_overview");
        break;

      case "week":
        result = await adminWeek({ laundryId: body.laundry_id, offset: body.offset });
        break;

      case "feedback":
        result = await rpc("admin_feedback", {
          p_only_open: body.only_open !== false,
          p_limit: Math.min(Number(body.limit || 100), 500),
        });
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
        result = await rpc("admin_mark_feedback", {
          p_id: Number(body.id),
          p_handled: body.handled !== false,
        });
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

      case "conferenzaUpdate":
        result = await rpc("conference_update", {
          p_id: Number(body.id),
          p_titolo: String(body.titolo || ""),
          p_ora_inizio: String(body.inizio || ""),
          p_ora_fine: String(body.fine || ""),
          p_dal: String(body.dal || ""),
          p_al: String(body.al || ""),
          p_giorno_settimana: body.giorno === null || body.giorno === undefined || body.giorno === ""
            ? null : Number(body.giorno),
          p_note: body.note ? String(body.note) : null,
        });
        break;

      // ── Un singolo incontro di una serie ricorrente ──────────────────────
      // `data` è la data che la REGOLA produce (RECURRENCE-ID), non quella a
      // cui l'incontro si vede: è il suo nome per sempre, anche dopo che è
      // stato spostato. Mandare quella visibile creerebbe una seconda
      // eccezione invece di correggere la prima.
      case "conferenzaSkip":
        result = await rpc("conference_skip", {
          p_id: Number(body.id),
          p_data: String(body.data || ""),
          p_attore: me.u,
        });
        break;

      case "conferenzaMove":
        result = await rpc("conference_move", {
          p_id: Number(body.id),
          p_data: String(body.data || ""),
          p_nuova_data: String(body.nuova_data || ""),
          p_ora_inizio: body.inizio ? String(body.inizio) : null,
          p_ora_fine: body.fine ? String(body.fine) : null,
          p_titolo: body.titolo ? String(body.titolo) : null,
          p_note: body.note ? String(body.note) : null,
          p_attore: me.u,
        });
        break;

      case "conferenzaResetOccorrenza":
        result = await rpc("conference_reset_occorrenza", {
          p_id: Number(body.id),
          p_data: String(body.data || ""),
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
        // attuale sbagliata) vivono ora dentro changeOwnPassword() e arrivano
        // qui come AppError — il catch in fondo a questo handler le traduce
        // nella stessa forma { ok:false, error } di sempre (vedi sotto).
        result = await changeOwnPassword(me.u, attuale, nuova);
        break;
      }

      // ── Sistemista: regole ricorrenti ────────────────────────────────────
      case "recurringList":
        result = await rpc("recurring_list");
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
        // `sala` assente = tutte, cioe' il comportamento storico. Il controllo
        // su quali sale esistono sta nella funzione SQL, non qui: e' la stessa
        // che deve rifiutare una sala inventata anche a chi chiama senza
        // passare dal pannello.
        result = await rpc("sysadmin_purge", {
          p_scope: String(body.scope || ""),
          p_sala: body.sala ? String(body.sala) : null,
        });
        break;

      // Conteggio delle prenotazioni vive, per sala. Il pannello lo rilegge da
      // solo: e' quello che va a zero quando la pulizia ha funzionato davvero.
      case "counts":
        result = await rpc("sysadmin_conteggi");
        break;

      // Quali camere hanno le notifiche attive, canale per canale: push (web
      // app) e Telegram sono liste separate, ciascuna con l'id di ogni riga
      // per poterla cancellare singolarmente.
      case "pushSubs":
        result = await rpc("sysadmin_push_subs");
        break;

      case "deletePushSub":
        result = await rpc("sysadmin_delete_push_sub", { p_id: Number(body.id) });
        break;

      case "telegramSubs":
        result = await rpc("sysadmin_telegram_subs");
        break;

      case "deleteTelegramSub":
        result = await rpc("sysadmin_delete_telegram_sub", { p_id: Number(body.id) });
        break;

      // Notifica manuale ai dispositivi push iscritti — a tutti, o a una sola
      // camera se `body.room` e' valorizzato (es. un pacco arrivato, un
      // problema di quella stanza): usata per comunicazioni del sistemista,
      // non per i promemoria automatici che restano affari del cron.
      case "broadcastPush": {
        // Limite per account, non per IP: un cookie rubato funziona da
        // qualunque indirizzo, quindi il freno deve seguire CHI sta mandando,
        // non da dove. Tre invii ogni mezz'ora bastano a chi lo usa davvero
        // (comunicazioni occasionali) e tengono corto il danno se l'account
        // e' compromesso — non lo impediscono, ma un blast di massa richiede
        // comunque piu' di un colpo solo.
        const puoInviare = await rpc("rl_hit", {
          p_bucket: `broadcast:${me.u}`, p_limit: 3, p_window_secs: 1800,
        }).catch(() => true); // DB muto: non e' questo il controllo che deve bloccare tutto
        if (!puoInviare) {
          return fail(res, "troppi invii, riprova fra un po' (max 3 ogni mezz'ora)", {}, 429);
        }

        const title = String(body.title || "").trim();
        const testo = String(body.body || "").trim();
        if (!title || !testo) return fail(res, "titolo e testo sono obbligatori");

        // Vuoto/assente = tutti, come prima. Valorizzato = solo quella camera.
        let room = null;
        if (body.room != null && String(body.room).trim() !== "") {
          room = camera(body.room);
          if (!room) return fail(res, "camera non valida");
        }

        const usaPush = pushConfigured();
        const usaTelegram = telegramConfigured();
        if (!usaPush && !usaTelegram) {
          return fail(res, "nessun canale di notifica configurato sul server");
        }

        const push = { totali: 0, inviati: 0, falliti: 0 };
        const telegram = { totali: 0, inviati: 0, falliti: 0 };

        if (usaPush) {
          const subs = await rpc("sysadmin_all_push_subs", { p_room: room });
          const dispositivi = Array.isArray(subs) ? subs : [];
          push.totali = dispositivi.length;

          const gone = [];
          await Promise.all(dispositivi.map(async (s) => {
            const esito = await sendWebPush(
              // `tag` diverso da "laundry-reminder" (il default in sw.js):
              // senza, una notifica di lavanderia in arrivo sostituirebbe
              // questa, o viceversa, invece di comparire entrambe.
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              { title, body: testo, url: "/", tag: "sysadmin-broadcast" }
            );
            if (esito === "ok") push.inviati++;
            else {
              push.falliti++;
              if (esito === "gone") gone.push(s.id);
            }
          }));

          // Stessa potatura del cron: chi ha disinstallato o revocato il
          // permesso non ricevera' mai piu' nulla, la riga resta solo rumore.
          if (gone.length) {
            await rpc("sysadmin_prune_push_subs", { p_ids: gone }).catch(() => {});
          }
        }

        if (usaTelegram) {
          const chats = await rpc("sysadmin_all_telegram_subs", { p_room: room });
          const lista = Array.isArray(chats) ? chats : [];
          telegram.totali = lista.length;

          await Promise.all(lista.map(async (c) => {
            const esito = await sendTelegram(c.chat_id, title, testo);
            if (esito === "ok") telegram.inviati++; else telegram.falliti++;
          }));
        }

        result = { ok: true, push, telegram };
        break;
      }

      // ── Tema stagionale ──────────────────────────────────────────────────
      // Decorazione dell'app lato residenti (Halloween, Natale con la
      // neve...), accesa/spenta dal sistemista in qualsiasi momento. Vive in
      // una riga sola nel database (app_theme): la legge laundry_snapshot a
      // ogni avvio dell'app, non serve un canale a parte.
      case "temaGet":
        result = await getTheme();
        break;

      case "temaSet":
        result = await setTheme(body.tema);
        break;

      // ── Bici ──────────────────────────────────────────────────────────────
      // Lettura: FDO e sistemista (vedi VIETATE_A_STAFF). Cancellazione totale,
      // per il reset annuale: solo sistemista (vedi SOLO_SISTEMISTA).
      case "biciList":
        result = await rpc("bike_admin_list");
        break;

      case "biciPurge":
        result = await rpc("bike_purge");
        break;

      // Come biciAddRoom, ma al contrario: avvisa il residente solo se c'era
      // davvero una bici da togliere (bike_delete_room dice `deleted`), cosi'
      // un tocco su una camera gia' senza bici non manda nessun avviso.
      case "biciDeleteRoom": {
        const room = camera(body.room);
        if (!room) return fail(res, "numero di camera non valido");

        result = await rpc("bike_delete_room", { p_room: room });

        if (result?.deleted) {
          const targets = await rpc("bike_notify_targets", { p_room: room }).catch(() => null);
          const title = "Bici rimossa";
          const testo = `La reception ha tolto la bici segnata per la tua camera (${room}).`;

          if (pushConfigured() && Array.isArray(targets?.push) && targets.push.length) {
            const gone = [];
            await Promise.all(targets.push.map(async (s) => {
              const esitoInvio = await sendWebPush(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                { title, body: testo, url: "/", tag: "bici-rimossa" }
              );
              if (esitoInvio === "gone") gone.push(s.id);
            }));
            if (gone.length) await rpc("sysadmin_prune_push_subs", { p_ids: gone }).catch(() => {});
          }

          if (telegramConfigured() && Array.isArray(targets?.telegram) && targets.telegram.length) {
            await Promise.all(targets.telegram.map((c) => sendTelegram(c.chat_id, title, testo)));
          }
        }
        break;
      }

      // Assegna una bici a una camera dal pannello, invece che aspettare che
      // il residente la dichiari da solo dalle sue Impostazioni — utile per
      // chi non usa l'app, o per farlo fare alla reception. bike_admin_set (a
      // differenza di bike_set, usata dal residente) marca la riga come
      // assegnata dalla reception e dice se ha inserito davvero qualcosa di
      // nuovo: solo allora avvisiamo il residente, cosi' un secondo tocco
      // sulla stessa camera non manda una notifica doppia.
      case "biciAddRoom": {
        const room = camera(body.room);
        if (!room) return fail(res, "numero di camera non valido");
        const esito = await rpc("bike_admin_set", { p_room: room });

        if (esito?.inserted) {
          const targets = await rpc("bike_notify_targets", { p_room: room }).catch(() => null);
          const title = "Bici registrata";
          const testo = `La reception ha segnato che la tua camera (${room}) ha una bici.`;

          if (pushConfigured() && Array.isArray(targets?.push) && targets.push.length) {
            const gone = [];
            await Promise.all(targets.push.map(async (s) => {
              const esitoInvio = await sendWebPush(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                { title, body: testo, url: "/", tag: "bici-registrata" }
              );
              if (esitoInvio === "gone") gone.push(s.id);
            }));
            if (gone.length) await rpc("sysadmin_prune_push_subs", { p_ids: gone }).catch(() => {});
          }

          if (telegramConfigured() && Array.isArray(targets?.telegram) && targets.telegram.length) {
            await Promise.all(targets.telegram.map((c) => sendTelegram(c.chat_id, title, testo)));
          }
        }

        result = { ok: true, inserted: Boolean(esito?.inserted) };
        break;
      }

      default:
        return fail(res, "azione sconosciuta");
    }

    // Solo qui siamo certi che l'azione sia davvero avvenuta (nessun "return
    // fail" prima l'ha intercettata): logga solo i tentativi riusciti, come
    // sempre. Non si aspetta pero' che il log finisca prima di rispondere —
    // non dipende dal risultato, quindi tenerlo sul percorso critico voleva
    // dire pagare due andate e ritorni verso Supabase invece di uno solo per
    // ogni scrittura (il pannello sembrava lento proprio li'). Il log resta
    // best-effort: se si perde un tentativo perche' la funzione si ferma
    // prima che la richiesta arrivi, non e' diverso da un log che fallisce
    // per un errore di rete, gia' ignorato qui sotto.
    if (MUTATIONS.has(action)) {
      rpc("admin_log", {
        p_actor: me.u, p_action: action,
        p_detail: Object.fromEntries(
          Object.entries(body).filter(([k]) => k !== "action" && !k.toLowerCase().includes("password"))
        ),
      }).catch(() => { /* il log non deve far fallire l'operazione */ });
    }

    return json(res, 200, result);
  } catch (err) {
    // Un errore tipizzato da un modulo già migrato (oggi solo Identity): il
    // suo messaggio è già pensato per il client ("password attuale non
    // corretta", non un dettaglio interno), quindi si restituisce così com'è,
    // con lo status che l'errore stesso porta — non 500 automatico.
    if (err instanceof AppError && err.expose) {
      return fail(res, err.message, err.extra || {}, err.status);
    }

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
