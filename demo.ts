// demo.ts — l'app senza backend, per guardare l'interfaccia.
//
// Si accende con `VITE_DEMO=1 npm run dev` e non fa nulla in nessun altro
// caso: in produzione `import.meta.env.DEV` è `false`, il corpo di questo file
// diventa codice morto e sparisce dal bundle.
//
// A che serve: `/api` sono funzioni serverless, in sviluppo non esistono e
// vengono inoltrate alla produzione — che vuole `VITE_SECRET_TOKEN` e, se lo
// si ha, scrive sul database VERO. Per rivedere una schermata sono due
// ostacoli fuori misura. Qui `fetch` viene intercettato prima che React parta,
// e le stesse risposte le inventa una settimana finta tenuta in memoria.
//
// Non è un test: nessuno di questi dati tocca il server, e ricaricando la
// pagina si torna alla settimana di partenza. È un manichino su cui provare i
// vestiti.
//
// Per toglierlo: cancella questo file e la riga `import "./demo"` in main.tsx.

import { TIME_SLOTS, TODAY_DOW, CUR_SLOT, N_SLOTS } from "./modello";
import { DB_NOME, DB_VERSION, STORE } from "./notifiche";

if (import.meta.env.DEV && import.meta.env.VITE_SECRET_TOKEN === undefined) {
  // Nessun token e nessun VITE_DEMO: senza questo avviso si vedrebbe solo la
  // schermata "impossibile contattare il server" senza capire perché.
  console.info("[demo] nessun VITE_SECRET_TOKEN: avvia con VITE_DEMO=1 per i dati finti.");
}

if (import.meta.env.DEV && import.meta.env.VITE_DEMO === "1") {
  attiva();
}

