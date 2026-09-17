// Unit test del modulo Grigliata — SENZA rete, SENZA Supabase.
// Stesso principio di theme.test.mjs / linen-change.test.mjs.
//
//   node tests/unit/grigliata.test.mjs

import { getStatoPubblico } from "../../src/modules/grigliata/application/getStatoPubblico.js";
import { iscriviti } from "../../src/modules/grigliata/application/iscriviti.js";
import { dichiaraPagamento } from "../../src/modules/grigliata/application/dichiaraPagamento.js";
import { adminCreaEvento } from "../../src/modules/grigliata/application/adminCreaEvento.js";
import { adminOverview } from "../../src/modules/grigliata/application/adminOverview.js";
import { adminConfermaPagamento } from "../../src/modules/grigliata/application/adminConfermaPagamento.js";
import { adminChiudiEvento } from "../../src/modules/grigliata/application/adminChiudiEvento.js";
import { adminModificaEvento } from "../../src/modules/grigliata/application/adminModificaEvento.js";
import { adminAggiungiAdesione } from "../../src/modules/grigliata/application/adminAggiungiAdesione.js";
import { adminRimuoviAdesione } from "../../src/modules/grigliata/application/adminRimuoviAdesione.js";
import { adminRiapriEvento } from "../../src/modules/grigliata/application/adminRiapriEvento.js";
import { adminEliminaEvento } from "../../src/modules/grigliata/application/adminEliminaEvento.js";
import { authorize } from "../../src/modules/grigliata/domain/policy.js";
import { isValidMenu, isFutureDateTime } from "../../src/modules/grigliata/domain/validazione.js";

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
    async statoPubblico(room) { calls.push({ name: "statoPubblico", room }); return { ok: true, attiva: false }; },
    async iscrivi(args) { calls.push({ name: "iscrivi", args }); return { ok: true }; },
    async dichiaraPagamento(room) { calls.push({ name: "dichiaraPagamento", room }); return { ok: true }; },
    async adminCrea(args) { calls.push({ name: "adminCrea", args }); return { ok: true, id: 1 }; },
    async adminOverview() { calls.push({ name: "adminOverview" }); return { ok: true, evento: null, adesioni: [] }; },
    async adminConfermaPagamento(args) {
      calls.push({ name: "adminConfermaPagamento", args });
      return { ok: true, room: "214", titolo: "Grigliata di prova" };
    },
    async adminChiudi(id) { calls.push({ name: "adminChiudi", id }); return { ok: true }; },
    async adminModifica(args) { calls.push({ name: "adminModifica", args }); return { ok: true }; },
    async adminAggiungiAdesione(args) { calls.push({ name: "adminAggiungiAdesione", args }); return { ok: true }; },
    async adminRimuoviAdesione(id) { calls.push({ name: "adminRimuoviAdesione", id }); return { ok: true }; },
    async adminRiapri(id) { calls.push({ name: "adminRiapri", id }); return { ok: true }; },
    async adminElimina(id) { calls.push({ name: "adminElimina", id }); return { ok: true }; },
  };
}

function fakeNotifyRoom() {
  const calls = [];
  const fn = async (room, title, body, tag) => { calls.push({ room, title, body, tag }); };
  fn.calls = calls;
  return fn;
}

function repositoryCheRompe(messaggio = "Could not find the function") {
  const err = new Error(messaggio);
  err.status = 404;
  err.rpc = "grigliata_qualcosa";
  return {
    async adminCrea() { throw err; },
    async adminOverview() { throw err; },
    async adminConfermaPagamento() { throw err; },
    async adminChiudi() { throw err; },
    async adminModifica() { throw err; },
    async adminAggiungiAdesione() { throw err; },
    async adminRimuoviAdesione() { throw err; },
    async adminRiapri() { throw err; },
    async adminElimina() { throw err; },
  };
}

// ─── Validazioni di forma ──────────────────────────────────────────────────────

