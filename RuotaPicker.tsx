// RuotaPicker.tsx — il selettore a ruota, come quello nativo di iOS.
//
// Perché non una griglia di pulsanti: le 19 fasce della lavanderia occupavano
// sette righe, cioè ~280px di sola scelta oraria. Su un telefono con la barra
// URL aperta il modale ci stava per un soffio e il pulsante di conferma
// finiva sotto il bordo. La ruota mostra le stesse 19 fasce in 170px fissi,
// che non crescono mai qualunque sia il numero di voci.
//
// Perché non `<input type="time">`: apre un pannello di sistema che su alcuni
// telefoni si apre oltre il bordo inferiore e resta invisibile — il problema
// segnalato. La ruota è HTML nostro, quindi vive dentro il modale e non può
// finire fuori schermo.
//
// ─────────────────────────────────────────────────────────────────────────────
// Come funziona lo scorrimento
//
// Non c'è calcolo di posizione a mano: il browser fa già tutto con
// `scroll-snap-type: y mandatory`, che aggancia la voce più vicina al centro
// quando lo scorrimento si ferma. Noi ci limitiamo a leggere `scrollTop` e
// dividerlo per l'altezza di una voce — l'indice è quello, e per costruzione
// è sempre intero quando lo snap ha finito.
//
// I due spaziatori sopra e sotto (alti mezza ruota meno mezza voce) servono a
// far arrivare al centro anche la PRIMA e l'ULTIMA voce: senza, la prima
// resterebbe in cima e non potrebbe mai essere selezionata.

import { useEffect, useRef, useCallback } from "react";

/** Altezza di una voce, in px. Se cambia, cambia anche in style.css (.ruota). */
const VOCE = 34;
/** Quante voci si vedono insieme. Dispari, così ce n'è una esattamente al centro. */
const VISIBILI = 5;

export const RUOTA_ALTEZZA = VOCE * VISIBILI;