function attiva() {
  const camera = () => {
    try { return localStorage.getItem("laundryhub.room") || "214"; } catch { return "214"; }
  };

  // ── La settimana finta ────────────────────────────────────────────────────
  //
  // Costruita attorno a ORA, non a un giorno fisso: così il turno in corso è
  // davvero in corso, il conto alla rovescia scende e la griglia ha un passato
  // e un futuro veri. Con date fisse metà delle schermate mostrerebbe stati
  // che non si incontrano mai.
  type Week = Record<string, Record<string, Record<string, string>>>;
  const week: Week = {};
  const metti = (day: number, slot: number, mid: string, room: string) => {
    if (slot < 0 || slot >= N_SLOTS || day < 0 || day > 6) return;
    week[day] ??= {};
    week[day][slot] ??= {};
    week[day][slot][mid] = room;
  };

  const ALTRE = ["108", "141", "301", "225", "118", "117", "233", "402", "119", "207", "145"];
  // Una manciata di turni altrui sparsi, deterministici: ricaricando la pagina
  // la griglia è la stessa, e si può confrontare un prima e un dopo.
  for (let d = 0; d < 7; d++) {
    for (let s = 0; s < N_SLOTS; s++) {
      const seme = (d * 31 + s * 17) % 11;
      if (seme < 3) metti(d, s, seme === 0 ? "W-A" : seme === 1 ? "W-B" : "W-C", ALTRE[(d + s) % ALTRE.length]);
    }
  }

  // I turni della camera che sta guardando: uno in corso adesso (è il riquadro
  // col conto alla rovescia), uno più avanti, uno già passato (che finisce
  // nello Storico delle prenotazioni).
  metti(TODAY_DOW, CUR_SLOT, "W-A", camera());
  metti(TODAY_DOW + 1 <= 6 ? TODAY_DOW + 1 : 0, Math.min(CUR_SLOT + 3, N_SLOTS - 1), "W-A", camera());
  metti(Math.max(0, TODAY_DOW - 1), 2, "W-B", camera());

  // Una lavatrice guasta: è l'unico modo di vedere le caselle tratteggiate e
  // l'avviso in fase di prenotazione.
  const status: Record<string, string> = { "W-C": "oos" };

  const oggiISO = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();

  // ── Le sale ───────────────────────────────────────────────────────────────
  const ora = new Date().getHours() * 60 + new Date().getMinutes();
  const arrotonda = (m: number) => Math.max(0, Math.min(23 * 60 + 30, Math.round(m / 30) * 30));
  let idSala = 1;
  const sale: Record<string, any[]> = {
    // Il cinema: occupato adesso da un'altra camera (così la barra della
    // giornata ha un blocco grigio sotto la lancetta) e una serata tua più
    // tardi, che compare in "Le mie prenotazioni".
    cinema: [
      { id: String(idSala++), day: TODAY_DOW, start: arrotonda(ora - 30), end: arrotonda(ora + 60), name: "118", type: "private" },
      { id: String(idSala++), day: TODAY_DOW, start: 21 * 60, end: 23 * 60 + 30, name: camera(), type: "open" },
    ],
    music: [
      { id: String(idSala++), day: TODAY_DOW, start: 16 * 60, end: 18 * 60, name: "301" },
    ],
  };

  // ── I dati della Direzione ────────────────────────────────────────────────
  let sessione = false;

  const macchine = (pre: string[]) => pre.flatMap((L) => ([
    { code: `W-${L}`, kind: "washer" as const, oos: status[`W-${L}`] === "oos", bookable: true },
    { code: `D-${L}`, kind: "dryer" as const,  oos: false, bookable: false },
  ]));

  const lavanderie = [
    { id: 1, slug: "valentino", name: "Valentino", rooms: "dal 100 in su", sample_room: "214",
      quota: 2, reminders: "attivi", week_start: oggiISO, bookings: 21, machines: macchine(["A", "B", "C"]) },
    { id: 2, slug: "manica", name: "Manica", rooms: "1–99", sample_room: "37",
      quota: 2, reminders: "attivi", week_start: oggiISO, bookings: 6, machines: macchine(["A"]) },
  ];

  // Le due segnalazioni del mockup: una macchina che perde acqua e una che non
  // scalda. Aperte tutte e due, così la scheda ha qualcosa da fare.
  const segnalazioni = [
    { id: 1, room: "118", body: "[GUASTO W-C] Lavatrice C segnalata non funzionante — perde acqua",
      laundry: "Valentino", created_at: new Date(Date.now() - 3 * 3600_000).toISOString(), handled: false },
    { id: 2, room: "233", body: "[GUASTO D-B] Asciugatrice B segnalata non funzionante — non scalda",
      laundry: "Valentino", created_at: new Date(Date.now() - 30 * 3600_000).toISOString(), handled: false },
  ];

  let ricorrenti: any[] = [
    { id: 1, kind: "space", day: 2, active: true, note: "Prove coro", space: "musica", start: 18 * 60, end: 20 * 60, name: "Coro" },
  ];

  let account: any[] = [
    { id: 1, username: "portineria", ruolo: "fdo", attivo: true,
      created_at: "2026-02-10T09:00:00Z", password_at: "2026-02-10T09:00:00Z", deve_cambiare_password: false },
    { id: 2, username: "sistemista", ruolo: "sistemista", attivo: true,
      created_at: "2026-01-05T09:00:00Z", password_at: "2026-06-01T09:00:00Z", deve_cambiare_password: false },
  ];

  // ── Lo storico notifiche ──────────────────────────────────────────────────
  //
  // La schermata Notifiche legge IndexedDB, che una push vera riempirebbe. Qui
  // si semina, ma solo se è vuoto: chi ha già provato una push dal pannello
  // DevTools non se la vede sotterrare da tre finte.
  seminaNotifiche();

  // ── L'intercettazione ─────────────────────────────────────────────────────
  const vero = window.fetch.bind(window);
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const corpo = (): any => { try { return JSON.parse(String(init?.body ?? "{}")); } catch { return {}; } };

    if (url.includes("/api/laundry")) {
      const b = corpo();
      switch (b.action) {
        case "book":
          if (week[b.day]?.[b.slot]?.[b.machine]) return json({ ok: false, error: "occupata", by: week[b.day][b.slot][b.machine] });
          metti(Number(b.day), Number(b.slot), String(b.machine), String(b.room));
          return json({ ok: true });
        case "clear":
          if (week[b.day]?.[b.slot]) delete week[b.day][b.slot][b.machine];
          return json({ ok: true });
        // feedback, segnalazioni, iscrizioni push: accettate e buttate. Nella
        // demo non c'è nessuno dall'altra parte a leggerle.
        case undefined: break;
        default: return json({ ok: true, code: "DEMO-1234" });
      }
      return json({ ok: true, week, status });
    }

    if (url.includes("/api/rooms")) {
      const spazio = new URL(url, location.origin).searchParams.get("space") || "cinema";
      const lista = sale[spazio] ??= [];
      const b = corpo();
      if (url.includes("action=book")) lista.push({ ...b, id: String(idSala++) });
      if (url.includes("action=clear")) sale[spazio] = lista.filter((x) => x.id !== b.id);
      return json({ ok: true, bookings: sale[spazio] });
    }

    if (url.includes("/api/conferenze")) {
      return json({
        ok: true,
        occupata_adesso: false,
        occorrenze: [
          { id: 1, titolo: "Assemblea di sezione", data: oggiISO, inizio: "18:00", fine: "20:00", ricorrente: false },
        ],
      });
    }

    // ── La Direzione ────────────────────────────────────────────────────
    //
    // La sessione vera è un cookie httpOnly firmato dal server; qui è un
    // booleano in memoria. Vale la pena dirlo forte: questa finzione esiste
    // solo dentro `import.meta.env.DEV`, e i poteri veri restano verificati
    // sul server — vedi il commento in cima ad api.ts. Entrare qui non dà
    // alcun potere su niente.
    //
    // Il ruolo è `sistemista`, il più alto: è l'unico che apre anche Account e
    // Manutenzione, e in demo si vuole poter guardare tutte le schede.
    if (url.includes("/api/admin/auth")) {
      const b = corpo();
      if (b.action === "login")  { sessione = true;  return json({ ok: true, user: b.username || "demo", role: "sistemista" }); }
      if (b.action === "logout") { sessione = false; return json({ ok: true }); }
      return json({ ok: true, logged: sessione, user: sessione ? "demo" : null, role: sessione ? "sistemista" : null });
    }

    if (url.includes("/api/admin/data")) {
      const b = corpo();
      switch (b.action) {
        case "overview":
          return json({ ok: true, laundries: lavanderie });

        // Mettere una macchina fuori servizio si vede SUBITO nella griglia dei
        // residenti: `status` è lo stesso oggetto che serve /api/laundry. È il
        // giro completo che si vuole poter provare — segnalo, la marco, la
        // trovo tratteggiata.
        case "setMachineStatus": {
          const m = lavanderie.flatMap((l) => l.machines).find((x) => x.code === b.machine);
          if (m) m.oos = Boolean(b.oos);
          if (b.oos) status[String(b.machine)] = "oos"; else delete status[String(b.machine)];
          return json({ ok: true });
        }

        case "feedback":
          return json({ ok: true, items: b.only_open ? segnalazioni.filter((f) => !f.handled) : segnalazioni });
        case "markFeedback": {
          const f = segnalazioni.find((x) => x.id === b.id);
          if (f) f.handled = Boolean(b.handled);
          return json({ ok: true });
        }

        case "recurringList":  return json({ ok: true, items: ricorrenti });
        case "recurringDelete":
          ricorrenti = ricorrenti.filter((r) => r.id !== b.id);
          return json({ ok: true });
        case "recurringSetActive": {
          const r = ricorrenti.find((x) => x.id === b.id);
          if (r) r.active = Boolean(b.active);
          return json({ ok: true });
        }
        case "recurringAddLaundry":
        case "recurringAddSpace":
          ricorrenti.push({ id: Date.now(), kind: b.action === "recurringAddLaundry" ? "laundry" : "space",
                            day: Number(b.day) || 0, active: true, note: b.note, ...b });
          return json({ ok: true });
        case "applyRecurring": return json({ ok: true, lavanderia: 2, sale: 1, saltate: 0 });

        case "accountList":    return json({ ok: true, items: account });
        case "accountDelete":
          account = account.filter((a) => a.id !== b.id);
          return json({ ok: true });
        case "accountSetActive": {
          const a = account.find((x) => x.id === b.id);
          if (a) a.attivo = Boolean(b.attivo);
          return json({ ok: true });
        }
        case "accountCreate":
          account.push({ id: Date.now(), username: String(b.username), ruolo: b.ruolo || "fdo",
                         attivo: true, created_at: new Date().toISOString(),
                         password_at: new Date().toISOString(), deve_cambiare_password: true });
          return json({ ok: true });

        case "counts":
          return json({ ok: true, settimana_dal: oggiISO,
            totale:    { lavanderia: 128, cinema: 19, musica: 24, polivalente: 7 },
            settimana: { lavanderia: 21,  cinema: 3,  musica: 4,  polivalente: 1 } });

        // Svuotare, in demo, non svuota niente: dice solo che cosa avrebbe
        // fatto. È l'unica operazione irreversibile del pannello, e una demo
        // che la esegue davvero insegna un gesto sbagliato.
        case "purge":
          return json({ ok: true, cancellati: { lavanderia: 21, cinema: 3, musica: 4, polivalente: 1 } });

        default:
          return json({ ok: true });
      }
    }

    return vero(input as any, init);
  };

  console.info("[demo] dati finti attivi: nessuna chiamata esce da questo browser.");

  function seminaNotifiche() {
    try {
      const req = indexedDB.open(DB_NOME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "ts" });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE, "readwrite");
        const st = tx.objectStore(STORE);
        const conta = st.count();
        conta.onsuccess = () => {
          if (conta.result > 0) return;
          const adesso = Date.now();
          const fine = TIME_SLOTS[Math.min(CUR_SLOT + 1, N_SLOTS - 1)];
          st.put({ ts: adesso - 60_000, title: "Lavaggio finito — l'asciugatrice A è tua",
                   body: `Sposta il bucato: hai l'asciugatrice A fino alle ${fine.end}.`,
                   kind: "washerend", url: "/", read: false });
          st.put({ ts: adesso - 40 * 60_000, title: `Il tuo turno inizia alle ${TIME_SLOTS[CUR_SLOT].start}`,
                   body: "Lavatrice A · Valentino", kind: "pre", url: "/", read: true });
          st.put({ ts: adesso - 26 * 3600_000, title: "Lavatrice C fuori servizio",
                   body: "Segnalata dalla Direzione, in attesa del tecnico.", kind: "", url: "/", read: true });
        };
        tx.oncomplete = () => db.close();
      };
    } catch { /* niente IndexedDB: la schermata Notifiche resterà vuota */ }
  }
}
