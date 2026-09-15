// Unit test del modulo Linen Change — SENZA rete, SENZA Supabase.
// Stesso principio di theme.test.mjs / laundry.test.mjs.
//
//   node tests/unit/linen-change.test.mjs

import { getLinenChangeAnchor } from "../../src/modules/linen-change/application/getLinenChangeAnchor.js";
import { setLinenChangeAnchor } from "../../src/modules/linen-change/application/setLinenChangeAnchor.js";
import { authorize } from "../../src/modules/linen-change/domain/policy.js";
import { isValidTipo, isTuesdayISO } from "../../src/modules/linen-change/domain/schedule.js";

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

function fakeRepository(initial = { ancora_data: null, ancora_tipo: null }) {
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
  };
}

async function throws(fn) {
  try { await fn(); return null; } catch (e) { return e; }
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
  const repo = fakeRepository({ ancora_data: "2026-09-01", ancora_tipo: "grande" });
  const res = await getLinenChangeAnchor({}, { linenChangeRepository: repo });
  check("legge l'ancora salvata, non un valore ricalcolato",
    res.ancora_data === "2026-09-01" && res.ancora_tipo === "grande", JSON.stringify(res));
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

// ─── Policy di autorizzazione ────────────────────────────────────────────────

section("authorize() — policy del modulo Linen Change");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };
  const sistemista = { u: "peach", r: "sistemista" };

  check("FDO può leggere l'ancora", authorize(fdo, "cambioBiancheriaGet") === true);
  check("FDO può spostare l'ancora", authorize(fdo, "cambioBiancheriaSet") === true);
  check("sistemista può leggere l'ancora", authorize(sistemista, "cambioBiancheriaGet") === true);
  check("sistemista può spostare l'ancora", authorize(sistemista, "cambioBiancheriaSet") === true);

  // La distinzione che conta: a differenza del tema (solo sistemista), qui
  // è lo STAFF a restare fuori — la stessa regola di setMachineStatus in
  // laundry/domain/policy.js, non l'opposto di quella del tema.
  check("staff non può leggere l'ancora", authorize(staff, "cambioBiancheriaGet") === false);
  check("staff non può spostare l'ancora", authorize(staff, "cambioBiancheriaSet") === false);

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
