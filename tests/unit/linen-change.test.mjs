// Unit test del modulo Linen Change — SENZA rete, SENZA Supabase.
// Stesso principio di theme.test.mjs / laundry.test.mjs.
//
//   node tests/unit/linen-change.test.mjs

import { getLinenChangeAnchor } from "../../src/modules/linen-change/application/getLinenChangeAnchor.js";
import { setLinenChangeAnchor } from "../../src/modules/linen-change/application/setLinenChangeAnchor.js";
import { setLinenChangeSkip } from "../../src/modules/linen-change/application/setLinenChangeSkip.js";
import { authorize } from "../../src/modules/linen-change/domain/policy.js";
import { isValidTipo, isTuesdayISO } from "../../src/modules/linen-change/domain/schedule.js";

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

function fakeRepository(initial = { ok: true, ancora_data: null, ancora_tipo: null }) {
  const calls = [];
  let stato = initial;
  return {
    calls,
    async adminGet() { calls.push({ name: "adminGet" }); return stato; },
    async setAnchor(args) {
      calls.push({ name: "setAnchor", args });
      stato = { ancora_data: args.data, ancora_tipo: args.tipo };
      return { ok: true, ancora_data: args.data, ancora_tipo: args.tipo };
    },
    async setSkip(args) {
      calls.push({ name: "setSkip", args });
      return { ok: true, data: args.data, salta: args.salta };
    },
  };
}

