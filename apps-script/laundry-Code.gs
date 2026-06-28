/****************************************************************************
 *  LaundryHub — Script COMPLETO del foglio "Lavanderia" (tab Foglio1, gid=0).
 *
 *  Contiene:
 *    - clearRangeLavanderia()  : reset settimanale (invariato)
 *    - API Web App (doGet/doPost): book / clear / setStatus / reminder
 *    - NOTIFICHE PUSH: subscribe / unsubscribe + sendDueReminders (trigger 5')
 *
 *  Le asciugatrici NON sono salvate qui: si derivano lato client dalla regola
 *  d'oro (lavatrice X allo slot N -> asciugatrice X riservata allo slot N+1).
 *  Il loro stato fuori-servizio vive in colonna M.
 *
 *  SETUP NOTIFICHE: vedi sezione "PUSH" più sotto (RELAY_URL / RELAY_SECRET) e
 *  crea il trigger a tempo su `sendDueReminders` (ogni 5 minuti).
 ****************************************************************************/

/***** CONFIG *****/
const SHEET_NAME    = 'Foglio1';        // tab gid=0
const TOKEN         = 'filipposiano';   // stessa stringa usata dall'app e su Vercel
const FIRST_DAY_COL = 3;     // colonna C = Lunedì
const N_DAYS        = 7;     // C..I = Lun..Dom
const N_SLOTS       = 19;    // 07:00 -> 06:45, turni da 75'
const FIRST_ROW     = 2;     // prima riga dati (slot 0, macchina A)
const ROWS_PER_SLOT = 4;     // 3 macchine (A,B,C) + 1 riga vuota di separazione
const STATUS_COL    = 13;    // colonna M (blocco STATO)
const OOO_MARK      = 'X';   // valore scritto nella cella stato quando "fuori servizio"

const WASHER_LETTERS = ['A', 'B', 'C'];

/***** Telegram (opzionale) — lascia vuoto per disattivare *****/
const TELEGRAM_BOT_TOKEN = '';
const TELEGRAM_CHAT_ID   = '';

/***** PUSH — da impostare prima del deploy *****/
const RELAY_URL    = 'https://einaudi-plus.vercel.app/api/push';
const RELAY_SECRET = 'CAMBIA-QUESTO-SEGRETO';   // uguale alla env var RELAY_SECRET su Vercel
const SUBS_SHEET   = 'PushSubs';                // scheda iscrizioni (creata da sola)
const SLOT0_MIN    = 7 * 60;   // 07:00, inizio slot 0
const SLOT_LEN     = 75;       // durata slot in minuti
const LEAD_MIN     = 16;       // avvisa quando mancano <= 16 minuti (≈ 10–15')


/* ========================================================================
 *  Reset settimanale (invariato)
 *  Nota: le righe C6/C7 = '215' sono un seed; toglile se non ti servono.
 * ====================================================================== */
function clearRangeLavanderia() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var range = sheet.getRange("C2:I76");
  range.clearContent();
  sheet.getRange('C6').setValue('215');
  sheet.getRange('C7').setValue('215');
}


/* ========================================================================
 *  API WEB APP
 * ====================================================================== */

