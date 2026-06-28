/**
 * ADD-ON Apps Script per le NOTIFICHE PUSH della LAVANDERIA.
 *
 * Incolla TUTTO questo file in fondo al Code.gs della lavanderia (lo stesso che
 * gestisce book/clear/status). Poi:
 *
 *  1) Nel tuo doPost, dopo aver letto `body`, `token`, `action` e verificato il
 *     token, aggiungi due righe per smistare le nuove azioni:
 *
 *         if (action === 'subscribe')   return handleSubscribe_(body);
 *         if (action === 'unsubscribe') return handleUnsubscribe_(body);
 *
 *  2) Imposta qui sotto RELAY_URL (la funzione Vercel) e RELAY_SECRET.
 *
 *  3) Crea un TRIGGER A TEMPO: Trigger (orologio) → Aggiungi trigger →
 *     funzione `sendDueReminders`, "In base al tempo", "Timer a minuti",
 *     "Ogni 5 minuti".
 *
 * Come funziona: ogni 5 min `sendDueReminders` legge i turni della settimana,
 * trova quelli che iniziano entro ~15 minuti, e per ogni camera prenotata invia
 * una push a tutti i dispositivi iscritti con quella camera, passando per il
 * relay su Vercel (che firma/cifra). Un "promemoria" non viene mai inviato due
 * volte (dedup via proprietà del documento).
 */

// ─── Configurazione ──────────────────────────────────────────────────────────
var PUSH_TOKEN = 'filipposiano';   // stesso token dell'app

// URL pubblico della Web App lavanderia (per rileggere i turni). È lo stesso
// /exec usato dal frontend (api.ts → API_URL).
var SELF_URL = 'https://script.google.com/macros/s/AKfycbzjbXMoG5fvS_VaWdZ-8Gde7PQebS2j7ShiIHv8rlXz660XaJuTcGeAPKtwtbkYJYNiRA/exec';

// Funzione relay su Vercel e segreto condiviso (impostalo anche su Vercel).
var RELAY_URL    = 'https://INSERISCI-IL-TUO-PROGETTO.vercel.app/api/push';
var RELAY_SECRET = 'CAMBIA-QUESTO-SEGRETO';

// Geometria turni (deve combaciare col frontend: 19 turni da 75', dalle 07:00).
var SLOT0_MIN  = 7 * 60;   // 07:00
var SLOT_LEN   = 75;       // minuti
var N_SLOTS    = 19;
var LEAD_MIN   = 16;       // avvisa quando mancano <= 16 minuti (≈ 10–15')

var SUBS_SHEET = 'PushSubs';

// ─── Foglio iscrizioni ───────────────────────────────────────────────────────
function subsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SUBS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SUBS_SHEET);
    sh.appendRow(['endpoint', 'p256dh', 'auth', 'room', 'ts']);
  }
  return sh;
}

function pushJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Azioni dal frontend ─────────────────────────────────────────────────────
function handleSubscribe_(body) {
  var room = String(body.room || '').trim();
  var sub  = body.sub || {};
  var keys = sub.keys || {};
  if (!room || !sub.endpoint || !keys.p256dh || !keys.auth) {
    return pushJson_({ ok: false, error: 'invalid-subscription' });
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
  return pushJson_({ ok: true });
}

function handleUnsubscribe_(body) {
  var endpoint = String(body.endpoint || '');
  if (!endpoint) return pushJson_({ ok: false, error: 'no-endpoint' });
  var sh = subsSheet_();
  var n = sh.getLastRow();
  for (var i = n; i >= 2; i--) {
    if (String(sh.getRange(i, 1).getValue()) === endpoint) { sh.deleteRow(i); break; }
  }
  return pushJson_({ ok: true });
}

// ─── Helpers tempo ───────────────────────────────────────────────────────────
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

// ─── Invio promemoria (chiamata dal trigger ogni 5 min) ──────────────────────
function sendDueReminders() {
  var now = new Date();

  // 1) leggi i turni della settimana dal proprio endpoint
  var week;
  try {
    var resp = UrlFetchApp.fetch(SELF_URL + '?token=' + encodeURIComponent(PUSH_TOKEN),
      { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());
    week = (data && data.week) || {};
  } catch (e) { return; }

  // 2) iscrizioni raggruppate per camera
  var sh = subsSheet_();
  var subs = [];
  var nSub = sh.getLastRow();
  if (nSub > 1) {
    var rows = sh.getRange(2, 1, nSub - 1, 4).getValues();
    for (var i = 0; i < rows.length; i++) {
      subs.push({ row: i + 2, endpoint: rows[i][0], p256dh: rows[i][1], auth: rows[i][2], room: String(rows[i][3]) });
    }
  }
  if (!subs.length) return;
  var byRoom = {};
  for (var s = 0; s < subs.length; s++) {
    (byRoom[subs[s].room] = byRoom[subs[s].room] || []).push(subs[s]);
  }

  var props = PropertiesService.getDocumentProperties();
  var base = mondayBase_(now);
  var toDelete = {};

  // 3) scorri i turni e trova quelli "in arrivo"
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
          var res = sendOnePush_(targets[k], payload);
          if (res === 'gone') toDelete[targets[k].endpoint] = true;
        }
        props.setProperty(sentKey, '1');
      }
    }
  }

  // 4) rimuovi iscrizioni scadute
  pruneSubs_(sh, toDelete);
  // 5) pulizia chiavi di dedup ormai passate
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
