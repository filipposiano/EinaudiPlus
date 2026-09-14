// Unit test del rate limit condiviso — SENZA rete, SENZA Supabase.
//
// Il trucco è che non serve nessun finto: senza SUPABASE_URL configurata,
// rpc() solleva "database non configurato" prima di toccare la rete. È
// esattamente la condizione che interessa qui — il controllo che non
// funziona — quindi il test verifica la scelta fail-open / fail-closed
// usando il codice vero, non una sua imitazione.
//
//   node tests/unit/rate-limit.test.mjs

// Ci si assicura che il database NON sia configurato: se queste var fossero
// nell'ambiente (una .env caricata, una shell di lavoro) il test parlerebbe
// con la produzione invece che con il ramo d'errore.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

const { checkRateLimit, clientIp } = await import("../../src/shared/http/rateLimit.js");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

// ─── Comportamento quando il contatore stesso non funziona ───────────────────

section("checkRateLimit() — database irraggiungibile");
{
  const perDefault = await checkRateLimit("laundry", "1.2.3.4", 60, 600);
  check("default fail-open: le prenotazioni continuano a funzionare",
    perDefault === true, `ricevuto ${perDefault}`);

  const esplicito = await checkRateLimit("laundry", "1.2.3.4", 60, 600, { failOpen: true });
  check("failOpen: true esplicito equivale al default", esplicito === true);

  // Il motivo per cui esiste il parametro: sul login la difesa non deve
  // sparire in silenzio proprio quando il database è in difficoltà.
  const chiuso = await checkRateLimit("admin-login", "1.2.3.4", 5, 900, { failOpen: false });
  check("failOpen: false -> si nega, non si concede",
    chiuso === false, `ricevuto ${chiuso}`);

  // Un oggetto opzioni vuoto non deve cambiare il default per distrazione.
  const opzioniVuote = await checkRateLimit("laundry", "1.2.3.4", 60, 600, {});
  check("oggetto opzioni vuoto: resta fail-open", opzioniVuote === true);
}

// ─── clientIp() ──────────────────────────────────────────────────────────────
//
// Non è una difesa (x-forwarded-for è dichiarato dal client e su Vercel lo
// riscrive l'edge): è l'identificatore del contatore. Questi controlli
// servono a fissare che non torni mai undefined, il che accorperebbe tutti
// gli utenti in un unico bucket condiviso.

section("clientIp()");
{
  check("prende il primo indirizzo della catena x-forwarded-for",
    clientIp({ headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }) === "9.9.9.9");

  check("spazi attorno all'indirizzo ignorati",
    clientIp({ headers: { "x-forwarded-for": "  9.9.9.9  " } }) === "9.9.9.9");

  check("senza header si ricade sulla socket",
    clientIp({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }) === "127.0.0.1");

  check("senza nulla di utile torna una stringa, non undefined",
    clientIp({ headers: {} }) === "unknown");
}

// ─── Esito ───────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
