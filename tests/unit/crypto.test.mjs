// Unit test di src/shared/crypto — SENZA rete, SENZA env var.
//
//   node tests/unit/crypto.test.mjs

import { segretiCoincidono } from "../../src/shared/crypto/constantTime.js";

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

// ─── segretiCoincidono() ─────────────────────────────────────────────────────
//
// Il tempo costante non si verifica con un test (misurare nanosecondi dentro
// una suite darebbe solo rumore): quello lo garantisce crypto.timingSafeEqual.
// Qui si verifica che la funzione DECIDA giusto — ed e' la parte che, se
// sbagliata, apre l'endpoint invece di proteggerlo.

section("segretiCoincidono()");
{
  check("segreti identici -> vero", segretiCoincidono("abc123", "abc123") === true);
  check("segreti diversi -> falso", segretiCoincidono("abc123", "abc124") === false);

  // Lunghezze diverse: timingSafeEqual solleverebbe sui byte grezzi, per
  // questo si passa dall'impronta. Deve rispondere falso, non esplodere.
  check("lunghezze diverse -> falso, senza sollevare",
    segretiCoincidono("corto", "molto piu' lungo di cosi'") === false);
  check("il ricevuto piu' corto dell'atteso -> falso",
    segretiCoincidono("una-chiave-lunga", "una") === false);

  // Un prefisso giusto non deve valere niente: e' esattamente l'informazione
  // che l'attacco a tempo cercherebbe di estrarre un carattere alla volta.
  check("prefisso corretto ma incompleto -> falso",
    segretiCoincidono("segreto-vero", "segreto-ver") === false);

  // ── Il caso che conta davvero ──────────────────────────────────────────
  // Se una variabile d'ambiente non e' configurata, process.env.X vale
  // undefined. Una funzione che tornasse vero qui aprirebbe /api/cron e
  // /api/health a chiunque nel momento in cui qualcuno dimentica di
  // impostare CRON_SECRET su Vercel.
  check("atteso undefined -> falso", segretiCoincidono(undefined, "qualsiasi") === false);
  check("atteso null -> falso", segretiCoincidono(null, "qualsiasi") === false);
  check("atteso stringa vuota -> falso", segretiCoincidono("", "qualsiasi") === false);
  check("entrambi undefined -> falso", segretiCoincidono(undefined, undefined) === false);
  check("entrambi stringa vuota -> falso", segretiCoincidono("", "") === false);

  // Header assente: req.headers["x-cron-secret"] e' undefined.
  check("ricevuto undefined -> falso", segretiCoincidono("segreto-vero", undefined) === false);
  check("ricevuto stringa vuota -> falso", segretiCoincidono("segreto-vero", "") === false);

  // Un header ripetuto arriva come array in Node: non deve passare per
  // coincidenza di coercizione a stringa.
  check("ricevuto array -> falso", segretiCoincidono("segreto-vero", ["segreto-vero"]) === false);
  check("ricevuto oggetto -> falso", segretiCoincidono("segreto-vero", { toString: () => "segreto-vero" }) === false);

  // Caratteri non ASCII: l'impronta si calcola in utf8, non deve troncare.
  check("utf8 identico -> vero", segretiCoincidono("ciào-€-🔑", "ciào-€-🔑") === true);
  check("utf8 diverso -> falso", segretiCoincidono("ciào-€-🔑", "ciào-€-🔒") === false);
}

// ─── Esito ───────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
