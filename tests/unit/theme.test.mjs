// Unit test del modulo Theme — SENZA rete, SENZA Supabase.
// Stesso principio di identity.test.mjs / laundry.test.mjs / common-spaces.test.mjs.
//
//   node tests/unit/theme.test.mjs

import { getTheme } from "../../src/modules/theme/application/getTheme.js";
import { setTheme } from "../../src/modules/theme/application/setTheme.js";
import { authorize } from "../../src/modules/theme/domain/policy.js";

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

function fakeRepository(initial = "nessuno") {
  const calls = [];
  let tema = initial;
  return {
    calls,
    async get() { calls.push({ name: "get" }); return tema; },
    async set(v) { calls.push({ name: "set", args: v }); tema = v; return { ok: true, tema }; },
  };
}

async function throws(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

// ─── getTheme() ───────────────────────────────────────────────────────────────

section("getTheme()");
{
  const repo = fakeRepository("halloween");
  const res = await getTheme({}, { themeRepository: repo });
  check("legge il tema corrente", res.ok === true && res.tema === "halloween", JSON.stringify(res));
}

// ─── setTheme() ───────────────────────────────────────────────────────────────

section("setTheme()");
{
  const repo = fakeRepository("nessuno");
  await setTheme({ tema: "natale" }, { themeRepository: repo });
  check("tema valido passa al repository", repo.calls[0].name === "set" && repo.calls[0].args === "natale");

  for (const tema of ["nessuno", "halloween", "natale"]) {
    const r = fakeRepository();
    await setTheme({ tema }, { themeRepository: r });
    check(`accetta '${tema}'`, r.calls[0]?.args === tema);
  }

  const repoInvalido = fakeRepository();
  const err = await throws(() => setTheme({ tema: "capodanno" }, { themeRepository: repoInvalido }));
  check("tema non riconosciuto respinto", err?.message === "tema non valido");
  check("e non tocca il repository", repoInvalido.calls.length === 0);

  const errVuoto = await throws(() => setTheme({ tema: "" }, { themeRepository: fakeRepository() }));
  check("tema assente respinto", errVuoto?.message === "tema non valido");
}

// ─── Policy di autorizzazione ──────────────────────────────────────────────────

section("authorize() — policy del modulo Theme");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };
  const sistemista = { u: "peach", r: "sistemista" };

  check("sistemista può leggere il tema", authorize(sistemista, "temaGet") === true);
  check("sistemista può impostare il tema", authorize(sistemista, "temaSet") === true);
  check("FDO non può leggere il tema", authorize(fdo, "temaGet") === false);
  check("FDO non può impostare il tema", authorize(fdo, "temaSet") === false);
  check("staff non può impostare il tema", authorize(staff, "temaSet") === false);

  check("nessuno non autenticato può agire", authorize(null, "temaGet") === false);
  check("azione di un altro modulo -> null", authorize(sistemista, "spaces") === null);
}

// ─── Esito ────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
