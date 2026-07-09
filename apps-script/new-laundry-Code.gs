// apps-script/new-laundry-Code.gs
// Codice da inserire nel NUOVO foglio (https://docs.google.com/spreadsheets/d/1-s9ZkViZVObAKU8ceDnhvgbzqIJL9wdygvB2KGl-Bj0/edit)
// Gestisce solo "Lavatrice A" e salva i turni a righe alterne nella Colonna A.
// Questo script va pubblicato come App Web.

const TOKEN = 'filipposiano'; // Deve corrispondere al frontend
const SHEET_NAME = 'Foglio1'; // Nome del foglio dove inserire i dati
const N_SLOTS = 19; // Totale slot giornalieri

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
      
      cell.setValue(room);
      return json_({ ok: true, week: getWeek_(), status: getStatus_() });
    }
    
    if (b.action === 'clear') {
      const row = (b.slot * 2) + 2;
      const col = (b.day !== undefined ? Number(b.day) : ((new Date().getDay() + 6) % 7)) + 2;
      const cell = sh.getRange(row, col);
      cell.clearContent();
      return json_({ ok: true, week: getWeek_(), status: getStatus_() });
    }
    
    // Fallback per altre azioni (status, ecc.) che non usiamo nel nuovo foglio
    return json_({ ok: true, week: getWeek_(), status: getStatus_() });
    
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
