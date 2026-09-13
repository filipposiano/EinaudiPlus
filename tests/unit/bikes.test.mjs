// Unit test del modulo Bikes — SENZA rete, SENZA Supabase.
//
//   node tests/unit/bikes.test.mjs

import { getBike } from "../../src/modules/bikes/application/getBike.js";
import { setBike } from "../../src/modules/bikes/application/setBike.js";
import { adminListBikes } from "../../src/modules/bikes/application/adminListBikes.js";
import { adminPurgeBikes } from "../../src/modules/bikes/application/adminPurgeBikes.js";
import { adminDeleteBikeRoom } from "../../src/modules/bikes/application/adminDeleteBikeRoom.js";
import { adminAddBikeRoom } from "../../src/modules/bikes/application/adminAddBikeRoom.js";
import { authorize } from "../../src/modules/bikes/domain/policy.js";

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

function fakeRepository(overrides = {}) {
  const calls = [];
  return {
    calls,
    async get(room) { calls.push({ name: "get", room }); return { has_bike: true, creato_da: "residente" }; },
    async set(room, hasBike) { calls.push({ name: "set", room, hasBike }); return { has_bike: hasBike }; },
    async adminList() { calls.push({ name: "adminList" }); return []; },
    async purge() { calls.push({ name: "purge" }); return { ok: true }; },
    async deleteRoom(room) { calls.push({ name: "deleteRoom", room }); return overrides.deleteResult ?? { deleted: true }; },
    async adminSet(room) { calls.push({ name: "adminSet", room }); return overrides.setResult ?? { inserted: true }; },
  };
}

function fakeNotify() {
  const calls = [];
  return { calls, fn: async (...args) => { calls.push(args); } };
}

// ─── getBike() / setBike() ──────────────────────────────────────────────────

section("getBike() / setBike()");
{
  const repo = fakeRepository();
  await getBike({ room: "112" }, { bikeRepository: repo });
  check("lettura valida passa la camera", repo.calls[0].room === "112");

  const err = await throws(() => getBike({ room: "../etc" }, { bikeRepository: fakeRepository() }));
  check("camera malformata respinta (get)", err?.message === "camera non valida");

  const repo2 = fakeRepository();
  await setBike({ room: "112", hasBike: true }, { bikeRepository: repo2 });
  check("scrittura valida passa camera e valore", repo2.calls[0].room === "112" && repo2.calls[0].hasBike === true);

  const err2 = await throws(() => setBike({ room: "", hasBike: true }, { bikeRepository: fakeRepository() }));
  check("camera assente respinta (set)", err2?.message === "camera non valida");
}

// ─── adminListBikes() / adminPurgeBikes() ───────────────────────────────────

section("adminListBikes() / adminPurgeBikes()");
{
  const repo = fakeRepository();
  await adminListBikes({}, { bikeRepository: repo });
  check("elenco chiama il repository", repo.calls[0].name === "adminList");

  const repo2 = fakeRepository();
  await adminPurgeBikes({}, { bikeRepository: repo2 });
  check("pulizia totale chiama il repository", repo2.calls[0].name === "purge");
}

// ─── adminDeleteBikeRoom() ───────────────────────────────────────────────────

section("adminDeleteBikeRoom()");
{
  const notify = fakeNotify();
  const repo = fakeRepository({ deleteResult: { deleted: true } });
  await adminDeleteBikeRoom({ room: "112" }, { bikeRepository: repo, notifyRoom: notify.fn });
  check("bici davvero rimossa -> avvisa il residente", notify.calls.length === 1);
  check("titolo giusto nell'avviso", notify.calls[0][1] === "Bici rimossa");

  const notify2 = fakeNotify();
  const repoNoOp = fakeRepository({ deleteResult: { deleted: false } });
  await adminDeleteBikeRoom({ room: "112" }, { bikeRepository: repoNoOp, notifyRoom: notify2.fn });
  check("nessuna bici da togliere -> nessun avviso", notify2.calls.length === 0);

  const err = await throws(() => adminDeleteBikeRoom({ room: "xyz" }, { bikeRepository: fakeRepository(), notifyRoom: fakeNotify().fn }));
  check("camera non valida respinta", err?.message === "numero di camera non valido");
}

// ─── adminAddBikeRoom() ──────────────────────────────────────────────────────

section("adminAddBikeRoom()");
{
  const notify = fakeNotify();
  const repo = fakeRepository({ setResult: { inserted: true } });
  const risultato = await adminAddBikeRoom({ room: "112" }, { bikeRepository: repo, notifyRoom: notify.fn });
  check("bici davvero inserita -> avvisa il residente", notify.calls.length === 1);
  check("risultato riporta inserted", risultato.inserted === true);

  const notify2 = fakeNotify();
  const repoGiaPresente = fakeRepository({ setResult: { inserted: false } });
  const risultato2 = await adminAddBikeRoom({ room: "112" }, { bikeRepository: repoGiaPresente, notifyRoom: notify2.fn });
  check("bici già segnata -> nessun avviso doppio", notify2.calls.length === 0);
  check("risultato riporta inserted:false", risultato2.inserted === false);
}

// ─── Policy di autorizzazione ──────────────────────────────────────────────────

section("authorize() — policy del modulo Bikes");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };
  const sistemista = { u: "peach", r: "sistemista" };

  check("FDO può leggere l'elenco bici", authorize(fdo, "biciList") === true);
  check("staff NON può leggere l'elenco bici", authorize(staff, "biciList") === false);
  check("FDO non può fare la pulizia totale", authorize(fdo, "biciPurge") === false);
  check("sistemista può fare la pulizia totale", authorize(sistemista, "biciPurge") === true);
  check("solo sistemista può assegnare una bici", authorize(fdo, "biciAddRoom") === false && authorize(sistemista, "biciAddRoom") === true);

  check("nessuno non autenticato può agire", authorize(null, "biciList") === false);
  check("azione di un altro modulo -> null", authorize(sistemista, "temaSet") === null);
}

// ─── Esito ────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
