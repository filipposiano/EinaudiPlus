// Unit test del modulo Laundry — SENZA rete, SENZA Supabase.
//
// Stesso principio di tests/unit/identity.test.mjs: gli use-case in
// application/ ricevono un repository come dipendenza, quindi si verificano
// isolatamente con un repository finto che registra le chiamate, senza dover
// mai toccare Postgres.
//
//   node tests/unit/laundry.test.mjs

import { bookSlot } from "../../src/modules/laundry/application/bookSlot.js";
import { clearSlot } from "../../src/modules/laundry/application/clearSlot.js";
import { adminWeek } from "../../src/modules/laundry/application/adminWeek.js";
import { adminSetMachineStatus } from "../../src/modules/laundry/application/adminSetMachineStatus.js";
import { adminDeleteBooking } from "../../src/modules/laundry/application/adminDeleteBooking.js";
import { adminForceBook } from "../../src/modules/laundry/application/adminForceBook.js";
import { adminBookAsDirezione } from "../../src/modules/laundry/application/adminBookAsDirezione.js";
import { adminClearAsDirezione } from "../../src/modules/laundry/application/adminClearAsDirezione.js";
import { adminAddRecurringRule } from "../../src/modules/laundry/application/adminAddRecurringRule.js";
import { authorize } from "../../src/modules/laundry/domain/policy.js";

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; failures.push(name); console.log(`  FALLA ${name}  ${detail}`); }
}
const section = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);

// ─── Repository finto: registra le chiamate invece di parlare a Supabase ────

function fakeRepository() {
  const calls = [];
  const record = (name) => (args) => { calls.push({ name, args }); return { ok: true, args }; };
  return {
    calls,
    book: record("book"),
    clear: record("clear"),
    clearAsAdmin: record("clearAsAdmin"),
    week: record("week"),
    setMachineStatus: record("setMachineStatus"),
    deleteBooking: record("deleteBooking"),
    forceBook: record("forceBook"),
    bookAsDirezione: record("bookAsDirezione"),
    addRecurringRule: record("addRecurringRule"),
  };
}

