/**
 * Apps Script per le SALE A FASCE LIBERE (Cinema / Musica).
 *
 * Legge e scrive DIRETTAMENTE sulla griglia leggibile del foglio (quella che
 * compilate a mano), non su un foglio di servizio. Così app e foglio mostrano
 * sempre le stesse prenotazioni.
 *
 * STRUTTURA DELLA GRIGLIA (robusta, niente righe fisse):
 *   • Colonna A = NOME DEL GIORNO (Lunedì, Martedì, …), anche in cella unita.
 *     Ogni prenotazione appartiene al giorno della più recente etichetta di
 *     colonna A che la precede (o sulla sua stessa riga). I blocchi possono avere
 *     un numero qualsiasi di righe.
 *   • Colonna B = orario. Formati accettati: "18:00-20:00", "18.00-20.00",
 *     "18/20", "20.30/23.30", "21:00-00:00" e orari oltre la mezzanotte
 *     ("20:00-03:00").
 *   • Colonna C = libera (NON usata dall'app).
 *   • Colonna D = nome di chi prenota.
 *   • Colonna E = libera (NON usata dall'app).
 *   • Colonna F = tipo/note (solo Cinema): "R" (Riservata) / "P" (Party).
 *     Per la Musica resta vuota.
 *
 * Deploy: Estensioni → Apps Script, incolla questo file in OGNI foglio (cinema e
 * musica). Per aggiornare SENZA cambiare URL: Distribuzione → Gestisci
 * distribuzioni → ✏️ → Versione: "Nuova versione" → Distribuisci.
 *
 * Reset settimanale (lunedì notte): TRIGGER A TEMPO collegato a clearRange()
 * (vedi fondo file). NON rinominarla, altrimenti il trigger smette di funzionare.
 */

var TOKEN = 'filipposiano';

// ─── Colonne (1 = A, 2 = B, …) ──────────────────────────────────────────────
var COL_DAY  = 1;  // A = nome del giorno
var COL_TIME = 2;  // B = orario
var COL_NAME = 4;  // D = nome
var COL_TYPE = 6;  // F = tipo "R"/"P" (solo Cinema). Se nel tuo foglio è la E, metti 5.
var MAX_COL  = 6;  // ultima colonna che leggiamo (F)

// Nome ESATTO della scheda con la griglia. Lascialo '' per scegliere la prima
// scheda che NON sia il vecchio foglio "Bookings", oppure scrivi il nome qui.
var SHEET_NAME = '';

// Foglio su cui leggere/scrivere. Non usa MAI il vecchio foglio "Bookings".
function grid_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (SHEET_NAME) {
    var byName = ss.getSheetByName(SHEET_NAME);
    if (byName) return byName;
  }
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() !== 'bookings') return sheets[i];
  }
  return sheets[0];
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function pad2_(n) { return (n < 10 ? '0' : '') + n; }

// Indice del giorno (0 = Lun … 6 = Dom) dal testo della colonna A, oppure -1.
function dayIndex_(v) {
  var s = String(v || '').toLowerCase().trim();
  if (!s) return -1;
  var pre = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  for (var i = 0; i < pre.length; i++) {
    if (s.indexOf(pre[i]) === 0) return i;
  }
  return -1;
}

// Orario → { start, end } in minuti, oppure null. Accetta separatori "-" o "/",
// "." o ":" tra ore e minuti, minuti opzionali, e fasce che superano mezzanotte.
function parseRange_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var s = String(v).trim();
  var m = s.match(/(\d{1,2})(?:[:.](\d{1,2}))?\s*[-\/]\s*(\d{1,2})(?:[:.](\d{1,2}))?/);
  if (!m) return null;
  var sh = Number(m[1]), sm = m[2] ? Number(m[2]) : 0;
  var eh = Number(m[3]), em = m[4] ? Number(m[4]) : 0;
  if (sh > 23 || eh > 24 || sm > 59 || em > 59) return null;
  var start = sh * 60 + sm;
  var end   = eh * 60 + em;
  if (end <= start) end += 24 * 60;       // fascia che attraversa la mezzanotte
  if (end - start > 24 * 60) return null;
  return { start: start, end: end };
}

function fmtMin_(min) { return pad2_(Math.floor(min / 60) % 24) + ':' + pad2_(min % 60); }
function fmtRange_(start, end) { return fmtMin_(start) + '-' + fmtMin_(end); }

// Colonna F → tipo dell'app. Trova una "R" o "P" isolata (es. "20-23 R" → R).
function parseType_(v) {
  var s = String(v || '').toUpperCase();
  if (/(^|[^A-Z])P([^A-Z]|$)/.test(s)) return 'open';     // P = Party
  if (/(^|[^A-Z])R([^A-Z]|$)/.test(s)) return 'private';  // R = Riservata
  return undefined;
}
function typeLabel_(type) {
  if (type === 'open') return 'P';
  if (type === 'private') return 'R';
  return '';
}

