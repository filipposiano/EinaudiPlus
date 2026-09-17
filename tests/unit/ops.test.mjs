// Unit test del modulo Ops — SENZA rete, SENZA Supabase.
//
//   node tests/unit/ops.test.mjs

import { getOverview } from "../../src/modules/ops/application/getOverview.js";
import { listRecurringRules } from "../../src/modules/ops/application/listRecurringRules.js";
import { setRecurringRuleActive } from "../../src/modules/ops/application/setRecurringRuleActive.js";
import { deleteRecurringRule } from "../../src/modules/ops/application/deleteRecurringRule.js";
import { applyRecurringRules } from "../../src/modules/ops/application/applyRecurringRules.js";
import { purgeData } from "../../src/modules/ops/application/purgeData.js";
import { getCounts } from "../../src/modules/ops/application/getCounts.js";
import { authorize } from "../../src/modules/ops/domain/policy.js";

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

async function throws(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

function fakeRepository() {
  const calls = [];
  const record = (name) => async (args) => { calls.push({ name, args }); return { ok: true, args }; };
  return {
    calls,
    overview: record("overview"),
    recurringList: record("recurringList"),
    recurringSetActive: record("recurringSetActive"),
    recurringDelete: record("recurringDelete"),
    applyRecurring: record("applyRecurring"),
    purge: record("purge"),
    counts: record("counts"),
  };
}

// ─── getOverview() / listRecurringRules() / getCounts() ────────────────────────

section("getOverview() / listRecurringRules() / getCounts()");
{
  const repo = fakeRepository();
  await getOverview({}, { opsRepository: repo });
  check("panoramica chiama il repository", repo.calls[0].name === "overview");

  const repo2 = fakeRepository();
  await listRecurringRules({}, { opsRepository: repo2 });
  check("elenco regole chiama il repository", repo2.calls[0].name === "recurringList");

  const repo3 = fakeRepository();
  await getCounts({}, { opsRepository: repo3 });
  check("conteggi chiama il repository", repo3.calls[0].name === "counts");
}

// ─── setRecurringRuleActive() / deleteRecurringRule() ─────────────────────────

section("setRecurringRuleActive() / deleteRecurringRule()");
{
  const repo = fakeRepository();
  await setRecurringRuleActive({ id: 3, active: false }, { opsRepository: repo });
  check("sospensione passa id e active", repo.calls[0].args.id === 3 && repo.calls[0].args.active === false);

  const err = await throws(() => setRecurringRuleActive({ id: -1, active: true }, { opsRepository: fakeRepository() }));
  check("id negativo respinto", /id/.test(err?.message || ""));

  const repo2 = fakeRepository();
  await deleteRecurringRule({ id: 4 }, { opsRepository: repo2 });
  check("cancellazione con id valido", repo2.calls[0].args.id === 4);
}

// ─── applyRecurringRules() ──────────────────────────────────────────────────────

section("applyRecurringRules()");
{
  const repo = fakeRepository();
  await applyRecurringRules({ offset: 0 }, { opsRepository: repo });
  check("offset 0 esplicito", repo.calls[0].args.offset === 0);

  const repoDefault = fakeRepository();
  await applyRecurringRules({}, { opsRepository: repoDefault });
  check("offset assente -> default 0", repoDefault.calls[0].args.offset === 0);

  const err = await throws(() => applyRecurringRules({ offset: 999 }, { opsRepository: fakeRepository() }));
  check("offset fuori range respinto", /offset/.test(err?.message || ""));
}

// ─── purgeData() ─────────────────────────────────────────────────────────────────

section("purgeData()");
{
  const repo = fakeRepository();
  await purgeData({ scope: "settimana" }, { opsRepository: repo });
  check("sala assente -> null (tutte)", repo.calls[0].args.sala === null);

  const repo2 = fakeRepository();
  await purgeData({ scope: "settimana", sala: "cinema" }, { opsRepository: repo2 });
  check("sala specifica passata come stringa, non validata qui (decide il database)", repo2.calls[0].args.sala === "cinema");
}

// ─── Policy di autorizzazione ──────────────────────────────────────────────────

section("authorize() — policy del modulo Ops");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };
  const sistemista = { u: "peach", r: "sistemista" };
  const delegato = { u: "toad", r: "delegato" };

  // I permessi del delegato stanno per intero nel modulo Grigliata.
  check("il delegato NON può leggere la panoramica", authorize(delegato, "overview") === false);
  check("il delegato non può fare la pulizia", authorize(delegato, "purge") === false);

  check("FDO può leggere la panoramica", authorize(fdo, "overview") === true);
  check("staff NON può leggere la panoramica", authorize(staff, "overview") === false);

  for (const azione of ["recurringList", "recurringSetActive", "recurringDelete", "applyRecurring", "purge", "counts"]) {
    check(`FDO non può '${azione}'`, authorize(fdo, azione) === false);
    check(`sistemista può '${azione}'`, authorize(sistemista, azione) === true);
  }

  check("nessuno non autenticato può agire", authorize(null, "purge") === false);
  check("azione di un altro modulo -> null", authorize(sistemista, "biciList") === null);
}

// ─── Esito ────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