/***** UTIL *****/
function ss_()    { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_() { return ss_().getSheetByName(SHEET_NAME) || ss_().getSheets()[0]; }

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Accetta "W-A", "D-A", "A" -> 0/1/2 ; -1 se non valida
function letterIdx_(machine) {
  const L = String(machine).trim().toUpperCase().slice(-1);
  return WASHER_LETTERS.indexOf(L);
}

// Sicurezza: neutralizza formula/CSV injection e limita la lunghezza prima di
// scrivere un valore inviato dall'utente (es. la camera) nel foglio.
function safeCell_(v) {
  let s = String(v == null ? '' : v).trim().slice(0, 20);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

/***** MAPPATURA CELLE *****/
function bookingRow_(slot, washerIdx) { return FIRST_ROW + slot * ROWS_PER_SLOT + washerIdx; }
function bookingCol_(day)             { return FIRST_DAY_COL + day; }
// Stato: Lavatrice X -> riga 3+4X ; Asciugatrice X -> riga 4+4X (colonna M)
function statusRow_(type, idx)        { return (type === 'dryer' ? 4 : 3) + 4 * idx; }

/***** LETTURA *****/
function getWeek_() {
  const sh   = sheet_();
  const rows = N_SLOTS * ROWS_PER_SLOT;                          // 76
  const vals = sh.getRange(FIRST_ROW, FIRST_DAY_COL, rows, N_DAYS).getValues();
  const week = {};
  for (let day = 0; day < N_DAYS; day++) {
    week[day] = {};
    for (let slot = 0; slot < N_SLOTS; slot++) {
      const slotObj = {};
      for (let w = 0; w < 3; w++) {
        const cell = vals[slot * ROWS_PER_SLOT + w][day];
        const room = (cell === null || cell === undefined) ? '' : String(cell).trim();
        if (room) slotObj['W-' + WASHER_LETTERS[w]] = room;
      }
      if (Object.keys(slotObj).length) week[day][slot] = slotObj;
    }
  }
  return week;
}

function getStatus_() {
  const sh   = sheet_();
  const vals = sh.getRange(3, STATUS_COL, 10, 1).getValues();    // righe 3..12, colonna M
  const out  = {};
  for (let i = 0; i < 3; i++) {
    const w = String(vals[statusRow_('washer', i) - 3][0] || '').trim();
    const d = String(vals[statusRow_('dryer',  i) - 3][0] || '').trim();
    out['W-' + WASHER_LETTERS[i]] = w ? 'oos' : 'ok';
    out['D-' + WASHER_LETTERS[i]] = d ? 'oos' : 'ok';
  }
  return out;
}

/***** ENDPOINT GET *****/
function doGet(e) {
  try {
    if ((e.parameter.token || '') !== TOKEN) return json_({ ok: false, error: 'unauthorized' });
    return json_({ ok: true, week: getWeek_(), status: getStatus_(), slots: N_SLOTS });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/***** ENDPOINT POST *****/
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);                       // serializza le scritture concorrenti
    const b = JSON.parse(e.postData.contents);  // body inviato come text/plain
    if ((b.token || '') !== TOKEN) return json_({ ok: false, error: 'unauthorized' });

    // ── Notifiche push ──
    if (b.action === 'subscribe')   return handleSubscribe_(b);
    if (b.action === 'unsubscribe') return handleUnsubscribe_(b);

    const sh = sheet_();

    if (b.action === 'book') {
      const w = letterIdx_(b.machine);
      if (w < 0) return json_({ ok: false, error: 'macchina non valida' });
      const day = Number(b.day), slot = Number(b.slot);
      if (!(day >= 0 && day < N_DAYS) || !(slot >= 0 && slot < N_SLOTS))
        return json_({ ok: false, error: 'parametri non validi' });
      const room = safeCell_(b.room);
      if (!room) return json_({ ok: false, error: 'camera mancante' });
      const cell = sh.getRange(bookingRow_(slot, w), bookingCol_(day));
      const cur  = String(cell.getValue() || '').trim();
      if (cur && cur !== room)
        return json_({ ok: false, error: 'occupata', by: cur });   // race: già preso da un altro
      cell.setValue(room);
      return json_({ ok: true, week: getWeek_(), status: getStatus_() });
    }

    if (b.action === 'clear') {
      const w = letterIdx_(b.machine);
      if (w < 0) return json_({ ok: false, error: 'macchina non valida' });
      const day = Number(b.day), slot = Number(b.slot);
      if (!(day >= 0 && day < N_DAYS) || !(slot >= 0 && slot < N_SLOTS))
        return json_({ ok: false, error: 'parametri non validi' });
      sh.getRange(bookingRow_(slot, w), bookingCol_(day)).clearContent();
      return json_({ ok: true, week: getWeek_(), status: getStatus_() });
    }

    if (b.action === 'setStatus') {
      const idx = letterIdx_(b.machine);
      if (idx < 0) return json_({ ok: false, error: 'macchina non valida' });
      const type = String(b.machine).toUpperCase().startsWith('D') ? 'dryer' : 'washer';
      const cell = sh.getRange(statusRow_(type, idx), STATUS_COL);
      if (b.oos) cell.setValue(OOO_MARK); else cell.clearContent();
      return json_({ ok: true, status: getStatus_() });
    }

    if (b.action === 'reminder') {
      notifyTelegram_(b.room, b.slotLabel);
      return json_({ ok: true });
    }

    return json_({ ok: false, error: 'azione sconosciuta' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/***** Telegram (no-op se i token sono vuoti) *****/
function notifyTelegram_(room, slotLabel) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const text = '🔔 Camera ' + room + ': il turno ' + (slotLabel || '') +
               ' è terminato — per favore ritira il bucato.';
  UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text }),
    muteHttpExceptions: true
  });
}


/* ========================================================================
 *  PUSH — iscrizioni + promemoria ~15 min prima del turno
 * ====================================================================== */

function subsSheet_() {
  var sh = ss_().getSheetByName(SUBS_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(SUBS_SHEET);
    sh.appendRow(['endpoint', 'p256dh', 'auth', 'room', 'ts']);
  }
  return sh;
}

// Salva/aggiorna l'iscrizione push di un dispositivo (legata alla camera).
function handleSubscribe_(b) {
  var room = String(b.room || '').trim();
  var sub  = b.sub || {};
  var keys = sub.keys || {};
  if (!room || !sub.endpoint || !keys.p256dh || !keys.auth) {
    return json_({ ok: false, error: 'invalid-subscription' });
  }
  var sh = subsSheet_();
  var n = sh.getLastRow();
  var rowIdx = -1;
  if (n > 1) {
    var endpoints = sh.getRange(2, 1, n - 1, 1).getValues();
    for (var i = 0; i < endpoints.length; i++) {
      if (String(endpoints[i][0]) === sub.endpoint) { rowIdx = i + 2; break; }
    }
  }
  var rowData = [sub.endpoint, keys.p256dh, keys.auth, room, new Date()];
  if (rowIdx === -1) sh.appendRow(rowData);
  else sh.getRange(rowIdx, 1, 1, 5).setValues([rowData]);
  return json_({ ok: true });
}

