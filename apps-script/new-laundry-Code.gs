// apps-script/new-laundry-Code.gs
// Codice da inserire nel NUOVO foglio (https://docs.google.com/spreadsheets/d/1-s9ZkViZVObAKU8ceDnhvgbzqIJL9wdygvB2KGl-Bj0/edit)
// Gestisce solo "Lavatrice A" e salva i turni a righe alterne nella Colonna A.
// Questo script va pubblicato come App Web.

const TOKEN = ''; // Deve corrispondere al frontend
const SHEET_NAME = 'Foglio1'; // Nome del foglio dove inserire i dati
const N_SLOTS = 19; // Totale slot giornalieri

const RELAY_URL    = 'https://einaudi-plus.vercel.app/api/push';
const RELAY_SECRET = 'CAMBIA-QUESTO-SEGRETO';
const SUBS_SHEET   = 'PushSubs';
const SLOT0_MIN    = 7 * 60;
const SLOT_LEN     = 75;
const LEAD_MIN     = 16;

function getSheet_() {
  var ss = SpreadsheetApp.openById("1-s9ZkViZVObAKU8ceDnhvgbzqIJL9wdygvB2KGl-Bj0");
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET SNAPSHOT ──
// Il frontend richiede lo snapshot dell'intera settimana per popolare la griglia.
// Dato che usiamo un solo giorno (o la logica è che si prenota solo per oggi nel nuovo foglio?), 
// la richiesta originale non specificava i giorni, ma il frontend EinaudiPlus carica una matrice WeekData[day][slot]['W-A'].
// Poiché il nuovo foglio ha "turni nella colonna A a righe alterne", assumiamo che si riferisca al giorno corrente (oggi).
// Ma se l'app carica un'intera settimana, serve restituire almeno la struttura prevista.
function getWeek_() {
  const sh = getSheet_();
  // Legge colonne A-H (1-8). Colonna A: orari. B: Lun, C: Mar... H: Dom
  const vals = sh.getRange(1, 1, Math.max(N_SLOTS * 2, 2), 8).getValues();
  const week = {};
  
  for (let day = 0; day < 7; day++) {
    week[day] = {};
    for (let slot = 0; slot < N_SLOTS; slot++) {
      // Riga nel foglio = (slot * 2) + 2 => array index = (slot * 2) + 1
      let r = (slot * 2) + 1;
      let c = day + 1; // array index per colonna (B=1, C=2, ..., H=7)
      if (r < vals.length && c < vals[r].length) {
        const room = String(vals[r][c] || '').trim();
        if (room) {
          week[day][slot] = { 'W-A': room };
        }
      }
    }
  }
  return week;
}

function getStatus_() {
  return { 'W-A': 'ok', 'W-B': 'oos', 'W-C': 'oos', 'D-A': 'oos', 'D-B': 'oos', 'D-C': 'oos' };
}

function doGet(e) {
  try {
    if ((e.parameter.token || '') !== TOKEN) return json_({ ok: false, error: 'unauthorized' });
    return json_({ ok: true, week: getWeek_(), status: getStatus_(), slots: N_SLOTS });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const b = JSON.parse(e.postData.contents);
    if ((b.token || '') !== TOKEN) return json_({ ok: false, error: 'unauthorized' });

    const sh = getSheet_();

    if (b.action === 'book') {
      if (b.machine !== 'W-A') return json_({ ok: false, error: 'In questa lavanderia esiste solo la Lavatrice A' });
      const room = String(b.room || '').trim().slice(0, 20);
      const row = (b.slot * 2) + 2;
      const col = (b.day !== undefined ? Number(b.day) : ((new Date().getDay() + 6) % 7)) + 2;
      const cell = sh.getRange(row, col);
      
      if (String(cell.getValue() || '').trim() !== '') {
        return json_({ ok: false, error: 'Turno già occupato' });
      }
      
      cell.setNumberFormat('@').setValue(room);
      return json_({ ok: true, week: getWeek_(), status: getStatus_() });
    }
    
    if (b.action === 'clear') {
      const row = (b.slot * 2) + 2;
      const col = (b.day !== undefined ? Number(b.day) : ((new Date().getDay() + 6) % 7)) + 2;
      const cell = sh.getRange(row, col);
      cell.clearContent();
      return json_({ ok: true, week: getWeek_(), status: getStatus_() });
    }
    
    if (b.action === 'subscribe') return handleSubscribe_(b);
    if (b.action === 'unsubscribe') return handleUnsubscribe_(b);
    
    // Fallback per altre azioni (status, ecc.) che non usiamo nel nuovo foglio
    return json_({ ok: true, week: getWeek_(), status: getStatus_() });
    
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================
 *  PUSH — iscrizioni + promemoria ~15 min prima del turno
 * ====================================================================== */

function subsSheet_() {
  var ss = SpreadsheetApp.openById("1-s9ZkViZVObAKU8ceDnhvgbzqIJL9wdygvB2KGl-Bj0");
  var sh = ss.getSheetByName(SUBS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SUBS_SHEET);
    sh.appendRow(['endpoint', 'p256dh', 'auth', 'room', 'ts']);
  }
  return sh;
}

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

function pad2push_(x) { return (x < 10 ? '0' : '') + x; }
function fmtMinPush_(min) {
  var m = ((min % 1440) + 1440) % 1440;
  return pad2push_(Math.floor(m / 60)) + ':' + pad2push_(m % 60);
}
function mondayBase_(now) {
  var dow = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow, 0, 0, 0, 0);
}

function sendDueReminders() {
  var now = new Date();
  var week = getWeek_();

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

function pruneSentKeys_(props, now) {
  var all = props.getProperties();
  var stampNow = Number(Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmm'));
  for (var key in all) {
    if (key.indexOf('sent_') !== 0) continue;
    var m = key.match(/^sent_(\d{12})_/);
    if (m && Number(m[1]) < stampNow) props.deleteProperty(key);
  }
}