// ─── Lettura: scorre tutte le righe e assegna il giorno via colonna A ────────
function readAll_(sh) {
  var last = Math.max(sh.getLastRow(), 1);
  var vals = sh.getRange(1, 1, last, MAX_COL).getValues(); // A..F
  var iTime = COL_TIME - 1, iName = COL_NAME - 1, iType = COL_TYPE - 1;
  var out = [];
  var curDay = -1;
  for (var i = 0; i < vals.length; i++) {
    var d = dayIndex_(vals[i][COL_DAY - 1]);
    if (d >= 0) curDay = d;                  // nuova etichetta di giorno
    if (curDay < 0) continue;                // righe prima del primo giorno
    var range = parseRange_(vals[i][iTime]);
    var name  = String(vals[i][iName] || '').trim();
    if (!range || !name) continue;           // riga senza orario o senza nome
    out.push({
      id: 'r' + (i + 1),                     // id stabile = numero di riga
      day: curDay,
      start: range.start,
      end: range.end,
      name: name,
      type: parseType_(vals[i][iType])
    });
  }
  return out;
}

// Intervallo di righe [start,end] (1-based) del blocco di un giorno.
function daySpan_(sh, day) {
  var last = Math.max(sh.getLastRow(), 1);
  var aVals = sh.getRange(1, COL_DAY, last, 1).getValues();
  var start = -1, end = -1;
  for (var i = 0; i < aVals.length; i++) {
    var d = dayIndex_(aVals[i][0]);
    if (start === -1) {
      if (d === day) start = i + 1;
    } else if (d >= 0) {                      // prossima etichetta → fine blocco
      end = i;
      break;
    }
  }
  if (start === -1) return null;
  if (end === -1) end = last;
  return { start: start, end: end };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Endpoint ───────────────────────────────────────────────────────────────
function doGet(e) {
  if (!e || e.parameter.token !== TOKEN) return json_({ ok: false, error: 'unauthorized' });
  return json_({ ok: true, bookings: readAll_(grid_()) });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) {}
  var token = body.token || (e.parameter && e.parameter.token);
  var action = body.action || (e.parameter && e.parameter.action);
  if (token !== TOKEN) return json_({ ok: false, error: 'unauthorized' });

  var lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    var sh = grid_();

    if (action === 'book') {
      var day = Number(body.day), start = Number(body.start), end = Number(body.end);
      var name = String(body.name || '').trim();
      var type = body.type ? String(body.type) : '';
      if (!name || !(end > start) || !(day >= 0 && day <= 6)) {
        return json_({ ok: false, error: 'invalid' });
      }

      // controllo sovrapposizioni nello stesso giorno
      var all = readAll_(sh);
      var clash = all.some(function (b) { return b.day === day && start < b.end && b.start < end; });
      if (clash) return json_({ ok: false, error: 'overlap' });

      // prima riga libera nel blocco del giorno
      var span = daySpan_(sh, day);
      if (!span) return json_({ ok: false, error: 'noday' });   // etichetta giorno assente nel foglio
      var freeRow = -1;
      for (var r = span.start; r <= span.end; r++) {
        var t = sh.getRange(r, COL_TIME).getValue();
        var n = sh.getRange(r, COL_NAME).getValue();
        if (String(t || '').trim() === '' && String(n || '').trim() === '') { freeRow = r; break; }
      }
      if (freeRow === -1) return json_({ ok: false, error: 'full' });

      sh.getRange(freeRow, COL_TIME).setValue(fmtRange_(start, end));
      sh.getRange(freeRow, COL_NAME).setValue(name);
      sh.getRange(freeRow, COL_TYPE).setValue(typeLabel_(type));
      return json_({ ok: true, bookings: readAll_(sh) });
    }

    if (action === 'clear') {
      var id = String(body.id || '');
      var m = id.match(/^r(\d+)$/);
      if (m) {
        var r = Number(m[1]);
        if (r >= 1) {
          sh.getRange(r, COL_TIME).clearContent();   // B
          sh.getRange(r, COL_NAME).clearContent();   // D
          sh.getRange(r, COL_TYPE).clearContent();   // F
        }
      }
      return json_({ ok: true, bookings: readAll_(sh) });
    }

    return json_({ ok: false, error: 'azione sconosciuta' });
  } finally {
    lock.releaseLock();
  }
}

// ─── Reset settimanale ──────────────────────────────────────────────────────
// Svuota orario (B), nome (D) e tipo (F) di TUTTE le righe — le etichette dei
// giorni in colonna A e le colonne C/E NON vengono toccate. Stesso nome della
// versione precedente: il trigger a tempo è collegato a QUESTA funzione, quindi
// NON rinominarla.
function clearRange() {
  var sh = grid_();
  var last = Math.max(sh.getLastRow(), 1);
  sh.getRange(1, COL_TIME, last, 1).clearContent();   // B
  sh.getRange(1, COL_NAME, last, 1).clearContent();   // D
  sh.getRange(1, COL_TYPE, last, 1).clearContent();   // F
}