function handleUnsubscribe_(b) {
  var endpoint = String(b.endpoint || '');
  if (!endpoint) return json_({ ok: false, error: 'no-endpoint' });
  var sh = subsSheet_();
  var n = sh.getLastRow();
  for (var i = n; i >= 2; i--) {
    if (String(sh.getRange(i, 1).getValue()) === endpoint) { sh.deleteRow(i); break; }
  }
  return json_({ ok: true });
}

/***** Helpers tempo *****/
function pad2push_(x) { return (x < 10 ? '0' : '') + x; }
function fmtMinPush_(min) {
  var m = ((min % 1440) + 1440) % 1440;
  return pad2push_(Math.floor(m / 60)) + ':' + pad2push_(m % 60);
}
// Lunedì 00:00 della settimana corrente (ora locale dello script).
function mondayBase_(now) {
  var dow = (now.getDay() + 6) % 7; // 0 = Lunedì
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow, 0, 0, 0, 0);
}

/***** Trigger: ogni 5 min controlla i turni in arrivo e invia le push *****/
function sendDueReminders() {
  var now = new Date();
  var week = getWeek_();

  // iscrizioni raggruppate per camera
  var sh = subsSheet_();
  var nSub = sh.getLastRow();
  if (nSub <= 1) return;
  var rows = sh.getRange(2, 1, nSub - 1, 4).getValues();
  var byRoom = {};
  for (var i = 0; i < rows.length; i++) {
    var sub = { endpoint: rows[i][0], p256dh: rows[i][1], auth: rows[i][2], room: String(rows[i][3]) };
    (byRoom[sub.room] = byRoom[sub.room] || []).push(sub);
  }

  var props = PropertiesService.getDocumentProperties();
  var base = mondayBase_(now);
  var toDelete = {};

  for (var dStr in week) {
    var day = Number(dStr);
    var slots = week[dStr] || {};
    for (var slStr in slots) {
      var slot = Number(slStr);
      if (slot < 0 || slot >= N_SLOTS) continue;
      var slotStartMin = SLOT0_MIN + slot * SLOT_LEN;
      var dt = new Date(base.getTime() + day * 86400000 + slotStartMin * 60000);
      var minsUntil = (dt.getTime() - now.getTime()) / 60000;
      if (minsUntil <= 0 || minsUntil > LEAD_MIN) continue;

      var machines = slots[slStr] || {};
      for (var machine in machines) {
        var room = String(machines[machine] || '').trim();
        if (!room) continue;
        var targets = byRoom[room];
        if (!targets || !targets.length) continue;

        var sentKey = 'sent_' + Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyyMMddHHmm') + '_' + machine;
        if (props.getProperty(sentKey)) continue;

        var payload = {
          title: 'Lavanderia · turno tra poco',
          body: 'St. ' + room + ' · ' + machine + ' · ' + fmtMinPush_(slotStartMin) + '–' + fmtMinPush_(slotStartMin + SLOT_LEN),
          url: '/',
          tag: 'laundry-' + day + '-' + slot + '-' + machine
        };

        for (var k = 0; k < targets.length; k++) {
          if (sendOnePush_(targets[k], payload) === 'gone') toDelete[targets[k].endpoint] = true;
        }
        props.setProperty(sentKey, '1');
      }
    }
  }

  pruneSubs_(sh, toDelete);
  pruneSentKeys_(props, now);
}

function sendOnePush_(sub, payload) {
  var body = {
    secret: RELAY_SECRET,
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload: payload
  };
  try {
    var resp = UrlFetchApp.fetch(RELAY_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var out = JSON.parse(resp.getContentText() || '{}');
    if (out && out.gone) return 'gone';
    return out && out.ok ? 'ok' : 'err';
  } catch (e) { return 'err'; }
}

function pruneSubs_(sh, toDelete) {
  var n = sh.getLastRow();
  for (var i = n; i >= 2; i--) {
    if (toDelete[String(sh.getRange(i, 1).getValue())]) sh.deleteRow(i);
  }
}

// Elimina le chiavi 'sent_' di orari ormai passati (mantiene il set piccolo).
function pruneSentKeys_(props, now) {
  var all = props.getProperties();
  var stampNow = Number(Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmm'));
  for (var key in all) {
    if (key.indexOf('sent_') !== 0) continue;
    var m = key.match(/^sent_(\d{12})_/);
    if (m && Number(m[1]) < stampNow) props.deleteProperty(key);
  }
}

/***** Da lanciare a mano nell'editor per verificare la mappatura *****/
function _test() {
  Logger.log('Giovedì: ' + JSON.stringify(getWeek_()[3]));
  Logger.log('Stato:   ' + JSON.stringify(getStatus_()));
}
