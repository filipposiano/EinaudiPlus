// Schermate amministrative — si aprono dal menu Impostazioni dell'app.
//
// Tengono solo cio' che nell'app normale non esiste: lo stato delle macchine,
// le segnalazioni dei residenti e, per il sistemista, regole ricorrenti e
// pulizia.
//
// Prenotare e cancellare NON si fa da qui: si fa nell'app principale, dove chi
// ha una sessione admin puo' agire a nome della DIREZIONE su qualsiasi turno.
//
// Caricato in lazy da App.tsx: non pesa sul bundle dei residenti.
//
// Ogni dominio (account, macchine, sale, bici, notifiche, ricorrenti,
// manutenzione, tema) vive nella sua feature-folder, in un sottodominio
// admin/ accanto alle viste dei residenti — speculare ai moduli backend.
// Qui resta solo il guscio: la sessione, il routing fra schede (AdminScreens)
// e le poche cose che App.tsx e Conferenze.tsx importano ancora da qui.

import { useCallback, useEffect, useState } from "react";
import { call } from "./features/admin-shared/adminApi";
import { S } from "./features/admin-shared/adminStyles";
import type { Laundry } from "./features/laundry/admin/types";
import { Login } from "./features/identity/admin/Login";
import { Macchine } from "./features/laundry/admin/MacchineTab";
import { CambioBiancheria } from "./features/laundry/admin/CambioBiancheriaTab";
import { Segnalazioni } from "./features/feedback/admin/Segnalazioni";
import { Bici } from "./features/bikes/admin/BiciTab";
import { Accounts } from "./features/identity/admin/Accounts";
import { Ricorrenti } from "./features/ops/admin/Ricorrenti";
import { Notifiche } from "./features/notifications/admin/NotificheTab";
import { Manutenzione } from "./features/ops/admin/Manutenzione";
import { Tema } from "./features/theme/admin/Tema";
import { CambiaPasswordObbligata } from "./features/identity/admin/Session";

export type { Role, Tab } from "./features/admin-shared/types";
import type { Role, Tab } from "./features/admin-shared/types";

export { adminLogout, CambiaPasswordObbligata, AdminLoginSheet } from "./features/identity/admin/Session";
export { GiornoSheetAdmin } from "./features/conference-room/admin/GiornoSheetAdmin";

// ─── Sezione amministrativa ──────────────────────────────────────────────────
//
// Non e' piu' una pagina a se' ne' un pannello sovrapposto: e' una destinazione
// della navigazione, allo stesso livello di Lavanderia, Cinema e Musica. Un
// amministratore usa esattamente la stessa app di tutti gli altri e trova
// qualche voce in piu' nella lista di sinistra.
//
// La barra del ruolo con "Esci" sta qui dentro, su ogni sezione: chi deve
// passare da FDO a sistemista lo fa da dove sta gia' lavorando, senza andare a
// cercare il menu.

