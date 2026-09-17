// Unit test del modulo Feedback — SENZA rete, SENZA Supabase.
//
//   node tests/unit/feedback.test.mjs

import { submitFeedback } from "../../src/modules/feedback/application/submitFeedback.js";
import { adminListFeedback } from "../../src/modules/feedback/application/adminListFeedback.js";
import { adminMarkFeedback } from "../../src/modules/feedback/application/adminMarkFeedback.js";
import { authorize } from "../../src/modules/feedback/domain/policy.js";

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
  return {
    calls,
    async add(room, text) { calls.push({ name: "add", room, text }); return { ok: true }; },
    async list({ onlyOpen, limit }) { calls.push({ name: "list", onlyOpen, limit }); return []; },
    async markHandled({ id, handled }) { calls.push({ name: "markHandled", id, handled }); return { ok: true }; },
  };
}

// ─── submitFeedback() ─────────────────────────────────────────────────────────

section("submitFeedback()");
{
  const repo = fakeRepository();
  await submitFeedback({ room: "112", text: "lavatrice guasta" }, { feedbackRepository: repo });
  check("passa camera e testo", repo.calls[0].room === "112" && repo.calls[0].text === "lavatrice guasta");

  const repo2 = fakeRepository();
  await submitFeedback({ room: "112", text: "  " }, { feedbackRepository: repo2 });
  check("nessuna validazione JS sul testo vuoto (decide il database, fedele all'originale)",
    repo2.calls[0].text === "  ");
}

// ─── adminListFeedback() ───────────────────────────────────────────────────────

section("adminListFeedback()");
{
  const repo = fakeRepository();
  await adminListFeedback({}, { feedbackRepository: repo });
  check("limit assente -> default 100", repo.calls[0].limit === 100);
  check("only_open assente -> default true", repo.calls[0].onlyOpen === true);

  // Il vecchio LIMITI (admin/data.js) rifiutava già limit>500 con un 400
  // PRIMA di arrivare al case — non lo "tagliava" (quel Math.min nel case
  // originale era già codice morto per i valori fuori range, dato che LIMITI
  // li aveva bloccati prima). Qui si replica lo stesso comportamento reale.
  const err900 = await throws(() => adminListFeedback({ limit: 900 }, { feedbackRepository: fakeRepository() }));
  check("limit oltre il tetto respinto (come faceva già LIMITI)", err900?.message?.includes("limit"), err900?.message);

  const repo2 = fakeRepository();
  await adminListFeedback({ limit: 500 }, { feedbackRepository: repo2 });
  check("limit al tetto massimo ammesso", repo2.calls[0].limit === 500);

  const err = await throws(() => adminListFeedback({ limit: "pippo" }, { feedbackRepository: fakeRepository() }));
  check("limit non numerico respinto, non NaN silenzioso", err?.message?.includes("limit"), err?.message);

  const repo3 = fakeRepository();
  await adminListFeedback({ onlyOpen: false }, { feedbackRepository: repo3 });
  check("only_open esplicito false rispettato", repo3.calls[0].onlyOpen === false);
}

// ─── adminMarkFeedback() ────────────────────────────────────────────────────────

section("adminMarkFeedback()");
{
  const repo = fakeRepository();
  await adminMarkFeedback({ id: 5, handled: true }, { feedbackRepository: repo });
  check("id e handled passati", repo.calls[0].id === 5 && repo.calls[0].handled === true);

  const err = await throws(() => adminMarkFeedback({ id: -1 }, { feedbackRepository: fakeRepository() }));
  check("id negativo respinto", /id/.test(err?.message || ""));
}

// ─── Policy di autorizzazione ──────────────────────────────────────────────────

section("authorize() — policy del modulo Feedback");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };
  const sistemista = { u: "peach", r: "sistemista" };
  const delegato = { u: "toad", r: "delegato" };

  // I permessi del delegato stanno per intero nel modulo Grigliata.
  check("il delegato NON può leggere le segnalazioni", authorize(delegato, "feedback") === false);

  check("FDO può leggere le segnalazioni", authorize(fdo, "feedback") === true);
  check("staff NON può leggere le segnalazioni", authorize(staff, "feedback") === false);
  check("staff NON può marcarle gestite", authorize(staff, "markFeedback") === false);
  check("sistemista può entrambe", authorize(sistemista, "feedback") === true && authorize(sistemista, "markFeedback") === true);

  check("nessuno non autenticato può agire", authorize(null, "feedback") === false);
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