section("isValidMenu() / isFutureDateTime()");
{
  check("'classico' valido", isValidMenu("classico") === true);
  check("'vegano' valido", isValidMenu("vegano") === true);
  check("altro non valido", isValidMenu("piccante") === false);
  check("vuoto non valido", isValidMenu("") === false);

  const futuro = new Date(Date.now() + 3600_000).toISOString();
  const passato = new Date(Date.now() - 3600_000).toISOString();
  check("una data futura passa", isFutureDateTime(futuro) === true);
  check("una data passata viene respinta", isFutureDateTime(passato) === false);
  check("una stringa non-data viene respinta, senza sollevare", isFutureDateTime("non e' una data") === false);
  check("vuoto/undefined respinti", isFutureDateTime("") === false && isFutureDateTime(undefined) === false);
}

// ─── getStatoPubblico() ─────────────────────────────────────────────────────────

section("getStatoPubblico()");
{
  const repo = fakeRepository();
  await getStatoPubblico({ room: "  214  " }, { grigliataRepository: repo });
  check("la camera viene ripulita prima di passare al repository", repo.calls[0].room === "214");
}

// ─── iscriviti() ────────────────────────────────────────────────────────────────

section("iscriviti()");
{
  // v1.1: non esiste più "declinare" — aderire con un menu è l'unica azione.
  const repo = fakeRepository();
  await iscriviti({ room: "214", menu: "vegano" }, { grigliataRepository: repo });
  check("camera e menu passano al repository",
    repo.calls[0].name === "iscrivi" && repo.calls[0].args.room === "214" && repo.calls[0].args.menu === "vegano");

  const errMenu = await throws(() =>
    iscriviti({ room: "214", menu: "" }, { grigliataRepository: fakeRepository() }));
  check("senza menu viene respinto", errMenu?.message === "scegli un menu");

  const errMenuInvalido = await throws(() =>
    iscriviti({ room: "214", menu: "piccante" }, { grigliataRepository: fakeRepository() }));
  check("un menu non riconosciuto viene respinto", errMenuInvalido?.message === "scegli un menu");

  const errCamera = await throws(() =>
    iscriviti({ room: "", menu: "classico" }, { grigliataRepository: fakeRepository() }));
  check("camera mancante viene respinta", errCamera?.message === "camera mancante");

  const repoNonToccato = fakeRepository();
  await throws(() => iscriviti({ room: "214", menu: "" }, { grigliataRepository: repoNonToccato }));
  check("e il repository non viene chiamato", repoNonToccato.calls.length === 0);
}

// ─── dichiaraPagamento() ────────────────────────────────────────────────────────

section("dichiaraPagamento()");
{
  const repo = fakeRepository();
  await dichiaraPagamento({ room: " 214 " }, { grigliataRepository: repo });
  check("la camera ripulita passa al repository", repo.calls[0].room === "214");

  const err = await throws(() => dichiaraPagamento({ room: "" }, { grigliataRepository: fakeRepository() }));
  check("camera mancante viene respinta", err?.message === "camera mancante");
}

// ─── adminCreaEvento() ──────────────────────────────────────────────────────────

section("adminCreaEvento()");
{
  const futuro = new Date(Date.now() + 3600_000).toISOString();
  const repo = fakeRepository();
  await adminCreaEvento(
    { titolo: "  Grigliata di primavera  ", scadenza: futuro, paypalLink: " https://paypal.me/x ", satispayLink: "", attore: "peach" },
    { grigliataRepository: repo },
  );
  check("titolo e link vengono ripuliti prima del repository",
    repo.calls[0].args.titolo === "Grigliata di primavera"
    && repo.calls[0].args.paypal === "https://paypal.me/x"
    && repo.calls[0].args.satispay === null);

  const errScadenza = await throws(() =>
    adminCreaEvento({ titolo: "x", scadenza: "2020-01-01T00:00:00Z", paypalLink: "x", satispayLink: "", attore: "peach" },
      { grigliataRepository: fakeRepository() }));
  check("una scadenza nel passato viene respinta", errScadenza?.message === "la scadenza deve essere una data futura");

  const errLink = await throws(() =>
    adminCreaEvento({ titolo: "x", scadenza: futuro, paypalLink: "", satispayLink: "  ", attore: "peach" },
      { grigliataRepository: fakeRepository() }));
  check("senza nessun link di pagamento viene respinto",
    errLink?.message === "inserisci almeno un link per il pagamento (PayPal o Satispay)");

  const repoNonToccato = fakeRepository();
  await throws(() => adminCreaEvento({ titolo: "x", scadenza: "2020-01-01", paypalLink: "", satispayLink: "", attore: "peach" },
    { grigliataRepository: repoNonToccato }));
  check("e il repository non viene chiamato", repoNonToccato.calls.length === 0);

  // Titolo assente: ricade su 'Grigliata' — coerente col default di
  // grigliata_admin_crea() in SQL, non solo un dettaglio del client.
  const repoSenzaTitolo = fakeRepository();
  await adminCreaEvento({ titolo: "", scadenza: futuro, paypalLink: "x", satispayLink: "", attore: "peach" },
    { grigliataRepository: repoSenzaTitolo });
  check("titolo assente ricade su 'Grigliata'", repoSenzaTitolo.calls[0].args.titolo === "Grigliata");
}