export function AdminScreens({ tab, onSession }: {
  tab: Tab;
  onSession: (role: Role | null) => void;   // per riallineare l'app dopo logout o scadenza
}) {
  const [logged, setLogged] = useState<boolean | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [deveCambiare, setDeveCambiare] = useState(false);
  const [laundries, setLaundries] = useState<Laundry[]>([]);

  const loadOverview = useCallback(async () => {
    try { setLaundries((await call("overview")).laundries); }
    catch (e: any) { if (e.message === "SESSIONE_SCADUTA") { setLogged(false); onSession(null); } }
  }, [onSession]);

  const refreshSession = useCallback(() => {
    fetch("/api/admin/auth")
      .then((r) => r.json())
      .then((d) => {
        setLogged(Boolean(d.logged));
        setRole(d.role || null);
        setUsername(d.user || null);
        setDeveCambiare(Boolean(d.deve_cambiare_password));
        onSession(d.logged ? (d.role as Role) : null);
      })
      .catch(() => { setLogged(false); onSession(null); });
  }, [onSession]);

  useEffect(() => { refreshSession(); }, [refreshSession]);
  // Lo staff non vede Macchine ne' Segnalazioni — le uniche schede che usano
  // `laundries` — quindi per lui questa chiamata fallirebbe soltanto (il
  // server la rifiuta, vedi VIETATE_A_STAFF in api/admin/data.js) senza
  // nessun beneficio.
  useEffect(() => { if (logged && role !== "staff") loadOverview(); }, [logged, role, loadOverview]);

  // L'uscita non sta piu' qui: la fa il pulsante della camera nell'app, che
  // chiude la sessione e riporta al selettore della stanza. `adminLogout()`
  // resta esportato ed e' quello che App.tsx chiama.

  const sistemista = role === "sistemista";
  const staff = role === "staff";

  if (logged === null) {
    return <p style={{ fontSize: 13, ...S.sub, padding: "20px 4px" }}>Caricamento…</p>;
  }

  // Sessione assente o scaduta mentre si stava lavorando: il login compare qui,
  // dove si era, invece di rimbalzare l'utente altrove senza spiegazioni.
  if (!logged) {
    return (
      <div style={{ padding: "20px 0 40px" }}>
        <p style={{ fontSize: 13, ...S.sub, marginBottom: 14, textAlign: "center" }}>
          La sessione amministrativa non è attiva.
        </p>
        <Login onDone={refreshSession} />
      </div>
    );
  }

  // Un account appena creato (o con la password appena reimpostata) non puo'
  // fare nient'altro finche' non sceglie una password sua: qui la sala
  // d'attesa sostituisce QUALUNQUE scheda, a prescindere da quale sia stata
  // scelta in navigazione — altrimenti bastava restare su Macchine per
  // rimandare la scelta all'infinito.
  if (deveCambiare) {
    return (
      <div style={{ paddingBottom: 40, color: "var(--foreground)" }}>
        <CambiaPasswordObbligata onFatto={refreshSession} />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 40, color: "var(--foreground)" }}>
      {/* Qui c'era una barra col ruolo e il pulsante Esci. Tolta: l'uscita
          avviene toccando il pulsante della camera ("DIREZIONE") in alto, che
          chiude la sessione e riporta alla scelta della stanza. Un secondo
          punto d'uscita, ripetuto su ogni sezione, faceva solo rumore sopra il
          contenuto — e il ruolo si capisce gia' da quali voci si vedono in
          navigazione (Ricorrenti e Manutenzione solo da sistemista). */}

      {/* Le sezioni riservate al sistemista (o escluse per lo staff) non
          compaiono nemmeno nella navigazione, ma se ci si arriva lo stesso
          il controllo vero resta sul server: nascondere una voce non e'
          un'autorizzazione. */}
      {tab === "macchine" && (!staff
        ? <Macchine laundries={laundries} reload={loadOverview} />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata a FDO e sistemista.</p>)}
      {tab === "cambiobiancheria" && (!staff
        ? <CambioBiancheria />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata a FDO e sistemista.</p>)}
      {tab === "segnalazioni" && (!staff
        ? <Segnalazioni laundries={laundries} reload={loadOverview} />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata a FDO e sistemista.</p>)}
      {tab === "bici" && (!staff
        ? <Bici sistemista={sistemista} />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata a FDO e sistemista.</p>)}
      {tab === "account" && (sistemista
        ? <Accounts me={username} />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata al sistemista.</p>)}
      {tab === "ricorrenti" && (sistemista
        ? laundries.length > 0 && <Ricorrenti laundries={laundries} />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata al sistemista.</p>)}
      {tab === "notifiche" && (sistemista
        ? <Notifiche />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata al sistemista.</p>)}
      {tab === "manutenzione" && (sistemista
        ? <Manutenzione />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata al sistemista.</p>)}
      {tab === "tema" && (sistemista
        ? <Tema />
        : <p style={{ fontSize: 13, ...S.sub }}>Sezione riservata al sistemista.</p>)}
    </div>
  );
}
