// Unit test del modulo Notifications — SENZA rete, SENZA Supabase.
//
//   node tests/unit/notifications.test.mjs

import { subscribePush } from "../../src/modules/notifications/application/subscribePush.js";
import { unsubscribePush } from "../../src/modules/notifications/application/unsubscribePush.js";
import { createTelegramCode } from "../../src/modules/notifications/application/createTelegramCode.js";
import { linkTelegramByCode } from "../../src/modules/notifications/application/linkTelegramByCode.js";
import { unlinkTelegram } from "../../src/modules/notifications/application/unlinkTelegram.js";
import { adminListPushSubs } from "../../src/modules/notifications/application/adminListPushSubs.js";
import { adminDeletePushSub } from "../../src/modules/notifications/application/adminDeletePushSub.js";
import { adminDeleteTelegramSub } from "../../src/modules/notifications/application/adminDeleteTelegramSub.js";
import { adminBroadcast } from "../../src/modules/notifications/application/adminBroadcast.js";
import { sendDueReminders } from "../../src/modules/notifications/application/sendDueReminders.js";
import { notifyRoom } from "../../src/modules/notifications/application/notifyRoom.js";
import { combineReminders } from "../../src/modules/notifications/domain/reminders.js";
import { endpointAllowed } from "../../src/modules/notifications/domain/channels.js";
import { authorize } from "../../src/modules/notifications/domain/policy.js";

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

function fakeRepo() {
  const calls = [];
  const record = (name) => async (args) => { calls.push({ name, args }); return { ok: true, args }; };
  return {
    calls,
    upsertPushSub: record("upsertPushSub"),
    removePushSub: record("removePushSub"),
    createTelegramCode: record("createTelegramCode"),
    telegramLink: record("telegramLink"),
    telegramUnlink: record("telegramUnlink"),
    adminListPushSubs: record("adminListPushSubs"),
    adminDeletePushSub: record("adminDeletePushSub"),
    adminListTelegramSubs: record("adminListTelegramSubs"),
    adminDeleteTelegramSub: record("adminDeleteTelegramSub"),
    allPushSubs: async ({ room }) => (fakeRepo._pushSubs || []).filter((s) => !room || s.room === room),
    allTelegramSubs: async ({ room }) => (fakeRepo._tgSubs || []).filter((s) => !room || s.room === room),
    prunePushSubs: record("prunePushSubs"),
    notifyTargetsForRoom: async (room) => fakeRepo._targets || { push: [], telegram: [] },
    claimDueReminders: async () => fakeRepo._due || [],
    reportReminderResults: record("reportReminderResults"),
    pruneNetResponses: record("pruneNetResponses"),
  };
}

function fakeSender(outcomes = {}) {
  const calls = [];
  return {
    calls,
    _configured: outcomes.configured !== false,
    configured() { return this._configured; },
    async send(...args) {
      calls.push(args);
      if (typeof outcomes.result === "function") return outcomes.result(...args);
      return outcomes.result || "ok";
    },
  };
}

// ─── endpointAllowed() ────────────────────────────────────────────────────────

section("endpointAllowed()");
{
  check("FCM ammesso", endpointAllowed("https://fcm.googleapis.com/fcm/send/xyz"));
  check("Apple push ammesso", endpointAllowed("https://web.push.apple.com/abc"));
  check("indirizzo dei metadati cloud respinto", !endpointAllowed("http://169.254.169.254/latest/meta-data"));
  check("URL malformato respinto", !endpointAllowed("non-un-url"));
}

// ─── combineReminders() ───────────────────────────────────────────────────────

section("combineReminders()");
{
  const single = combineReminders([{ title: "T", body: "B", tag: "tag1" }]);
  check("una sola riga -> passa invariata", single.title === "T" && single.body === "B" && single.tag === "tag1");

  const stessoTitolo = combineReminders([
    { title: "Bucato", body: "riga1", tag: "a" },
    { title: "Bucato", body: "riga2", tag: "b" },
  ]);
  check("stesso titolo -> corpi uniti, titolo invariato",
    stessoTitolo.title === "Bucato" && stessoTitolo.body === "riga1\nriga2" && stessoTitolo.tag === "a+b");

  const titoliDiversi = combineReminders([
    { title: "A", body: "x", tag: "1" },
    { title: "B", body: "y", tag: "2" },
  ]);
  check("titoli diversi -> titolo generico, corpo con prefisso",
    titoliDiversi.title === "Bucato: piu' aggiornamenti" &&
    titoliDiversi.body === "A x\nB y");
}

// ─── subscribePush() ──────────────────────────────────────────────────────────