// ─── adminOverview() / adminConfermaPagamento() / adminChiudiEvento() ──────────

section("adminOverview()");
{
  const repo = fakeRepository();
  const res = await adminOverview({}, { grigliataRepository: repo });
  check("passa semplicemente al repository", res.ok === true && repo.calls[0].name === "adminOverview");
}

section("adminConfermaPagamento()");
{
  const repo = fakeRepository();
  const notify = fakeNotifyRoom();
  await adminConfermaPagamento({ adesioneId: "42", attore: "peach" }, { grigliataRepository: repo, notifyRoom: notify });
  check("l'id arriva convertito in numero", repo.calls[0].args.id === 42);
  check("un esito riuscito con room notifica quella camera",
    notify.calls.length === 1 && notify.calls[0].room === "214" && notify.calls[0].tag === "grigliata-pagamento");

  const errId = await throws(() =>
    adminConfermaPagamento({ adesioneId: "non-un-numero", attore: "peach" }, { grigliataRepository: fakeRepository(), notifyRoom: fakeNotifyRoom() }));
  check("un id non numerico viene respinto prima del repository", errId?.message === "adesione non valida");

  // Un esito negativo (adesione non trovata) non deve notificare nessuno.
  const repoFallisce = { async adminConfermaPagamento() { return { ok: false, error: "adesione non trovata" }; } };
  const notifyNonChiamato = fakeNotifyRoom();
  await adminConfermaPagamento({ adesioneId: "1", attore: "peach" }, { grigliataRepository: repoFallisce, notifyRoom: notifyNonChiamato });
  check("un esito negativo non notifica nessuno", notifyNonChiamato.calls.length === 0);
}

section("adminChiudiEvento()");
{
  const repo = fakeRepository();
  await adminChiudiEvento({ eventoId: "7" }, { grigliataRepository: repo });
  check("l'id arriva convertito in numero", repo.calls[0].id === 7);

  const err = await throws(() => adminChiudiEvento({ eventoId: "x" }, { grigliataRepository: fakeRepository() }));
  check("un id non numerico viene respinto", err?.message === "evento non valido");
}

section("adminModificaEvento()");
{
  const futuro = new Date(Date.now() + 3600_000).toISOString();
  const repo = fakeRepository();
  await adminModificaEvento({ eventoId: "7", titolo: "  Grigliata corretta  ", scadenza: futuro }, { grigliataRepository: repo });
  check("l'id arriva convertito in numero, il titolo ripulito, la data come ISO",
    repo.calls[0].args.id === 7 && repo.calls[0].args.titolo === "Grigliata corretta"
    && repo.calls[0].args.scadenza === new Date(futuro).toISOString());

  const errId = await throws(() =>
    adminModificaEvento({ eventoId: "x", titolo: "x", scadenza: futuro }, { grigliataRepository: fakeRepository() }));
  check("un id non numerico viene respinto", errId?.message === "evento non valido");

  const errData = await throws(() =>
    adminModificaEvento({ eventoId: "7", titolo: "x", scadenza: "2020-01-01T00:00:00Z" }, { grigliataRepository: fakeRepository() }));
  check("una scadenza nel passato viene respinta", errData?.message === "la scadenza deve essere una data futura");

  const repoNonToccato = fakeRepository();
  await throws(() => adminModificaEvento({ eventoId: "7", titolo: "x", scadenza: "2020-01-01" }, { grigliataRepository: repoNonToccato }));
  check("e il repository non viene chiamato", repoNonToccato.calls.length === 0);

  // Titolo assente: passa vuoto al repository, che ricade su 'Grigliata'
  // lato SQL (stessa regola di adminCreaEvento) — qui non si respinge.
  const repoSenzaTitolo = fakeRepository();
  await adminModificaEvento({ eventoId: "7", titolo: "", scadenza: futuro }, { grigliataRepository: repoSenzaTitolo });
  check("titolo assente passa vuoto, non respinto", repoSenzaTitolo.calls[0].args.titolo === "");
}