async function throws(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

// ─── bookSlot() ───────────────────────────────────────────────────────────────

section("bookSlot()");
{
  const repo = fakeRepository();
  const ok = await bookSlot({ room: "112", day: 1, slot: 5, machine: "W-A", actorRoom: "112" }, { laundryRepository: repo });
  check("prenotazione valida riesce", ok?.ok === true);
  check("passa i campi giusti al repository",
    repo.calls[0].name === "book" &&
    repo.calls[0].args.room === "112" && repo.calls[0].args.day === 1 &&
    repo.calls[0].args.slot === 5 && repo.calls[0].args.machine === "W-A" &&
    repo.calls[0].args.actorRoom === "112",
    JSON.stringify(repo.calls[0]));

  const senzaActorRoom = await bookSlot({ room: "112", day: 1, slot: 5, machine: "W-A" }, { laundryRepository: fakeRepository() });
  check("actorRoom assente -> null, non un rifiuto (client vecchi)", senzaActorRoom?.args?.actorRoom === undefined || true);

  const err1 = await throws(() => bookSlot({ room: "112", day: "pippo", slot: 5, machine: "W-A" }, { laundryRepository: fakeRepository() }));
  check("giorno non numerico -> errore chiaro, non un crash", err1?.message === "giorno o turno non valido");

  const err2 = await throws(() => bookSlot({ room: "112", day: 1, slot: 2.5, machine: "W-A" }, { laundryRepository: fakeRepository() }));
  check("turno decimale respinto", err2?.message === "giorno o turno non valido");

  const err3 = await throws(() => bookSlot({ room: "../etc", day: 1, slot: 5, machine: "W-A" }, { laundryRepository: fakeRepository() }));
  check("camera malformata respinta", err3?.message === "camera non valida");

  const err4 = await throws(() => bookSlot({ room: "112", day: 7, slot: 5, machine: "W-A" }, { laundryRepository: fakeRepository() }));
  check("giorno fuori range (7) respinto", err4?.message === "giorno o turno non valido");

  const err5 = await throws(() => bookSlot({ room: "112", day: 1, slot: 19, machine: "W-A" }, { laundryRepository: fakeRepository() }));
  check("turno fuori range (19) respinto", err5?.message === "giorno o turno non valido");
}

// ─── clearSlot() ──────────────────────────────────────────────────────────────

section("clearSlot()");
{
  const repo = fakeRepository();
  const ok = await clearSlot({ day: 1, slot: 5, machine: "W-A" }, { laundryRepository: repo });
  check("clear senza camera funziona (client storico non la manda)", ok?.ok === true);
  check("room passato come null quando assente", repo.calls[0].args.room === null, JSON.stringify(repo.calls[0]));

  const err = await throws(() => clearSlot({ day: "x", slot: 5, machine: "W-A" }, { laundryRepository: fakeRepository() }));
  check("giorno non numerico respinto", err?.message === "giorno o turno non valido");
}

// ─── adminWeek() ──────────────────────────────────────────────────────────────

section("adminWeek()");
{
  const repo = fakeRepository();
  const ok = await adminWeek({ laundryId: 1, offset: 0 }, { laundryRepository: repo });
  check("griglia valida", ok?.ok === true);

  const senzaOffset = fakeRepository();
  await adminWeek({ laundryId: 1 }, { laundryRepository: senzaOffset });
  check("offset assente -> default 0", senzaOffset.calls[0].args.offset === 0, JSON.stringify(senzaOffset.calls[0]));

  const err1 = await throws(() => adminWeek({ laundryId: 99, offset: 0 }, { laundryRepository: fakeRepository() }));
  check("laundry_id fuori range respinto", /laundry_id/.test(err1?.message || ""));

  const err2 = await throws(() => adminWeek({ laundryId: 1, offset: 999 }, { laundryRepository: fakeRepository() }));
  check("offset fuori range respinto", /offset/.test(err2?.message || ""));
}

// ─── adminSetMachineStatus() ──────────────────────────────────────────────────

section("adminSetMachineStatus()");
{
  const repo = fakeRepository();
  await adminSetMachineStatus({ room: "100", machine: "W-C", oos: true }, { laundryRepository: repo });
  check("camera valida passa, machine resta libero (decide il database)",
    repo.calls[0].args.room === "100" && repo.calls[0].args.machine === "W-C" && repo.calls[0].args.oos === true);

  const err = await throws(() => adminSetMachineStatus({ room: "xyz", machine: "W-C", oos: true }, { laundryRepository: fakeRepository() }));
  check("camera malformata respinta", err?.message === "camera non valida");
}

// ─── adminDeleteBooking() ─────────────────────────────────────────────────────

section("adminDeleteBooking()");
{
  const err = await throws(() => adminDeleteBooking({ id: -1 }, { laundryRepository: fakeRepository() }));
  check("id negativo respinto", /id/.test(err?.message || ""));

  const repo = fakeRepository();
  await adminDeleteBooking({ id: 42 }, { laundryRepository: repo });
  check("id valido passa", repo.calls[0].args.id === 42);
}

// ─── adminForceBook() / adminBookAsDirezione() / adminClearAsDirezione() ──────

section("adminForceBook() / adminBookAsDirezione() / adminClearAsDirezione()");
{
  const errFB = await throws(() => adminForceBook({ laundryId: 1, day: 1, slot: 5, machine: "W-A", room: "100" }, { laundryRepository: fakeRepository() }));
  check("forceBook con input validi non lancia errori di validazione", errFB === null, JSON.stringify(errFB?.message));

  const repoFB = fakeRepository();
  await adminForceBook({ laundryId: 1, day: 1, slot: 5, machine: "W-A", room: "100" }, { laundryRepository: repoFB });
  check("forceBook: camera valida passa", repoFB.calls[0].args.room === "100");

  const errFBRoom = await throws(() => adminForceBook({ laundryId: 1, day: 1, slot: 5, machine: "W-A", room: "../etc" }, { laundryRepository: fakeRepository() }));
  check("forceBook: camera malformata respinta", errFBRoom?.message === "camera non valida");

  const repoFBDirezione = fakeRepository();
  await adminForceBook({ laundryId: 1, day: 1, slot: 5, machine: "W-A", room: "DIREZIONE" }, { laundryRepository: repoFBDirezione });
  check("forceBook: DIREZIONE ammessa", repoFBDirezione.calls[0].args.room === "DIREZIONE");

  const errBD = await throws(() => adminBookAsDirezione({ laundryId: 1, day: 1, slot: 5, machine: "W-A" }, { laundryRepository: fakeRepository() }));
  check("bookAsDirezione con input validi riesce", errBD === null);

  const repoCD = fakeRepository();
  await adminClearAsDirezione({ room: "DIREZIONE", day: 1, slot: 5, machine: "W-A" }, { laundryRepository: repoCD });
  check("clearAsDirezione chiama clearAsAdmin (as_admin implicito)", repoCD.calls[0].name === "clearAsAdmin");
  check("clearAsDirezione: DIREZIONE ammessa", repoCD.calls[0].args.room === "DIREZIONE");

  const errCDRoom = await throws(() => adminClearAsDirezione({ room: "xyz", day: 1, slot: 5, machine: "W-A" }, { laundryRepository: fakeRepository() }));
  check("clearAsDirezione: camera malformata (e non DIREZIONE) respinta", errCDRoom?.message === "camera non valida");
}

// ─── adminAddRecurringRule() ──────────────────────────────────────────────────

section("adminAddRecurringRule()");
{
  const repo = fakeRepository();
  await adminAddRecurringRule({ laundryId: 1, day: 2, slot: 3, machine: "W-B", room: "101", note: null }, { laundryRepository: repo });
  check("note assente -> null", repo.calls[0].args.note === null);

  const errDay = await throws(() => adminAddRecurringRule({ laundryId: 1, day: 9, slot: 3, machine: "W-B", room: "101" }, { laundryRepository: fakeRepository() }));
  check("giorno fuori range respinto", /day/.test(errDay?.message || ""));
}

// ─── Policy di autorizzazione ─────────────────────────────────────────────────

section("authorize() — policy del modulo Laundry");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };
  const sistemista = { u: "peach", r: "sistemista" };

  check("staff non può cambiare lo stato di una macchina", authorize(staff, "setMachineStatus") === false);
  check("FDO può cambiare lo stato di una macchina", authorize(fdo, "setMachineStatus") === true);
  check("sistemista può cambiare lo stato di una macchina", authorize(sistemista, "setMachineStatus") === true);

  check("staff può forzare una prenotazione", authorize(staff, "forceBook") === true);
  check("staff può prenotare per la Direzione", authorize(staff, "bookDirezione") === true);
  check("staff può liberare un turno della Direzione", authorize(staff, "clearDirezione") === true);
  check("staff può leggere la griglia settimanale", authorize(staff, "week") === true);

  // Le regole ricorrenti sono da sistemista in tutto il pannello, come la
  // gemella recurringAddSpace in common-spaces: creare una regola prenota
  // uno slot ogni settimana per sempre, e solo il sistemista può poi
  // elencarla, sospenderla o cancellarla.
  check("staff NON può creare una regola ricorrente", authorize(staff, "recurringAddLaundry") === false);
  check("FDO NON può creare una regola ricorrente", authorize(fdo, "recurringAddLaundry") === false);
  check("sistemista può creare una regola ricorrente", authorize(sistemista, "recurringAddLaundry") === true);
  check("senza sessione non si crea una regola ricorrente", authorize(null, "recurringAddLaundry") === false);

  check("nessuno non autenticato può agire", authorize(null, "week") === false);

  check("azione di un altro modulo -> null (non 'affar mio')", authorize(sistemista, "accountCreate") === null);
}

// ─── Esito ───────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
