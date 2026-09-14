// Unit test della finestra di anteprima del lunedì prossimo — SENZA rete,
// SENZA Supabase.
//
//   node tests/unit/anteprima-lunedi.test.mjs
//
// Cosa testa e perché è duplicato invece che importato:
//
// La finestra ("da sabato 20:00 a lunedì 07:00, domenica intera compresa")
// esiste in DUE punti che devono restare d'accordo:
//   - modello.ts, computaAnteprimaLunedi() — decide cosa mostra la griglia
//   - supabase/functions.sql, laundry_preview_active() — decide su quale
//     settimana il server scrive/legge il giorno 0
//
// Il primo è TypeScript (Node non lo importa senza un loader dedicato, che
// questo progetto non ha); il secondo è SQL su Supabase (nessun database
// locale contro cui girare test). Nessuno dei due è raggiungibile da un
// test Node offline: questo file ne tiene una TERZA copia, il cui unico
// scopo è restare un riferimento scritto e verificabile del contratto — se
// cambi l'orario o il giorno in uno dei tre posti, cambialo negli altri due
// e aggiorna i casi qui sotto di conseguenza.

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

// Copia di computaAnteprimaLunedi() in modello.ts / laundry_preview_active()
// in supabase/functions.sql. Vedi il commento in cima al file.
function anteprimaAttiva(d) {
  const dow = d.getDay();   // 0=domenica … 6=sabato (nativo di Date)
  const hh  = d.getHours();
  if (dow === 6) return hh >= 20;   // sabato sera
  if (dow === 0) return true;       // domenica, tutta
  if (dow === 1) return hh < 7;     // lunedì presto: la settimana non è ancora girata
  return false;
}

section("Fuori dalla finestra");
check("venerdì sera",            anteprimaAttiva(new Date(2026, 8, 11, 23, 59)) === false);
check("sabato pomeriggio",       anteprimaAttiva(new Date(2026, 8, 12, 15, 0))  === false);
check("sabato un minuto prima",  anteprimaAttiva(new Date(2026, 8, 12, 19, 59)) === false);
check("lunedì dopo le 07:00",    anteprimaAttiva(new Date(2026, 8, 14, 7, 0))   === false);
check("lunedì mattina inoltrata", anteprimaAttiva(new Date(2026, 8, 14, 10, 0)) === false);
check("martedì",                 anteprimaAttiva(new Date(2026, 8, 15, 3, 0))  === false);

section("Dentro la finestra");
check("sabato alle 20:00 esatte", anteprimaAttiva(new Date(2026, 8, 12, 20, 0))  === true);
check("sabato notte",             anteprimaAttiva(new Date(2026, 8, 12, 23, 59)) === true);
check("domenica appena iniziata", anteprimaAttiva(new Date(2026, 8, 13, 0, 0))   === true);
check("domenica pomeriggio",      anteprimaAttiva(new Date(2026, 8, 13, 15, 0))  === true);
check("domenica sera tardi",      anteprimaAttiva(new Date(2026, 8, 13, 23, 59)) === true);
check("lunedì appena iniziato",   anteprimaAttiva(new Date(2026, 8, 14, 0, 0))   === true);
check("lunedì un minuto prima delle 07:00", anteprimaAttiva(new Date(2026, 8, 14, 6, 59)) === true);

section("Il confine finale coincide con current_laundry_week_start");
// Lo stesso spostamento di 7 ore (slot0_min) che fa girare la settimana di
// lavanderia a lunedì 07:00: la finestra deve chiudersi esattamente lì,
// altrimenti per un attimo mostrerebbe l'anteprima di una settimana già
// diventata quella corrente.
check("06:59 ancora dentro, 07:00 già fuori",
  anteprimaAttiva(new Date(2026, 8, 14, 6, 59)) === true &&
  anteprimaAttiva(new Date(2026, 8, 14, 7, 0))  === false);

// ─── Esito ────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