section("subscribePush()");
{
  const repo = fakeRepo();
  await subscribePush(
    { room: "112", endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "a", auth: "b" },
    { notificationsRepository: repo },
  );
  check("iscrizione valida passa la camera", repo.calls[0].args.room === "112");

  const repoDirezione = fakeRepo();
  await subscribePush(
    { room: "DIREZIONE", endpoint: "https://fcm.googleapis.com/fcm/send/x" },
    { notificationsRepository: repoDirezione },
  );
  check("DIREZIONE ammessa pur non essendo una camera vera", repoDirezione.calls[0].args.room === "DIREZIONE");

  const errEndpoint = await throws(() => subscribePush(
    { room: "112", endpoint: "http://169.254.169.254/latest/meta-data" },
    { notificationsRepository: fakeRepo() },
  ));
  check("endpoint non riconosciuto respinto", errEndpoint?.message === "endpoint di notifica non riconosciuto");

  const errRoom = await throws(() => subscribePush(
    { room: "../etc", endpoint: "https://fcm.googleapis.com/fcm/send/x" },
    { notificationsRepository: fakeRepo() },
  ));
  check("camera malformata (e non DIREZIONE) respinta", errRoom?.message === "camera non valida");
}

// ─── unsubscribePush() / createTelegramCode() / link-unlink ──────────────────

section("unsubscribePush() / createTelegramCode() / link-unlink");
{
  const repo = fakeRepo();
  await unsubscribePush({ endpoint: "https://fcm.googleapis.com/x" }, { notificationsRepository: repo });
  check("disiscrizione passa l'endpoint", repo.calls[0].args.endpoint === "https://fcm.googleapis.com/x");

  const repo2 = fakeRepo();
  await createTelegramCode({ room: "112" }, { notificationsRepository: repo2 });
  check("createTelegramCode passa la camera senza validarla (fedele all'originale)", repo2.calls[0].args.room === "112");

  const repo3 = fakeRepo();
  await linkTelegramByCode({ code: "ABC12345", chatId: "999" }, { notificationsRepository: repo3 });
  check("linkTelegramByCode passa codice e chat", repo3.calls[0].args.code === "ABC12345" && repo3.calls[0].args.chatId === "999");

  const repo4 = fakeRepo();
  await unlinkTelegram({ chatId: "999" }, { notificationsRepository: repo4 });
  check("unlinkTelegram passa la chat", repo4.calls[0].args.chatId === "999");
}

// ─── azioni admin (id) ────────────────────────────────────────────────────────

section("adminListPushSubs() / adminDeletePushSub() / adminDeleteTelegramSub()");
{
  const repo = fakeRepo();
  await adminListPushSubs({}, { notificationsRepository: repo });
  check("elenco push chiama il repository", repo.calls[0].name === "adminListPushSubs");

  const err = await throws(() => adminDeletePushSub({ id: -1 }, { notificationsRepository: fakeRepo() }));
  check("id negativo respinto (push)", /id/.test(err?.message || ""));

  const err2 = await throws(() => adminDeleteTelegramSub({ id: 0 }, { notificationsRepository: fakeRepo() }));
  check("id zero respinto (telegram)", /id/.test(err2?.message || ""));
}

// ─── adminBroadcast() ──────────────────────────────────────────────────────────

section("adminBroadcast()");
{
  const okRateLimit = async () => true;
  const bloccaRateLimit = async () => false;

  const errRate = await throws(() => adminBroadcast(
    { actor: "sysadmin1", title: "T", body: "B" },
    { notificationsRepository: fakeRepo(), pushSender: fakeSender(), telegramSender: fakeSender({ configured: false }), checkRateLimit: bloccaRateLimit },
  ));
  check("rate limit superato -> rifiutato", errRate?.message?.includes("troppi invii"), errRate?.message);
  check("status 429", errRate?.status === 429);

  const errVuoto = await throws(() => adminBroadcast(
    { actor: "sysadmin1", title: "", body: "" },
    { notificationsRepository: fakeRepo(), pushSender: fakeSender(), telegramSender: fakeSender({ configured: false }), checkRateLimit: okRateLimit },
  ));
  check("titolo/testo vuoti respinti", errVuoto?.message === "titolo e testo sono obbligatori");

  const errCanale = await throws(() => adminBroadcast(
    { actor: "sysadmin1", title: "T", body: "B" },
    { notificationsRepository: fakeRepo(), pushSender: fakeSender({ configured: false }), telegramSender: fakeSender({ configured: false }), checkRateLimit: okRateLimit },
  ));
  check("nessun canale configurato -> rifiutato", errCanale?.message === "nessun canale di notifica configurato sul server");

  const errCamera = await throws(() => adminBroadcast(
    { actor: "sysadmin1", title: "T", body: "B", room: "xyz" },
    { notificationsRepository: fakeRepo(), pushSender: fakeSender(), telegramSender: fakeSender({ configured: false }), checkRateLimit: okRateLimit },
  ));
  check("camera malformata respinta", errCamera?.message === "camera non valida");

  fakeRepo._pushSubs = [{ id: 1, endpoint: "e1", p256dh: "a", auth: "b" }, { id: 2, endpoint: "e2", p256dh: "a", auth: "b" }];
  const repoInvio = fakeRepo();
  repoInvio.allPushSubs = async () => fakeRepo._pushSubs;
  repoInvio.allTelegramSubs = async () => [];
  const pushSenderGone = fakeSender({ result: (sub) => (sub.endpoint === "e2" ? "gone" : "ok") });
  const risultato = await adminBroadcast(
    { actor: "sysadmin1", title: "Prova", body: "Corpo" },
    { notificationsRepository: repoInvio, pushSender: pushSenderGone, telegramSender: fakeSender({ configured: false }), checkRateLimit: okRateLimit },
  );
  check("invio riuscito conta totali/inviati/falliti", risultato.push.totali === 2 && risultato.push.inviati === 1 && risultato.push.falliti === 1, JSON.stringify(risultato));
  check("la subscription 'gone' viene potata", repoInvio.calls.some((c) => c.name === "prunePushSubs" && c.args.ids.includes(2)), JSON.stringify(repoInvio.calls));
}

