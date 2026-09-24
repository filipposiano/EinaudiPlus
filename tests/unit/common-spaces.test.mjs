// Unit test del modulo Common Spaces — SENZA rete, SENZA Supabase.
// Stesso principio di identity.test.mjs / laundry.test.mjs.
//
//   node tests/unit/common-spaces.test.mjs

import { getBookings } from "../../src/modules/common-spaces/application/getBookings.js";
import { bookSpace } from "../../src/modules/common-spaces/application/bookSpace.js";
import { clearBooking } from "../../src/modules/common-spaces/application/clearBooking.js";
import { adminGetSpacesOverview } from "../../src/modules/common-spaces/application/adminGetSpacesOverview.js";
import { adminDeleteSpaceBooking } from "../../src/modules/common-spaces/application/adminDeleteSpaceBooking.js";
import { adminBookAsDirezione } from "../../src/modules/common-spaces/application/adminBookAsDirezione.js";
import { adminAddRecurringRule } from "../../src/modules/common-spaces/application/adminAddRecurringRule.js";
import { adminSetSpaceChiuso } from "../../src/modules/common-spaces/application/adminSetSpaceChiuso.js";
import { authorize } from "../../src/modules/common-spaces/domain/policy.js";

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

function fakeRepository() {
  const calls = [];
  const record = (name) => (args) => { calls.push({ name, args }); return { ok: true, args }; };
  return {
    calls,
    bookings: record("bookings"),
    book: record("book"),
    clear: record("clear"),
    adminOverview: record("adminOverview"),
    adminDelete: record("adminDelete"),
    bookAsDirezione: record("bookAsDirezione"),
    addRecurringRule: record("addRecurringRule"),
    setChiuso: record("setChiuso"),
  };
}

