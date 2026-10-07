// realtime.ts — avvisi in tempo reale (Supabase Realtime, solo broadcast).
//
// Il database manda un messaggio VUOTO su un canale quando qualcosa cambia
// (vedi supabase/migrations/057-grigliata-avvisi-in-tempo-reale.sql): qui lo
// si ascolta e si richiama la funzione di ricarica della schermata, che
// rilegge i dati dalla solita API. Nessun dato viaggia sul canale.
//
// Facoltativo: senza VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (es.
// in locale) non si connette a niente, e le schermate restano col
// ricontrollo periodico di sempre. La chiave "publishable" è fatta per stare
// nel browser: tutte le tabelle hanno la RLS attiva senza policy e le
// funzioni sono chiuse ad anon, quindi da sola non apre nessun dato.

import { useEffect, useRef, useState } from "react";
import { RealtimeClient } from "@supabase/realtime-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let client: RealtimeClient | null = null;
function getClient(): RealtimeClient | null {
  if (!SUPABASE_URL || !KEY) return null;
  if (!client) {
    client = new RealtimeClient(`${SUPABASE_URL.replace(/^http/, "ws").replace(/\/$/, "")}/realtime/v1`, {
      params: { apikey: KEY },
    });
  }
  return client;
}

export type Canale = {
  topic: string;
  /** Attesa casuale (0..jitterMs) prima di ricaricare. Per un canale
   *  ascoltato da tutti (es. ~90 telefoni) sparpaglia le richieste invece di
   *  farle arrivare tutte nello stesso istante. */
  jitterMs?: number;
};

/**
 * Ascolta i canali indicati e chiama `onCambio` quando arriva un avviso —
 * più avvisi ravvicinati diventano UNA ricarica sola. Chiama `onCambio`
 * anche quando la connessione torna dopo una caduta (gli avvisi persi nel
 * frattempo non arrivano più) e quando la scheda torna visibile (i telefoni
 * chiudono il websocket in tasca). Torna `true` mentre è connesso: la
 * schermata può allora ricontrollare molto più di rado.
 */
export function useAvvisiInTempoReale(canali: Canale[], onCambio: () => void, attivo = true): boolean {
  const [connesso, setConnesso] = useState(false);
  const onCambioRef = useRef(onCambio);
  onCambioRef.current = onCambio;
  const chiave = canali.map((c) => `${c.topic}|${c.jitterMs ?? 0}`).join(",");

  useEffect(() => {
    const rt = getClient();
    if (!attivo || !rt || canali.length === 0) { setConnesso(false); return; }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const ricarica = (jitterMs: number) => {
      if (timer) return; // una ricarica è già in arrivo: questa la copre
      timer = setTimeout(() => { timer = null; onCambioRef.current(); }, Math.random() * jitterMs);
    };

    const iscritti = new Set<string>();
    let giaConnesso = false;
    const canaliRt = canali.map(({ topic, jitterMs = 0 }) =>
      rt.channel(topic)
        .on("broadcast", { event: "cambio" }, () => ricarica(jitterMs))
        .subscribe((stato) => {
          if (stato === "SUBSCRIBED") {
            iscritti.add(topic);
            if (iscritti.size === canali.length) {
              // Una riconnessione (non la prima volta): si rilegge tutto.
              if (giaConnesso) ricarica(jitterMs);
              giaConnesso = true;
              setConnesso(true);
            }
          } else {
            iscritti.delete(topic);
            setConnesso(false);
          }
        }));

    const alRitorno = () => { if (!document.hidden) ricarica(0); };
    document.addEventListener("visibilitychange", alRitorno);

    return () => {
      document.removeEventListener("visibilitychange", alRitorno);
      if (timer) clearTimeout(timer);
      canaliRt.forEach((c) => rt.removeChannel(c));
      setConnesso(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiave, attivo]);

  return connesso;
}