export default function RuotaPicker({ valori, indice, onCambia, ariaLabel }: {
  valori: string[];
  indice: number;
  onCambia: (i: number) => void;
  ariaLabel?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  // ───────────────────────────────────────────────────────────────────────────
  // Il flusso è a SENSO UNICO: scorrimento → indice, mai il contrario.
  //
  // Un primo tentativo riallineava la ruota ogni volta che `indice` cambiava,
  // per tenerla in sincronia anche se il valore arrivava da fuori. Sembra
  // prudente e invece innesca un ciclo: lo scorrimento aggiorna l'indice,
  // l'indice riallinea la ruota, il riallineamento produce un altro evento di
  // scorrimento, e così via. Misurato: scorrendo alla voce 3 ne risultava
  // selezionata la 4, alla 8 la 3, alla 18 ancora la 3 — valori sbagliati e in
  // ritardo di un passo, cioè l'oscillazione che si era autoalimentata.
  //
  // Qui la posizione della ruota è l'unica verità. Si allinea una volta sola,
  // al montaggio, sul valore iniziale; da lì in poi cambia solo per mano di
  // chi scorre o tocca una voce. Se un domani servisse pilotarla da fuori,
  // la strada è rimontarla con una `key` diversa, non riaggiungere l'effetto.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = indice * VOCE;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = useCallback(() => {
    const el = box.current;
    if (!el) return;
    window.clearTimeout(timer.current);
    // Si aspetta che lo scorrimento si fermi: leggere a metà corsa darebbe una
    // raffica di valori intermedi, e ognuno riscriverebbe lo stato.
    timer.current = window.setTimeout(() => {
      const i = Math.round(el.scrollTop / VOCE);
      onCambia(Math.max(0, Math.min(valori.length - 1, i)));
    }, 90);
  }, [onCambia, valori.length]);

  /** Porta una voce al centro. Lo scorrimento poi aggiorna l'indice da sé. */
  const vaiA = (i: number) => {
    const el = box.current;
    if (!el) return;
    el.scrollTo({ top: i * VOCE, behavior: "smooth" });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Trascinamento col mouse
  //
  // Col dito la ruota si scorre da sé: è un contenitore che scorre, e sul
  // touch il browser traduce il trascinamento in scorrimento. Col mouse no —
  // tenere premuto e tirare non è un gesto che il browser converta in
  // scorrimento su nessun elemento, quindi da PC restavano la rotellina, le
  // frecce e il clic su una voce.
  //
  // Il problema è che una ruota SEMBRA un rullo: chiunque la veda su uno
  // schermo grande prova a tirarla, non ottiene niente, e la conclusione è
  // che è rotta. Qui il trascinamento lo facciamo a mano, solo per il mouse:
  // sul touch il browser fa già di meglio (inerzia, aggancio), e sovrapporsi
  // vorrebbe dire peggiorarlo.
  const trascina = useRef<{ y: number; top: number; mosso: boolean } | null>(null);
  // Il clic arriva SEMPRE dopo il rilascio, anche quando si è trascinato: senza
  // questa memoria, mollare il mouse sopra una voce ci saltava sopra, annullando
  // il trascinamento appena fatto.
  const appenaTrascinato = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = box.current;
    if (!el) return;
    appenaTrascinato.current = false;
    trascina.current = { y: e.clientY, top: el.scrollTop, mosso: false };
    // La cattura serve a non perdere il trascinamento se il mouse esce dalla
    // ruota mentre si tira. Se il puntatore non e' piu' attivo il browser
    // solleva: non e' un caso che debba fermare il trascinamento.
    try { el.setPointerCapture(e.pointerId); } catch { /* si tira lo stesso */ }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const t = trascina.current, el = box.current;
    if (!t || !el) return;
    const dy = e.clientY - t.y;
    // Tre pixel di tolleranza: un clic non è mai perfettamente fermo, e senza
    // soglia ogni clic verrebbe scambiato per un trascinamento.
    if (Math.abs(dy) > 3) t.mosso = true;
    // Si tira la ruota, non la si spinge: trascinando verso il basso salgono
    // le voci precedenti, come sul telefono.
    el.scrollTop = t.top - dy;
    e.preventDefault();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const t = trascina.current, el = box.current;
    if (!t || !el) return;
    trascina.current = null;
    try { el.releasePointerCapture(e.pointerId); } catch { /* già rilasciato */ }
    if (!t.mosso) return;
    appenaTrascinato.current = true;
    // Lo scorrimento imposto a mano non fa scattare l'aggancio da solo: la
    // voce più vicina al centro va portata al centro esplicitamente.
    const i = Math.max(0, Math.min(valori.length - 1, Math.round(el.scrollTop / VOCE)));
    vaiA(i);
    // E si dichiara la scelta senza aspettare l'evento di scorrimento. Sarebbe
    // arrivato lo stesso — il trascinamento muove scrollTop, e onScroll legge
    // di lì — ma passare da quel giro significa dipendere da un evento che qui
    // abbiamo già anticipato: l'indice lo conosciamo, dirlo subito rende il
    // rilascio immediato invece che 90ms dopo.
    onCambia(i);
  };

  // Frecce su/giù: la ruota è raggiungibile da tastiera come una lista, non
  // solo col dito. Conta anche per chi usa uno screen reader.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && indice < valori.length - 1) { e.preventDefault(); vaiA(indice + 1); }
    if (e.key === "ArrowUp"   && indice > 0)                 { e.preventDefault(); vaiA(indice - 1); }
  };

  const spazio = (RUOTA_ALTEZZA - VOCE) / 2;

  return (
    <div className="ruota" style={{ height: RUOTA_ALTEZZA }}>
      {/* La fascia centrale: dice dove "cade" la scelta. Non intercetta i
          tocchi, altrimenti impedirebbe di scorrere proprio al centro. */}
      <div className="ruota__banda" style={{ height: VOCE, top: spazio }} aria-hidden="true" />
      <div
        ref={box}
        className="ruota__scorri"
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div style={{ height: spazio }} aria-hidden="true" />
        {valori.map((v, i) => (
          <div
            key={v + i}
            role="option"
            aria-selected={i === indice}
            className="ruota__voce"
            style={{
              height: VOCE,
              // La voce scelta è piena e un filo più grande; le altre
              // sbiadiscono. È ciò che rende leggibile "quale sto scegliendo"
              // senza dover disegnare un bordo attorno a ognuna.
              opacity: i === indice ? 1 : Math.max(0.28, 1 - Math.abs(i - indice) * 0.32),
              fontWeight: i === indice ? 700 : 500,
              transform: i === indice ? "scale(1.06)" : "scale(1)",
            }}
            onClick={() => { if (!appenaTrascinato.current) vaiA(i); }}
          >
            {v}
          </div>
        ))}
        <div style={{ height: spazio }} aria-hidden="true" />
      </div>
    </div>
  );
}

// ─── Orario a due ruote (ore : minuti) ────────────────────────────────────────
//
// Sostituisce `<input type="time">` dove serve un orario libero. Il pannello
// di sistema di quell'input, su alcuni telefoni, si apre oltre il bordo
// inferiore e resta invisibile: e' il difetto segnalato. Due ruote HTML vivono
// dentro il modale e non possono uscirne.
//
// Minuti da 0 a 59, non a passi di cinque: in sala esistono gia' orari come
// 13:59, e un selettore che non sa rappresentare i dati che ha davanti
// costringerebbe a cambiarli per poterli salvare.

const ORE    = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTI = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

export function RuotaOrario({ valore, onCambia, etichetta }: {
  /** "HH:MM" */
  valore: string;
  onCambia: (hhmm: string) => void;
  etichetta?: string;
}) {
  const [hh, mm] = (valore || "00:00").split(":");
  const iOra = Math.max(0, ORE.indexOf(hh));
  const iMin = Math.max(0, MINUTI.indexOf(mm));

  return (
    <div>
      {etichetta && (
        <label style={{ display: "block", fontSize: 11, color: "var(--gray-accessible-text)", marginBottom: 4 }}>
          {etichetta}
        </label>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <RuotaPicker
          valori={ORE} indice={iOra} ariaLabel={(etichetta ?? "") + " — ore"}
          onCambia={(i) => onCambia(ORE[i] + ":" + MINUTI[iMin])}
        />
        <RuotaPicker
          valori={MINUTI} indice={iMin} ariaLabel={(etichetta ?? "") + " — minuti"}
          onCambia={(i) => onCambia(ORE[iOra] + ":" + MINUTI[i])}
        />
      </div>
    </div>
  );
}