async function throws(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

// ─── getBookings() ────────────────────────────────────────────────────────────

section("getBookings()");
{
  const repo = fakeRepository();
  await getBookings({ space: "cinema" }, { commonSpacesRepository: repo });
  check("sala valida passa lo slug al repository", repo.calls[0].args === "cinema", JSON.stringify(repo.calls[0]));

  const err = await throws(() => getBookings({ space: "piscina" }, { commonSpacesRepository: fakeRepository() }));
  check("sala inesistente respinta", err?.message === "sala non valida");
}

// ─── bookSpace() ──────────────────────────────────────────────────────────────

section("bookSpace()");
{
  const repo = fakeRepository();
  await bookSpace({ space: "cinema", day: 1, start: 60, end: 120, name: "prova", type: "open" }, { commonSpacesRepository: repo });
  check("prenotazione valida passa i campi giusti",
    repo.calls[0].args.space === "cinema" && repo.calls[0].args.day === 1 &&
    repo.calls[0].args.start === 60 && repo.calls[0].args.end === 120 &&
    repo.calls[0].args.name === "prova" && repo.calls[0].args.type === "open",
    JSON.stringify(repo.calls[0]));

  const repoMusic = fakeRepository();
  await bookSpace({ space: "music", day: 1, start: 60, end: 120, name: "prova", type: "qualsiasi" }, { commonSpacesRepository: repoMusic });
  check("type non riconosciuto -> null (il database lo ignora per la musica)", repoMusic.calls[0].args.type === null);

  const err1 = await throws(() => bookSpace({ space: "piscina", day: 1, start: 60, end: 120, name: "x" }, { commonSpacesRepository: fakeRepository() }));
  check("sala inesistente respinta", err1?.message === "sala non valida");

  const err2 = await throws(() => bookSpace({ space: "cinema", day: "x", start: 60, end: 120, name: "x" }, { commonSpacesRepository: fakeRepository() }));
  check("giorno non numerico respinto", err2?.message === "giorno o orario non valido");

  const err3 = await throws(() => bookSpace({ space: "cinema", day: 1, start: 60, end: 0, name: "x" }, { commonSpacesRepository: fakeRepository() }));
  check("end fuori range (0, minimo 1) respinto", err3?.message === "giorno o orario non valido");

  // end può arrivare a 2880 (oltre la mezzanotte, come per la lavanderia).
  const repoOverMidnight = fakeRepository();
  await bookSpace({ space: "music", day: 6, start: 21 * 60, end: 26 * 60, name: "notte" }, { commonSpacesRepository: repoOverMidnight });
  check("fascia oltre la mezzanotte ammessa (end=1560)", repoOverMidnight.calls[0].args.end === 1560);
}

// ─── clearBooking() ───────────────────────────────────────────────────────────

section("clearBooking()");
{
  const repo = fakeRepository();
  await clearBooking({ space: "cinema", id: "42" }, { commonSpacesRepository: repo });
  check("cancellazione valida passa sala e id", repo.calls[0].args.space === "cinema" && repo.calls[0].args.id === "42");

  const err = await throws(() => clearBooking({ space: "piscina", id: "1" }, { commonSpacesRepository: fakeRepository() }));
  check("sala inesistente respinta", err?.message === "sala non valida");
}

// ─── adminGetSpacesOverview() / adminDeleteSpaceBooking() ─────────────────────

section("adminGetSpacesOverview() / adminDeleteSpaceBooking()");
{
  const repo = fakeRepository();
  await adminGetSpacesOverview({}, { commonSpacesRepository: repo });
  check("panoramica chiama adminOverview", repo.calls[0].name === "adminOverview");

  const err = await throws(() => adminDeleteSpaceBooking({ id: -1 }, { commonSpacesRepository: fakeRepository() }));
  check("id negativo respinto", /id/.test(err?.message || ""));

  const repo2 = fakeRepository();
  await adminDeleteSpaceBooking({ id: 7 }, { commonSpacesRepository: repo2 });
  check("id valido passa", repo2.calls[0].args.id === 7);
}

// ─── adminBookAsDirezione() ────────────────────────────────────────────────────

section("adminBookAsDirezione()");
{
  const repo = fakeRepository();
  await adminBookAsDirezione({ space: "cinema", day: 1, start: 60, end: 120 }, { commonSpacesRepository: repo });
  check("prenotazione Direzione valida riesce", repo.calls[0].name === "bookAsDirezione");

  const errSalaInventata = await throws(() =>
    adminBookAsDirezione({ space: "piscina", day: 1, start: 60, end: 120 }, { commonSpacesRepository: fakeRepository() }));
  check("sala inventata respinta (come il percorso pubblico)", errSalaInventata?.message === "sala non valida");

  const err = await throws(() => adminBookAsDirezione({ space: "cinema", day: 9, start: 60, end: 120 }, { commonSpacesRepository: fakeRepository() }));
  check("giorno fuori range respinto", /day/.test(err?.message || ""));
}

// ─── adminAddRecurringRule() ───────────────────────────────────────────────────

section("adminAddRecurringRule()");
{
  const repo = fakeRepository();
  await adminAddRecurringRule({ spaceId: 2, day: 3, start: 900, end: 960, name: "Prova ricorrente", note: null }, { commonSpacesRepository: repo });
  check("regola valida passa i campi giusti",
    repo.calls[0].args.spaceId === 2 && repo.calls[0].args.name === "Prova ricorrente" && repo.calls[0].args.note === null);

  const err = await throws(() => adminAddRecurringRule({ spaceId: 99, day: 3, start: 900, end: 960, name: "x" }, { commonSpacesRepository: fakeRepository() }));
  check("space_id fuori range respinto", /space_id/.test(err?.message || ""));
}

// ─── adminSetSpaceChiuso() ─────────────────────────────────────────────────────

section("adminSetSpaceChiuso()");
{
  const repo = fakeRepository();
  await adminSetSpaceChiuso({ space: "music", chiuso: true }, { commonSpacesRepository: repo });
  check("sala valida passa slug e booleano al repository",
    repo.calls[0].args.space === "music" && repo.calls[0].args.chiuso === true, JSON.stringify(repo.calls[0]));

  const repo2 = fakeRepository();
  await adminSetSpaceChiuso({ space: "music", chiuso: undefined }, { commonSpacesRepository: repo2 });
  check("chiuso assente diventa false, non undefined", repo2.calls[0].args.chiuso === false);

  const err = await throws(() => adminSetSpaceChiuso({ space: "piscina", chiuso: true }, { commonSpacesRepository: fakeRepository() }));
  check("sala inesistente respinta", err?.message === "sala non valida");
}

// ─── Policy di autorizzazione ──────────────────────────────────────────────────

section("authorize() — policy del modulo Common Spaces");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };
  const sistemista = { u: "peach", r: "sistemista" };
  const delegato = { u: "toad", r: "delegato" };

  // I permessi del delegato stanno per intero nel modulo Grigliata.
  check("il delegato non può leggere la panoramica sale", authorize(delegato, "spaces") === false);
  check("il delegato non può cancellare una prenotazione sala", authorize(delegato, "deleteSpaceBooking") === false);

  check("staff può leggere la panoramica sale", authorize(staff, "spaces") === true);
  check("staff può cancellare una prenotazione sala", authorize(staff, "deleteSpaceBooking") === true);
  check("staff può prenotare per la Direzione", authorize(staff, "bookSpaceDirezione") === true);

  check("staff non può creare una regola ricorrente", authorize(staff, "recurringAddSpace") === false);
  check("FDO non può creare una regola ricorrente", authorize(fdo, "recurringAddSpace") === false);
  check("sistemista può creare una regola ricorrente", authorize(sistemista, "recurringAddSpace") === true);

  // Chiudere/riaprire una sala: stesso livello di setMachineStatus in
  // laundry — FDO e sistemista sì, staff e delegato no.
  check("FDO può chiudere/riaprire una sala", authorize(fdo, "spaceSetChiuso") === true);
  check("sistemista può chiudere/riaprire una sala", authorize(sistemista, "spaceSetChiuso") === true);
  check("staff NON può chiudere/riaprire una sala", authorize(staff, "spaceSetChiuso") === false);
  check("il delegato NON può chiudere/riaprire una sala", authorize(delegato, "spaceSetChiuso") === false);

  check("nessuno non autenticato può agire", authorize(null, "spaces") === false);
  check("azione di un altro modulo -> null", authorize(sistemista, "setMachineStatus") === null);
}

// ─── Esito ────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
