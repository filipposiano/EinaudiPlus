/**
 * Apps Script per le SALE A FASCE LIBERE (Cinema / Musica).
 *
 * A DIFFERENZA della versione precedente, questo script legge e scrive
 * DIRETTAMENTE sulla griglia leggibile del foglio (quella che compilate a mano),
 * non più su un foglio di servizio "Bookings". Così l'app e il foglio mostrano
 * sempre le stesse prenotazioni.
 *
 * Layout della griglia (foglio principale = prima scheda):
 *   • 7 blocchi (un giorno ciascuno) da 6 righe libere, con 1 riga vuota di
 *     separazione tra un giorno e l'altro:
 *       Lun  righe  2–7    Mar  righe  9–14   Mer  righe 16–21   Gio righe 23–28
 *       Ven  righe 30–35   Sab  righe 37–42   Dom  righe 44–49
 *   • Colonna B = orario, intervallo testuale tipo "18:00-20:00" (o "18:00 - 20:00")
 *   • Colonna C = nome di chi prenota
 *   • Colonna D = tipo (solo Cinema): "Riservata" / "Pubblica" — vuota per la Musica
 *
 * Deploy: Estensioni → Apps Script, incolla questo file in OGNI foglio (cinema e
 * musica), poi Deploy → Nuova distribuzione → "App web" (Esegui come: te stesso;
 * Accesso: chiunque). L'URL /exec va in roomsApi.ts.
 *
 * Le prenotazioni si resettano ogni LUNEDÌ notte (controllo settimana ISO).
 */

var TOKEN = 'filipposiano';

// ─── Geometria della griglia ────────────────────────────────────────────────
var FIRST_ROW   = 2;   // prima riga del blocco di Lunedì
var ROWS_PER_DAY = 6;  // righe libere per ogni giorno (max 6 prenotazioni/giorno)
var DAY_STRIDE  = 7;   // distanza in righe tra l'inizio di un giorno e il successivo
var COL_TIME = 2;      // B
var COL_NAME = 3;      // C
var COL_TYPE = 4;      // D
var LAST_ROW = FIRST_ROW + 6 * DAY_STRIDE + ROWS_PER_DAY - 1; // = 49 (Domenica)

// Foglio su cui lavorare: la prima scheda della cartella.
function grid_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

// Riga assoluta del foglio per (giorno 0..6, offset 0..5).
function rowFor_(day, offset) {
  return FIRST_ROW + day * DAY_STRIDE + offset;
}

// ─── Helpers orario ─────────────────────────────────────────────────────────
function pad2_(n) { return (n < 10 ? '0' : '') + n; }

// "18:00-20:00" / "18.00 - 20:00" → { start, end } in minuti, oppure null.
function parseRange_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var s = String(v);
  var m = s.match(/(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  var start = Number(m[1]) * 60 + Number(m[2]);
  var end   = Number(m[3]) * 60 + Number(m[4]);
  if (!(end > start)) return null;
  return { start: start, end: end };
}

function fmtMin_(min) { return pad2_(Math.floor(min / 60)) + ':' + pad2_(min % 60); }
function fmtRange_(start, end) { return fmtMin_(start) + '-' + fmtMin_(end); }

// Etichetta colonna D → tipo dell'app ("open" | "private" | undefined).
function parseType_(v) {
  var s = String(v || '').toLowerCase().trim();
  if (!s) return undefined;
  if (s.indexOf('pubbl') >= 0 || s.indexOf('apert') >= 0 || s === 'open') return 'open';
  return 'private';
}
// tipo dell'app → etichetta colonna D.
function typeLabel_(type) {
  if (type === 'open') return 'Pubblica';
  if (type === 'private') return 'Riservata';
  return '';
}

// ─── Reset settimanale (lunedì notte) ───────────────────────────────────────
function isoWeekKey_(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  var firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  var week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() + '-' + week;
}

function resetIfNewWeek_(sh) {
  var props = PropertiesService.getDocumentProperties();
  var cur = isoWeekKey_(new Date());
  if (props.getProperty('weekKey') !== cur) {
    sh.getRange(FIRST_ROW, COL_TIME, LAST_ROW - FIRST_ROW + 1, 3).clearContent();
    props.setProperty('weekKey', cur);
  }
}

// ─── Lettura di tutte le prenotazioni dalla griglia ─────────────────────────
function readAll_(sh) {
  var nRows = LAST_ROW - FIRST_ROW + 1;
  var values = sh.getRange(FIRST_ROW, COL_TIME, nRows, 3).getValues(); // [B,C,D]
  var out = [];
  for (var day = 0; day < 7; day++) {
    for (var off = 0; off < ROWS_PER_DAY; off++) {
      var row = rowFor_(day, off);
      var idx = row - FIRST_ROW;            // indice nell'array values
      var range = parseRange_(values[idx][0]);
      var name  = String(values[idx][1] || '').trim();
      if (!range || !name) continue;        // riga vuota o incompleta → ignora
      out.push({
        id: 'r' + row,                      // id stabile = numero di riga
        day: day,
        start: range.start,
        end: range.end,
        name: name,
        type: parseType_(values[idx][2])
      });
    }
  }
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Endpoint ───────────────────────────────────────────────────────────────
function doGet(e) {
  if (!e || e.parameter.token !== TOKEN) return json_({ ok: false, error: 'unauthorized' });
  var sh = grid_(); resetIfNewWeek_(sh);
  return json_({ ok: true, bookings: readAll_(sh) });
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
    var sh = grid_(); resetIfNewWeek_(sh);

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
      var freeRow = -1;
      for (var off = 0; off < ROWS_PER_DAY; off++) {
        var row = rowFor_(day, off);
        var t = sh.getRange(row, COL_TIME).getValue();
        var n = sh.getRange(row, COL_NAME).getValue();
        if (String(t || '').trim() === '' && String(n || '').trim() === '') { freeRow = row; break; }
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
        if (r >= FIRST_ROW && r <= LAST_ROW) {
          sh.getRange(r, COL_TIME, 1, 3).clearContent();
        }
      }
      return json_({ ok: true, bookings: readAll_(sh) });
    }

    return json_({ ok: false, error: 'azione sconosciuta' });
  } finally {
    lock.releaseLock();
  }
}

// ─── Utility manuale: svuota tutta la griglia ───────────────────────────────
function clearRange() {
  grid_().getRange(FIRST_ROW, COL_TIME, LAST_ROW - FIRST_ROW + 1, 3).clearContent();
}