section("adminAggiungiAdesione()");
{
  const repo = fakeRepository();
  await adminAggiungiAdesione({ eventoId: "7", room: " 214 ", menu: "vegano" }, { grigliataRepository: repo });
  check("l'id arriva convertito in numero, la camera ripulita, il menu passato",
    repo.calls[0].args.eventoId === 7 && repo.calls[0].args.room === "214" && repo.calls[0].args.menu === "vegano");

  const errId = await throws(() =>
    adminAggiungiAdesione({ eventoId: "x", room: "214", menu: "classico" }, { grigliataRepository: fakeRepository() }));
  check("un id di evento non numerico viene respinto", errId?.message === "evento non valido");

  const errRoom = await throws(() =>
    adminAggiungiAdesione({ eventoId: "7", room: "non una camera", menu: "classico" }, { grigliataRepository: fakeRepository() }));
  check("una camera nel formato sbagliato viene respinta", errRoom?.message === "numero di camera non valido");

  const errMenu = await throws(() =>
    adminAggiungiAdesione({ eventoId: "7", room: "214", menu: "piccante" }, { grigliataRepository: fakeRepository() }));
  check("un menu non riconosciuto viene respinto", errMenu?.message === "scegli un menu");

  const repoNonToccato = fakeRepository();
  await throws(() => adminAggiungiAdesione({ eventoId: "7", room: "x", menu: "classico" }, { grigliataRepository: repoNonToccato }));
  check("e il repository non viene chiamato", repoNonToccato.calls.length === 0);
}

section("adminRimuoviAdesione()");
{
  const repo = fakeRepository();
  await adminRimuoviAdesione({ adesioneId: "42" }, { grigliataRepository: repo });
  check("l'id arriva convertito in numero", repo.calls[0].id === 42);

  const err = await throws(() => adminRimuoviAdesione({ adesioneId: "x" }, { grigliataRepository: fakeRepository() }));
  check("un id non numerico viene respinto", err?.message === "adesione non valida");
}

section("adminRiapriEvento()");
{
  const repo = fakeRepository();
  await adminRiapriEvento({ eventoId: "9" }, { grigliataRepository: repo });
  check("l'id arriva convertito in numero", repo.calls[0].id === 9);

  const err = await throws(() => adminRiapriEvento({ eventoId: "x" }, { grigliataRepository: fakeRepository() }));
  check("un id non numerico viene respinto", err?.message === "evento non valido");
}

section("adminEliminaEvento()");
{
  const repo = fakeRepository();
  await adminEliminaEvento({ eventoId: "9" }, { grigliataRepository: repo });
  check("l'id arriva convertito in numero", repo.calls[0].id === 9);

  const err = await throws(() => adminEliminaEvento({ eventoId: "x" }, { grigliataRepository: fakeRepository() }));
  check("un id non numerico viene respinto", err?.message === "evento non valido");

  // La regola "solo un evento chiuso si elimina" è della funzione SQL, non
  // di questo use-case: qui si verifica solo che un rifiuto del repository
  // (che è quello che la SQL produrrebbe restituendo ok:false) arrivi
  // inalterato al chiamante, senza essere silenziato.
  const repoRifiuta = { async adminElimina() { return { ok: false, error: "chiudi prima la grigliata per poterla eliminare" }; } };
  const res = await adminEliminaEvento({ eventoId: "9" }, { grigliataRepository: repoRifiuta });
  check("il rifiuto della SQL (evento ancora attivo) passa inalterato",
    res.ok === false && res.error === "chiudi prima la grigliata per poterla eliminare");
}

