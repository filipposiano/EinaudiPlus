import { useCallback, useEffect, useState } from "react";
import { call } from "../../admin-shared/adminApi";
import { S } from "../../admin-shared/adminStyles";

// Una riga per dispositivo (push) o per chat (Telegram) collegati: l'id
// serve a poterla togliere singolarmente, non solo a contarla.
type IscrizioneRiga = { id: number; laundry: string; room: string };
type PushSubs = { camere_totali: number; dispositivi_totali: number; iscrizioni: IscrizioneRiga[] };
type TelegramSubs = { camere_totali: number; chat_totali: number; iscrizioni: IscrizioneRiga[] };

/** Quali camere hanno le notifiche attive su un canale, con un modo di
 *  togliere una riga sola.
 *
 *  Non e' un contatore che deve tornare a zero come quello delle
 *  prenotazioni: e' solo una fotografia, per sapere quanto e' diffusa la
 *  funzione senza doverlo chiedere in giro — e per poter chiudere l'unica
 *  iscrizione di chi ha lasciato la residenza, senza azzerarle tutte con la
 *  pulizia qui sotto. Condivisa fra push e Telegram: sono la stessa lista,
 *  solo con le colonne di riepilogo diverse. */
function ListaIscrizioni({ titolo, riepilogo, righe, vuoto, onDelete }: {
  titolo: string; riepilogo: string | null; righe: IscrizioneRiga[] | null;
  vuoto: string; onDelete: (id: number) => void;
}) {
  return (
    <div style={{ ...S.card, padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", ...S.sub }}>
          {titolo}
        </p>
        <span style={{ fontSize: 12, ...S.sub, fontVariantNumeric: "tabular-nums" }}>
          {riepilogo ?? "—"}
        </span>
      </div>

      {righe && righe.length === 0 && (
        <p style={{ fontSize: 13, ...S.sub }}>{vuoto}</p>
      )}

      {righe && righe.length > 0 && (
        <div style={{ display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
          {righe.map((r) => (
            <div key={r.id}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 10, background: "var(--secondary)" }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{r.room}</span>
              <span style={{ fontSize: 11, ...S.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.laundry}</span>
              <button onClick={() => onDelete(r.id)} style={{ ...S.danger, padding: "4px 10px", fontSize: 11, flexShrink: 0 }}>
                Elimina
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Notifica manuale — push e Telegram — a tutti gli iscritti o a una sola
 *  camera (es. un pacco arrivato, un problema di quella stanza), per
 *  comunicazioni del sistemista. Non sono i promemoria automatici, che
 *  restano affari del cron. */
function InvioNotifica() {
  const [titolo, setTitolo] = useState("");
  const [testo, setTesto] = useState("");
  const [destinatario, setDestinatario] = useState<"tutti" | "camera">("tutti");
  const [room, setRoom] = useState("");
  const [busy, setBusy] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);

  const perCamera = destinatario === "camera";
  const cameraOk = !perCamera || room.trim().length > 0;

  async function invia() {
    const t = titolo.trim(), b = testo.trim(), r = room.trim();
    if (!t || !b || (perCamera && !r)) return;
    const chi = perCamera ? `alla camera ${r}` : "a tutti i dispositivi e chat iscritti";
    if (!confirm(`Inviare questa notifica ${chi}?\n\n"${t}"\n${b}`)) return;

    setBusy(true); setEsito(null);
    try {
      const res = await call<{
        push: { totali: number; inviati: number; falliti: number };
        telegram: { totali: number; inviati: number; falliti: number };
      }>("broadcastPush", { title: t, body: b, room: perCamera ? r : undefined });

      const parti: string[] = [];
      if (res.push.totali > 0) {
        parti.push(`push: ${res.push.inviati}/${res.push.totali}` + (res.push.falliti ? ` (${res.push.falliti} non raggiunti)` : ""));
      }
      if (res.telegram.totali > 0) {
        parti.push(`Telegram: ${res.telegram.inviati}/${res.telegram.totali}` + (res.telegram.falliti ? ` (${res.telegram.falliti} falliti)` : ""));
      }
      setEsito(parti.length ? "Inviata — " + parti.join(" · ")
        : perCamera ? "Quella camera non ha notifiche attive su nessun canale."
        : "Nessun dispositivo o chat ha le notifiche attive.");
      setTitolo(""); setTesto("");
    } catch (e: any) {
      setEsito("Non è riuscito: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...S.card, padding: 14, marginBottom: 16 }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", ...S.sub, marginBottom: 12 }}>
        Invia notifica
      </p>
      <p style={{ fontSize: 13, ...S.sub, marginBottom: 12 }}>
        Arriva come notifica push a chi ha attivato le notifiche della web app e come
        messaggio a chi ha collegato Telegram.
      </p>

      {/* Tutti, o una camera sola: la scelta prima del testo, cosi' si sa
          gia' chi la leggera' mentre la si scrive. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["tutti", "camera"] as const).map((v) => (
          <button key={v} type="button" disabled={busy} onClick={() => setDestinatario(v)}
                  style={{
                    ...S.btn, fontSize: 12, padding: "6px 12px",
                    background: destinatario === v ? "var(--primary)" : "var(--secondary)",
                    color: destinatario === v ? "var(--primary-foreground)" : "var(--foreground)",
                    borderColor: destinatario === v ? "transparent" : "var(--border)",
                  }}>
            {v === "tutti" ? "Tutti" : "Una camera"}
          </button>
        ))}
      </div>
      {perCamera && (
        <input style={{ ...S.input, marginBottom: 8 }} placeholder="Camera (es. 112, 21-b)" value={room}
               maxLength={8} onChange={(e) => setRoom(e.target.value)} disabled={busy} />
      )}

      <input style={{ ...S.input, marginBottom: 8 }} placeholder="Titolo" value={titolo}
             maxLength={80} onChange={(e) => setTitolo(e.target.value)} disabled={busy} />
      <textarea
        style={{ ...S.input, marginBottom: 12, minHeight: 70, resize: "vertical", fontFamily: "inherit" }}
        placeholder="Testo del messaggio" value={testo} maxLength={500} disabled={busy}
        onChange={(e) => setTesto(e.target.value)}
      />
      <button onClick={invia} disabled={busy || !titolo.trim() || !testo.trim() || !cameraOk}
              style={{ ...S.btn, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "transparent", opacity: busy ? 0.6 : 1 }}>
        {busy ? "Invio…" : perCamera ? "Invia alla camera" : "Invia a tutti"}
      </button>
      {esito && <p style={{ fontSize: 13, ...S.sub, marginTop: 10 }}>{esito}</p>}
    </div>
  );
}

// ─── Notifiche (sistemista) ──────────────────────────────────────────────────
//
// Chi ha le notifiche attive, canale per canale, e l'invio manuale — push e
// Telegram, a tutti o a una sola camera. Era dentro Manutenzione, in mezzo
// alle operazioni distruttive di pulizia: due scopi diversi (guardare/inviare
// notifiche contro cancellare dati) nella stessa scheda rendevano difficile
// trovare l'uno senza scorrere l'altro.
export function Notifiche() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pushSubs, setPushSubs] = useState<PushSubs | null>(null);
  const [telegramSubs, setTelegramSubs] = useState<TelegramSubs | null>(null);

  const aggiorna = useCallback(async () => {
    try { setPushSubs(await call<PushSubs>("pushSubs")); } catch { /* solo una fotografia, non blocca niente */ }
    try { setTelegramSubs(await call<TelegramSubs>("telegramSubs")); } catch { /* idem */ }
  }, []);

  async function eliminaPush(id: number) {
    if (!confirm("Togliere questa iscrizione alle notifiche push?\n\nIl dispositivo smetterà di ricevere promemoria finché non le riattiva da solo.")) return;
    try { await call("deletePushSub", { id }); aggiorna(); }
    catch (e: any) { setMsg(e.message); }
  }

  async function eliminaTelegram(id: number) {
    if (!confirm("Scollegare questa chat Telegram?\n\nChi la usa smetterà di ricevere promemoria finché non la ricollega da solo.")) return;
    try { await call("deleteTelegramSub", { id }); aggiorna(); }
    catch (e: any) { setMsg(e.message); }
  }

  // Stesso motivo di Manutenzione: si rilegge da solo, cosi' resta vero anche
  // mentre qualcuno si iscrive o si disiscrive altrove.
  useEffect(() => {
    aggiorna();
    const t = setInterval(() => { if (!document.hidden) aggiorna(); }, 10_000);
    const alRitorno = () => { if (!document.hidden) aggiorna(); };
    document.addEventListener("visibilitychange", alRitorno);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", alRitorno); };
  }, [aggiorna]);

  return (
    <>
      {msg && <div style={{ ...S.card, padding: 12, marginBottom: 16, fontSize: 13 }}>{msg}</div>}
      <ListaIscrizioni
        titolo="Notifiche push (web app)"
        riepilogo={pushSubs ? `${pushSubs.camere_totali} camere · ${pushSubs.dispositivi_totali} dispositivi` : null}
        righe={pushSubs?.iscrizioni ?? null}
        vuoto="Nessun dispositivo ha le notifiche push attive."
        onDelete={eliminaPush}
      />
      <ListaIscrizioni
        titolo="Notifiche Telegram"
        riepilogo={telegramSubs ? `${telegramSubs.camere_totali} camere · ${telegramSubs.chat_totali} chat` : null}
        righe={telegramSubs?.iscrizioni ?? null}
        vuoto="Nessuna chat Telegram collegata."
        onDelete={eliminaTelegram}
      />
      <InvioNotifica />
    </>
  );
}
