/**
 * Apps Script per le SALE A FASCE LIBERE (Cinema / Musica).
 *
 * Legge e scrive DIRETTAMENTE sulla griglia leggibile del foglio (quella che
 * compilate a mano). App e foglio mostrano sempre le stesse prenotazioni.
 *
 * STRUTTURA FISSA DEL FOGLIO (il giorno si ricava dalla POSIZIONE della riga,
 * quindi la colonna A è solo decorativa e può essere una cella unita):
 *
 *   Riga 1            = intestazione (ignorata)
 *   Righe  2–7        = Lunedì      (6 righe = max 6 prenotazioni)
 *   Riga  8           = vuota (separatore)
 *   Righe  9–14       = Martedì
 *   Riga 15           = vuota
 *   Righe 16–21       = Mercoledì
 *   Riga 22           = vuota
 *   Righe 23–28       = Giovedì
 *   Riga 29           = vuota
 *   Righe 30–35       = Venerdì
 *   Riga 36           = vuota
 *   Righe 37–42       = Sabato
 *   Riga 43           = vuota
 *   Righe 44–49       = Domenica
 *   → 6 righe per giorno + 1 riga vuota di separazione (passo di 7 righe).
 *
 *   Colonna A = nome del giorno (decorativa, non letta)
 *   Colonna B = orario. Formati: "18:00-20:00", "18.00-20.00", "18/20",
 *               "20.30/23.30", "21:00-00:00", e fasce oltre mezzanotte "20:00-03:00".
 *   Colonna C = libera (non usata)
 *   Colonna D = nome di chi prenota
 *   Colonna E = libera (non usata)
 *   Colonna F = tipo (solo Cinema): "R" (Riservata) / "P" (Party). Vuota per Musica.
 *
 * Deploy/aggiornamento SENZA cambiare URL: Distribuzione → Gestisci distribuzioni
 * → ✏️ → Versione: "Nuova versione" → Distribuisci (su entrambi i fogli).
 *
 * Reset settimanale (lunedì notte): TRIGGER A TEMPO collegato a clearRange()
 * (fondo file). NON rinominarla, altrimenti il trigger smette di funzionare.
 */

var TOKEN = 'filipposiano';

// ─── Geometria fissa ────────────────────────────────────────────────────────
var FIRST_ROW    = 2;   // prima riga di dati (Lunedì)
var ROWS_PER_DAY = 6;   // righe per ogni giorno (= max prenotazioni/giorno)
var DAY_STRIDE   = 7;   // 6 righe dati + 1 riga vuota di separazione
var LAST_ROW     = FIRST_ROW + 6 * DAY_STRIDE + ROWS_PER_DAY - 1; // = 49 (fine Domenica)

// Colonne (1 = A, 2 = B, …)
var COL_TIME = 2;  // B = orario
var COL_NAME = 4;  // D = nome
var COL_TYPE = 6;  // F = tipo "R"/"P" (solo Cinema)

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

// Riga assoluta del foglio per (giorno 0..6, offset 0..5).
function rowFor_(day, offset) { return FIRST_ROW + day * DAY_STRIDE + offset; }

// ─── Helpers ────────────────────────────────────────────────────────────────
function pad2_(n) { return (n < 10 ? '0' : '') + n; }

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

// ─── Lettura: il giorno si ricava dalla posizione della riga ────────────────
function readAll_(sh) {
  var nRows = LAST_ROW - FIRST_ROW + 1;
  var nCols = COL_TYPE - COL_TIME + 1;      // B..F
  var vals = sh.getRange(FIRST_ROW, COL_TIME, nRows, nCols).getValues();
  var iName = COL_NAME - COL_TIME;          // D → indice 2
  var iType = COL_TYPE - COL_TIME;          // F → indice 4
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    if (i % DAY_STRIDE >= ROWS_PER_DAY) continue; // riga vuota di separazione
    var range = parseRange_(vals[i][0]);    // B
    var name  = String(vals[i][iName] || '').trim();
    if (!range || !name) continue;          // riga senza orario o senza nome
    out.push({
      id: 'r' + (FIRST_ROW + i),            // id stabile = numero di riga
      day: Math.floor(i / DAY_STRIDE),      // 0..6 dalla posizione
      start: range.start,
      end: range.end,
      name: name,
      type: parseType_(vals[i][iType])
    });
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

      // prima riga libera nelle 6 righe del giorno
      var freeRow = -1;
      for (var off = 0; off < ROWS_PER_DAY; off++) {
        var r = rowFor_(day, off);
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
        var rr = Number(m[1]);
        if (rr >= FIRST_ROW && rr <= LAST_ROW) {
          sh.getRange(rr, COL_TIME).clearContent();   // B
          sh.getRange(rr, COL_NAME).clearContent();   // D
          sh.getRange(rr, COL_TYPE).clearContent();   // F
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
// Svuota orario (B), nome (D) e tipo (F) di tutte le righe dati — le etichette
// dei giorni (A) e le colonne C/E restano intatte. Stesso nome della versione
// precedente: il trigger a tempo è collegato a QUESTA funzione, non rinominarla.
function clearRange() {
  var sh = grid_();
  var nRows = LAST_ROW - FIRST_ROW + 1;
  sh.getRange(FIRST_ROW, COL_TIME, nRows, 1).clearContent();   // B
  sh.getRange(FIRST_ROW, COL_NAME, nRows, 1).clearContent();   // D
  sh.getRange(FIRST_ROW, COL_TYPE, nRows, 1).clearContent();   // F
}