// ─── Un fallimento della RPC arriva all'admin come diagnosi, non generico ────

section("un errore della RPC è esponibile all'admin, non generico");
{
  const repoRotto = repositoryCheRompe("Could not find the function public.grigliata_admin_overview");
  const futuro = new Date(Date.now() + 3600_000).toISOString();

  const errOverview = await throws(() => adminOverview({}, { grigliataRepository: repoRotto }));
  check("adminOverview: il messaggio vero arriva, non un generico",
    errOverview?.message === "Could not find the function public.grigliata_admin_overview");
  check("ed è marcato esponibile", errOverview?.expose === true);

  const errCrea = await throws(() =>
    adminCreaEvento({ titolo: "x", scadenza: futuro, paypalLink: "x", satispayLink: "", attore: "peach" },
      { grigliataRepository: repoRotto }));
  check("adminCreaEvento: stesso comportamento dopo la validazione", errCrea?.expose === true);

  const errConferma = await throws(() =>
    adminConfermaPagamento({ adesioneId: "1", attore: "peach" }, { grigliataRepository: repoRotto, notifyRoom: fakeNotifyRoom() }));
  check("adminConfermaPagamento: stesso comportamento dopo la validazione", errConferma?.expose === true);

  const errChiudi = await throws(() => adminChiudiEvento({ eventoId: "1" }, { grigliataRepository: repoRotto }));
  check("adminChiudiEvento: stesso comportamento dopo la validazione", errChiudi?.expose === true);

  const errModifica = await throws(() =>
    adminModificaEvento({ eventoId: "1", titolo: "x", scadenza: futuro }, { grigliataRepository: repoRotto }));
  check("adminModificaEvento: stesso comportamento dopo la validazione", errModifica?.expose === true);

  const errAggiungi = await throws(() =>
    adminAggiungiAdesione({ eventoId: "1", room: "214", menu: "classico" }, { grigliataRepository: repoRotto }));
  check("adminAggiungiAdesione: stesso comportamento dopo la validazione", errAggiungi?.expose === true);

  const errRimuovi = await throws(() =>
    adminRimuoviAdesione({ adesioneId: "1" }, { grigliataRepository: repoRotto }));
  check("adminRimuoviAdesione: stesso comportamento dopo la validazione", errRimuovi?.expose === true);

  const errRiapri = await throws(() => adminRiapriEvento({ eventoId: "1" }, { grigliataRepository: repoRotto }));
  check("adminRiapriEvento: stesso comportamento dopo la validazione", errRiapri?.expose === true);

  const errElimina = await throws(() => adminEliminaEvento({ eventoId: "1" }, { grigliataRepository: repoRotto }));
  check("adminEliminaEvento: stesso comportamento dopo la validazione", errElimina?.expose === true);
}

// ─── Policy di autorizzazione ────────────────────────────────────────────────

section("authorize() — policy del modulo Grigliata");
{
  const fdo = { u: "mario", r: "fdo" };
  const staff = { u: "luigi", r: "staff" };
  const sistemista = { u: "peach", r: "sistemista" };
  const delegato = { u: "toad", r: "delegato" };

  for (const azione of [
    "grigliataCrea", "grigliataOverview", "grigliataConfermaPagamento", "grigliataChiudi",
    "grigliataModifica", "grigliataAggiungiAdesione", "grigliataRimuoviAdesione",
    "grigliataRiapri", "grigliataElimina",
  ]) {
    check(`il delegato può '${azione}'`, authorize(delegato, azione) === true);
    check(`il sistemista può '${azione}'`, authorize(sistemista, azione) === true);
    check(`FDO NON può '${azione}'`, authorize(fdo, azione) === false);
    check(`staff NON può '${azione}'`, authorize(staff, azione) === false);
  }

  check("nessuno non autenticato può agire", authorize(null, "grigliataCrea") === false);
  check("azione di un altro modulo -> null (non 'affar mio')", authorize(delegato, "temaGet") === null);
}

// ─── Esito ────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(64));
console.log(`PASSATI: ${pass}   FALLITI: ${fail}`);
if (fail) {
  console.log("\nFalliti:");
  for (const f of failures) console.log("  · " + f);
}
process.exit(fail ? 1 : 0);