async function throws(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

/** Un repository che fallisce come rpcClient.js quando PostgREST rifiuta
 *  la chiamata (funzione inesistente, vincolo violato, ecc.): un errore con
 *  .message e .status, non un AppError già tipizzato — lo stesso che
 *  arriverebbe da una migrazione non ancora applicata. */
function repositoryCheRompe(messaggio = "Could not find the function", status = 404) {
  const err = new Error(messaggio);
  err.status = status;
  err.rpc = "linen_change_qualcosa";
  return {
    async adminGet() { throw err; },
    async setAnchor() { throw err; },
    async setSkip() { throw err; },
  };
}

// ─── isValidTipo() / isTuesdayISO() ─────────────────────────────────────────

section("isValidTipo()");
{
  check("'grande' valido", isValidTipo("grande") === true);
  check("'piccolo' valido", isValidTipo("piccolo") === true);
  check("altro non valido", isValidTipo("medio") === false);
  check("vuoto non valido", isValidTipo("") === false);
}

section("isTuesdayISO()");
{
  // 2026-09-15 è martedì (verificato: 2026-09-14 è la data odierna del
  // sistema, lunedì — vedi il system reminder della data corrente).
  check("un vero martedì passa", isTuesdayISO("2026-09-15") === true);
  check("un lunedì viene respinto", isTuesdayISO("2026-09-14") === false);
  check("un mercoledì viene respinto", isTuesdayISO("2026-09-16") === false);
  check("formato non ISO respinto", isTuesdayISO("15/09/2026") === false);
  check("stringa vuota respinta", isTuesdayISO("") === false);
  check("undefined respinto, senza sollevare", isTuesdayISO(undefined) === false);
  check("data inesistente respinta", isTuesdayISO("2026-13-99") === false);
}

// ─── getLinenChangeAnchor() ──────────────────────────────────────────────────

section("getLinenChangeAnchor()");
{
  const repo = fakeRepository({ ok: true, ancora_data: "2026-09-01", ancora_tipo: "grande" });
  const res = await getLinenChangeAnchor({}, { linenChangeRepository: repo });
  check("legge l'ancora salvata, non un valore ricalcolato",
    res.ancora_data === "2026-09-01" && res.ancora_tipo === "grande", JSON.stringify(res));
  // linen_change_admin_get() non ha mai avuto 'ok' nel suo jsonb_build_object
  // (bug corretto in migrations/041): senza, il client (adminApi.ts, che
  // controlla `data.ok`) leggeva un fallimento su OGNI lettura riuscita, e
  // mostrava "errore" invece del pannello — vedi il commento nella
  // migrazione. Qui si verifica solo che il campo, una volta che la SQL lo
  // manda, arrivi inalterato fino al client: non può tornare a sparire senza
  // che questo test se ne accorga.
  check("'ok' arriva inalterato dal repository", res.ok === true, JSON.stringify(res));
}

// ─── setLinenChangeAnchor() ──────────────────────────────────────────────────

section("setLinenChangeAnchor()");
{
  const repo = fakeRepository();
  await setLinenChangeAnchor({ data: "2026-09-15", tipo: "grande" }, { linenChangeRepository: repo });
  check("data e tipo validi passano al repository",
    repo.calls[0].name === "setAnchor"
    && repo.calls[0].args.data === "2026-09-15"
    && repo.calls[0].args.tipo === "grande");

  const errTipo = await throws(() =>
    setLinenChangeAnchor({ data: "2026-09-15", tipo: "medio" }, { linenChangeRepository: fakeRepository() }));
  check("tipo non riconosciuto respinto prima del repository", errTipo?.message === "tipo non valido");

  const errGiorno = await throws(() =>
    setLinenChangeAnchor({ data: "2026-09-14", tipo: "grande" }, { linenChangeRepository: fakeRepository() }));
  check("una data che non è martedì viene respinta", errGiorno?.message === "la data deve essere un martedì");

  const repoNonToccato = fakeRepository();
  await throws(() => setLinenChangeAnchor({ data: "2026-09-14", tipo: "grande" }, { linenChangeRepository: repoNonToccato }));
  check("e il repository non viene chiamato", repoNonToccato.calls.length === 0);
}

// ─── setLinenChangeSkip() ─────────────────────────────────────────────────────

section("setLinenChangeSkip()");
{
  const repo = fakeRepository();
  await setLinenChangeSkip({ data: "2026-09-15", salta: true }, { linenChangeRepository: repo });
  check("salta=true passa al repository così com'è",
    repo.calls[0].name === "setSkip" && repo.calls[0].args.data === "2026-09-15" && repo.calls[0].args.salta === true);

  const repo2 = fakeRepository();
  await setLinenChangeSkip({ data: "2026-09-15", salta: false }, { linenChangeRepository: repo2 });
  check("salta=false (annulla il salto) passa altrettanto",
    repo2.calls[0].args.salta === false);

  // Valori "truthy"/"falsy" arrivati dal corpo JSON (es. non booleani veri)
  // si normalizzano, non si passano grezzi.
  const repo3 = fakeRepository();
  await setLinenChangeSkip({ data: "2026-09-15", salta: undefined }, { linenChangeRepository: repo3 });
  check("salta assente diventa false, non undefined", repo3.calls[0].args.salta === false);

  const errGiorno = await throws(() =>
    setLinenChangeSkip({ data: "2026-09-14", salta: true }, { linenChangeRepository: fakeRepository() }));
  check("una data che non è martedì viene respinta", errGiorno?.message === "la data deve essere un martedì");

  const repoNonToccato = fakeRepository();
  await throws(() => setLinenChangeSkip({ data: "2026-09-14", salta: true }, { linenChangeRepository: repoNonToccato }));
  check("e il repository non viene chiamato", repoNonToccato.calls.length === 0);
}

// ─── Un fallimento della RPC arriva all'admin come diagnosi, non generico ────
//
// Prima di questo modulo, fromRpcError() era scritta ma non chiamata da
// nessuna parte: qualunque fallimento della RPC (non una validazione, che è
// già gestita prima di arrivarci) usciva come "errore del server, riprova"
// — vero anche per una migrazione non ancora applicata, il caso più comune
// in pratica. Qui si verifica che l'eccezione rilanciata sia ESPONIBILE
// (expose:true) col messaggio vero di PostgREST, non un AppError generico.

section("un errore della RPC è esponibile all'admin, non generico");
{
  const repoRotto = repositoryCheRompe("Could not find the function public.linen_change_admin_get");

  const errGet = await throws(() => getLinenChangeAnchor({}, { linenChangeRepository: repoRotto }));
  check("getLinenChangeAnchor: il messaggio vero arriva, non un generico",
    errGet?.message === "Could not find the function public.linen_change_admin_get");
  check("ed è marcato esponibile", errGet?.expose === true);

  const errSet = await throws(() =>
    setLinenChangeAnchor({ data: "2026-09-15", tipo: "grande" }, { linenChangeRepository: repoRotto }));
  check("setLinenChangeAnchor: stesso comportamento dopo la validazione", errSet?.expose === true);

  const errSkip = await throws(() =>
    setLinenChangeSkip({ data: "2026-09-15", salta: true }, { linenChangeRepository: repoRotto }));
  check("setLinenChangeSkip: stesso comportamento dopo la validazione", errSkip?.expose === true);

  // Una ValidationError (input rifiutato PRIMA di toccare il repository)
  // non deve passare da questo giro: è già esponibile per conto suo, e
  // avvolgerla di nuovo l'avrebbe solo complicata senza motivo.
  const errValidazione = await throws(() =>
    setLinenChangeAnchor({ data: "2026-09-14", tipo: "grande" }, { linenChangeRepository: repoRotto }));
  check("una ValidationError resta quella che è, non passa dalla RPC",
    errValidazione?.message === "la data deve essere un martedì" && errValidazione?.code === "validation_error");
}

// ─── Policy di autorizzazione ────────────────────────────────────────────────

section("authorize() — policy del modulo Linen Change");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };
  const sistemista = { u: "peach", r: "sistemista" };

  check("FDO può leggere l'ancora", authorize(fdo, "cambioBiancheriaGet") === true);
  check("FDO può spostare l'ancora", authorize(fdo, "cambioBiancheriaSet") === true);
  check("FDO può saltare un martedì", authorize(fdo, "cambioBiancheriaSkip") === true);
  check("sistemista può leggere l'ancora", authorize(sistemista, "cambioBiancheriaGet") === true);
  check("sistemista può spostare l'ancora", authorize(sistemista, "cambioBiancheriaSet") === true);
  check("sistemista può saltare un martedì", authorize(sistemista, "cambioBiancheriaSkip") === true);

  // La distinzione che conta: a differenza del tema (solo sistemista), qui
  // è lo STAFF a restare fuori — la stessa regola di setMachineStatus in
  // laundry/domain/policy.js, non l'opposto di quella del tema.
  check("staff non può leggere l'ancora", authorize(staff, "cambioBiancheriaGet") === false);
  check("staff non può spostare l'ancora", authorize(staff, "cambioBiancheriaSet") === false);
  check("staff non può saltare un martedì", authorize(staff, "cambioBiancheriaSkip") === false);

  // I permessi del delegato stanno per intero nel modulo Grigliata.
  const delegato = { u: "toad", r: "delegato" };
  check("il delegato non può leggere l'ancora", authorize(delegato, "cambioBiancheriaGet") === false);
  check("il delegato non può spostare l'ancora", authorize(delegato, "cambioBiancheriaSet") === false);

  check("nessuno non autenticato può agire", authorize(null, "cambioBiancheriaGet") === false);
  check("azione di un altro modulo -> null", authorize(sistemista, "temaGet") === null);
}

// ─── Esito ────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
