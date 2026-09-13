// Unit test del modulo Conference Room — SENZA rete, SENZA Supabase.
//
//   node tests/unit/conference-room.test.mjs

import { getAgenda } from "../../src/modules/conference-room/application/getAgenda.js";
import { listRules } from "../../src/modules/conference-room/application/listRules.js";
import { addRule } from "../../src/modules/conference-room/application/addRule.js";
import { updateRule } from "../../src/modules/conference-room/application/updateRule.js";
import { skipOccurrence } from "../../src/modules/conference-room/application/skipOccurrence.js";
import { moveOccurrence } from "../../src/modules/conference-room/application/moveOccurrence.js";
import { resetOccurrence } from "../../src/modules/conference-room/application/resetOccurrence.js";
import { deleteRule } from "../../src/modules/conference-room/application/deleteRule.js";
import { authorize } from "../../src/modules/conference-room/domain/policy.js";

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
    agenda: record("agenda"),
    rules: record("rules"),
    add: record("add"),
    update: record("update"),
    skip: record("skip"),
    move: record("move"),
    resetOccorrenza: record("resetOccorrenza"),
    delete: record("delete"),
  };
}

// ─── getAgenda() ──────────────────────────────────────────────────────────────

section("getAgenda()");
{
  const repo = fakeRepository();
  await getAgenda({ giorni: 60 }, { conferenceRepository: repo });
  check("valore valido passato", repo.calls[0].args === 60);

  const repoDefault = fakeRepository();
  await getAgenda({ giorni: undefined }, { conferenceRepository: repoDefault });
  check("assente -> default 30", repoDefault.calls[0].args === 30);

  const repoMalformato = fakeRepository();
  await getAgenda({ giorni: "pippo" }, { conferenceRepository: repoMalformato });
  check("malformato -> ricade sul default, non viene rifiutato (fedele all'originale, sola lettura)",
    repoMalformato.calls[0].args === 30);
}

// ─── listRules() / addRule() / updateRule() ────────────────────────────────────

section("listRules() / addRule() / updateRule()");
{
  const repo = fakeRepository();
  await listRules({}, { conferenceRepository: repo });
  check("elenco chiama il repository", repo.calls[0].name === "rules");

  const repo2 = fakeRepository();
  await addRule({ titolo: "Assemblea", inizio: "18:00", fine: "20:00", dal: "2026-01-01", al: "2026-01-01", giorno: null, attore: "test" }, { conferenceRepository: repo2 });
  check("giorno assente -> null (ogni giorno del periodo)", repo2.calls[0].args.giornoSettimana === null);

  const repo3 = fakeRepository();
  await addRule({ titolo: "Riunione", inizio: "18:00", fine: "20:00", dal: "2026-01-01", al: "2026-03-01", giorno: 2 }, { conferenceRepository: repo3 });
  check("giorno valido passato", repo3.calls[0].args.giornoSettimana === 2);

  const err = await throws(() => addRule({ titolo: "x", giorno: 9 }, { conferenceRepository: fakeRepository() }));
  check("giorno fuori range respinto", /giorno/.test(err?.message || ""));

  const errUpd = await throws(() => updateRule({ id: -1, titolo: "x" }, { conferenceRepository: fakeRepository() }));
  check("id negativo respinto (update)", /id/.test(errUpd?.message || ""));
}

// ─── skipOccurrence() / moveOccurrence() / resetOccurrence() / deleteRule() ────

section("skipOccurrence() / moveOccurrence() / resetOccurrence() / deleteRule()");
{
  const repo = fakeRepository();
  await skipOccurrence({ id: 5, data: "2026-02-02", attore: "mario" }, { conferenceRepository: repo });
  check("skip passa id/data/attore", repo.calls[0].args.id === 5 && repo.calls[0].args.data === "2026-02-02");

  const repo2 = fakeRepository();
  await moveOccurrence({ id: 5, data: "2026-02-02", nuovaData: "2026-02-03" }, { conferenceRepository: repo2 });
  check("move con campi opzionali assenti -> null", repo2.calls[0].args.oraInizio === null && repo2.calls[0].args.titolo === null);

  const repo3 = fakeRepository();
  await resetOccurrence({ id: 5, data: "2026-02-02" }, { conferenceRepository: repo3 });
  check("resetOccurrence passa id/data", repo3.calls[0].args.id === 5);

  const err = await throws(() => deleteRule({ id: 0 }, { conferenceRepository: fakeRepository() }));
  check("id zero respinto (delete)", /id/.test(err?.message || ""));

  const repo4 = fakeRepository();
  await deleteRule({ id: 7 }, { conferenceRepository: repo4 });
  check("delete con id valido", repo4.calls[0].args.id === 7);
}

// ─── Policy di autorizzazione ──────────────────────────────────────────────────

section("authorize() — policy del modulo Conference Room");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };

  for (const azione of ["conferenzaList", "conferenzaAdd", "conferenzaUpdate", "conferenzaSkip", "conferenzaMove", "conferenzaResetOccorrenza", "conferenzaDelete"]) {
    check(`FDO può '${azione}'`, authorize(fdo, azione) === true);
    check(`staff può '${azione}' (nessuna restrizione, come nell'originale)`, authorize(staff, azione) === true);
  }
  check("nessuno non autenticato può agire", authorize(null, "conferenzaAdd") === false);
  check("azione di un altro modulo -> null", authorize(fdo, "spaces") === null);
}

// ─── Esito ────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