// ─── sendDueReminders() ────────────────────────────────────────────────────────

section("sendDueReminders()");
{
  const repoVuoto = fakeRepo();
  repoVuoto.claimDueReminders = async () => [];
  const risultatoVuoto = await sendDueReminders({ graceMin: 10 }, {
    notificationsRepository: repoVuoto, pushSender: fakeSender(), telegramSender: fakeSender(),
  });
  check("nessun promemoria dovuto -> inviati 0", risultatoVuoto.inviati === 0);
  check("report comunque chiamato anche a vuoto", repoVuoto.calls.some((c) => c.name === "reportReminderResults"));

  const repo = fakeRepo();
  repo.claimDueReminders = async () => ([
    { booking_id: 1, kind: "laundry", endpoint: "ep1", p256dh: "a", auth: "b", title: "Turno", body: "tra poco", tag: "t1" },
    { booking_id: 2, kind: "laundry", endpoint: "ep1", p256dh: "a", auth: "b", title: "Turno", body: "sposta", tag: "t2" },
    { booking_id: 3, kind: "space", chat_id: "chat1", title: "Sala", body: "tra poco", tag: "s1" },
  ]);
  const push = fakeSender();
  const telegram = fakeSender();
  const risultato = await sendDueReminders({ graceMin: 10 }, {
    notificationsRepository: repo, pushSender: push, telegramSender: telegram,
  });
  check("due righe con lo stesso endpoint diventano una notifica sola", push.calls.length === 1, `chiamate push: ${push.calls.length}`);
  check("la riga per chat Telegram diventa una notifica Telegram", telegram.calls.length === 1, `chiamate telegram: ${telegram.calls.length}`);
  check("inviati conta le righe dovute, non le notifiche raggruppate", risultato.inviati === 3);

  const repoGone = fakeRepo();
  repoGone.claimDueReminders = async () => ([{ booking_id: 1, kind: "laundry", endpoint: "ep-morto", title: "T", body: "B", tag: "t" }]);
  const risultatoGone = await sendDueReminders({ graceMin: 10 }, {
    notificationsRepository: repoGone, pushSender: fakeSender({ result: "gone" }), telegramSender: fakeSender(),
  });
  check("subscription 'gone' segnalata nel conteggio", risultatoGone.subscription_rimosse === 1);
}

// ─── notifyRoom() ──────────────────────────────────────────────────────────────

section("notifyRoom()");
{
  fakeRepo._targets = { push: [{ id: 9, endpoint: "e9", p256dh: "a", auth: "b" }], telegram: [{ chat_id: "c9" }] };
  const repo = fakeRepo();
  repo.notifyTargetsForRoom = async () => fakeRepo._targets;
  const push = fakeSender();
  const telegram = fakeSender();
  await notifyRoom({ room: "112", title: "Bici registrata", body: "testo", tag: "bici" }, {
    notificationsRepository: repo, pushSender: push, telegramSender: telegram,
  });
  check("avvisa il target push", push.calls.length === 1);
  check("avvisa il target telegram", telegram.calls.length === 1);

  const repoMuto = fakeRepo();
  repoMuto.notifyTargetsForRoom = async () => { throw new Error("db giù"); };
  let esplode = false;
  try {
    await notifyRoom({ room: "112", title: "x", body: "y" }, { notificationsRepository: repoMuto, pushSender: fakeSender(), telegramSender: fakeSender() });
  } catch { esplode = true; }
  check("database irraggiungibile non fa fallire la chiamata (silenziosa)", !esplode);
}

// ─── Policy di autorizzazione ──────────────────────────────────────────────────

section("authorize() — policy del modulo Notifications");
{
  const sistemista = { u: "peach", r: "sistemista" };
  const fdo = { u: "mario", r: "fdo" };

  for (const azione of ["pushSubs", "deletePushSub", "telegramSubs", "deleteTelegramSub", "broadcastPush"]) {
    check(`sistemista può '${azione}'`, authorize(sistemista, azione) === true);
    check(`FDO non può '${azione}'`, authorize(fdo, azione) === false);
  }
  check("nessuno non autenticato può agire", authorize(null, "broadcastPush") === false);
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
