import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  AlertTriangle,
  Delete, X, Wrench, Loader2,
  Film, Music, Menu,
  MessageSquare, LogOut,
  Settings, Repeat, Eraser, Presentation, UserCog, Bike, Sparkles, Bell,
} from "lucide-react";
import * as api from "./api";
import * as push from "./push";
import RoomView from "./features/common-spaces/Rooms";
import BiciView from "./features/bikes/Bici";
import Conferenze from "./features/conference-room/Conferenze";
import AccessibilityPanel from "./features/accessibility/AccessibilityPanel";
import { loadPrefs, savePrefs, applyToDOM, type AccessibilityPrefs } from "./statusConfig";
import type { Role as AdminRole, Tab as AdminTab } from "./AdminPanel";
import { WashingMachine } from "./icons";
import { useMediaQuery, useTastieraFisica, TASTI_CAMERA } from "./hooks";
import { Dashboard, DaySchedule, WeekOverview, SegnalaGuastoSheet } from "./features/laundry";
import { FeedbackModal } from "./features/feedback/FeedbackModal";

// Le regole della lavanderia (turni, macchine, prenotazioni) e i testi stanno
// in file loro: qui restano i componenti. Vedi modello.ts, i18n.ts, tema.ts.
import {
  APP_VERSION,
  favsKey, loadFavs,
  type WeekData, type StatusData, type Fav,
} from "./modello";
import { T, linguaIniziale, salvaLingua, type Lang } from "./i18n";
import { SettingsSheet, InstallPrompt, WelcomeReminderPrompt } from "./pannelli";
import {
  RED, RED_FG, OOS_T, type Theme,
  type TemaPreferenza, temaIniziale, salvaTema,
} from "./tema";

// Le schermate amministrative vivono dentro questa stessa app, aperte dal menu
// Impostazioni. In lazy perché la stragrande maggioranza di chi apre l'app non
// ha una sessione admin e non deve scaricarne il codice.
const AdminScreens   = lazy(() => import("./AdminPanel").then((m) => ({ default: m.AdminScreens })));
const AdminLoginSheet = lazy(() => import("./AdminPanel").then((m) => ({ default: m.AdminLoginSheet })));
const CambiaPasswordObbligata = lazy(() => import("./AdminPanel").then((m) => ({ default: m.CambiaPasswordObbligata })));

// Le sezioni amministrative sono destinazioni di navigazione come le altre,
// non un pannello a parte: chi ha la sessione le trova nella stessa lista di
// Lavanderia, Cinema e Musica.
// Le tre pagine di utilita' (segnalazione guasti, impostazioni, feedback)
// sono destinazioni come le altre: si raggiungono dallo stesso menu, con lo
// stesso `onChange`, e non aprono piu' un foglio sopra la pagina.
// "bike" e non "bici": l'id amministrativo "bici" (vedi ADMIN_TABS) e' gia'
// preso — sono due schermate diverse (qui la camera dichiara la sua, li' la
// portineria le vede tutte) e non possono condividere lo stesso id o
// `isAdminFacility` scambierebbe l'una per l'altra.
type Facility = "laundry" | "cinema" | "music" | "conferenze" | "bike" | "guasto" | "impostazioni" | "feedback" | AdminTab;

const ADMIN_TABS: AdminTab[] = ["macchine", "segnalazioni", "bici", "account", "ricorrenti", "notifiche", "manutenzione", "tema"];
const isAdminFacility = (f: Facility): f is AdminTab => (ADMIN_TABS as string[]).includes(f);

/** Etichetta della camera nell'intestazione. Chi amministra è la Direzione. */
// "St. 318" era un'abbreviazione che non abbreviava niente: la pastiglia ha
// spazio, e nell'app la parola e' "camera" dappertutto. Da quando il saluto
// ("Buonasera, camera 318") non c'e' piu', questo e' l'UNICO posto dove sta
// scritta la camera — quindi ci sta scritta per intero.
const roomLabel = (room: string | null, t: { changeRoom: string; room: string }) =>
  room === api.DIREZIONE ? "DIREZIONE" : room ? `${t.room} ${room}` : t.changeRoom;

// Preferenze accessibilità a livello di modulo — lette da tutti i componenti,
// aggiornate da App.handleAccessibilityChange. Evita il prop-drilling profondo.
let accessibilityPrefs: AccessibilityPrefs = loadPrefs();

// ─── Login screen ─────────────────────────────────────────────────────────────

// Il numero che apre l'accesso amministratore invece di entrare in una camera.
// Non è una password — chi lo conosce vede solo il form di login — ma tiene la
// voce fuori dal menu dei residenti, dove non serviva a nessuno di loro.
// 1935: l'anno di fondazione del collegio.
const ROOM_ADMIN = "1935";

function LoginScreen({ lang, onLogin, onAdmin }: {
  theme?: Theme; lang: Lang; onLogin: (room: string) => void; onAdmin: () => void;
}) {
  const t = T[lang];
  const [room, setRoom] = useState("");
  const fg   = "var(--foreground)";
  const sub  = "var(--gray-accessible-text)";
  const chip = "var(--secondary)";
  const surf = "var(--card)";

  function submit() {
    if (room.length === 0) return;
    if (room === ROOM_ADMIN) { setRoom(""); onAdmin(); return; }
    const regexCamera = /^\d+(?:-?[a-bA-B])?$/;
    if (!regexCamera.test(room)) {
      alert("Formato non valido. Esempi validi: 112, 21-b, 112A");
      return;
    }
    onLogin(room);
  }

  // La tastiera fisica: vale sempre in questa schermata. Vedi useTastieraFisica.
  useTastieraFisica(true, setRoom, submit, 6, TASTI_CAMERA);

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6">
      <div className="flex flex-col items-center mb-10">
        <div className="p-4 rounded-3xl mb-5" style={{ background:`color-mix(in srgb, var(--primary) 18%, transparent)` }}>
          <WashingMachine size={36} style={{ color:RED }}/>
        </div>
        <h1 className="text-2xl font-bold mb-1 text-center" style={{ color:fg }}>{t.welcome}</h1>
        <p className="text-sm text-center leading-relaxed" style={{ color:sub }}>
          {t.enterRoom}
        </p>
      </div>

      <div className="w-full rounded-2xl px-5 py-4 mb-5 flex items-center justify-between border" style={{ background:surf, borderColor:"var(--border)" }}>
        <span className="text-sm font-mono" style={{ color:sub }}>{t.room}</span>
        <span className="text-4xl font-mono font-bold tabular-nums" style={{ color:room?fg:`color-mix(in srgb, var(--foreground) 15%, transparent)` }}>
          {room || "—"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2.5 w-full mb-4">
        {/* setRoom(r => …) e non setRoom(room + k): due tocchi nello stesso
            istante leggerebbero entrambi lo stesso valore vecchio e la prima
            cifra andrebbe persa. Con la forma funzionale si accodano. */}
        {["1","2","3","A", "4","5","6","B", "7","8","9","-"].map((k)=>(
          <button key={k} onClick={()=>setRoom(r=>r.length<6?r+k:r)}
            className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95"
            style={{ background:chip, color:fg }}>{k}</button>
        ))}
        <button onClick={()=>setRoom(r=>r.slice(0,-1))}
          className="rounded-2xl h-14 flex items-center justify-center transition-all active:scale-95 col-span-1"
          style={{ background:chip, color:sub }}><Delete size={20}/></button>
        <button onClick={()=>setRoom(r=>r.length<6?r+"0":r)}
          className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95 col-span-1"
          style={{ background:chip, color:fg }}>0</button>
        <button onClick={submit}
          className="rounded-2xl h-14 text-xl font-bold transition-all active:scale-95 text-white col-span-2"
          style={{ background:room.length>0?RED:chip, color:room.length>0?RED_FG:sub }}>→</button>
      </div>

      <button
        onClick={()=>onLogin("")}
        className="w-full py-3.5 rounded-2xl text-sm font-medium transition-all active:scale-[0.98] border"
        style={{ borderColor:"var(--border)", color:sub, background:"transparent" }}>
        {t.skip}
      </button>

      {/* Solo da schermo grande: su un telefono la tastiera fisica non c'è e
          la riga sarebbe un'istruzione impossibile da seguire. */}
      <p className="text-[10px] mt-4 hidden md:block" style={{ color:sub }}>
        {t.usaTastiera}
      </p>

      <p className="text-[10px] font-mono mt-6" style={{ color:sub }}>v. {APP_VERSION} (beta)</p>
    </div>
  );
}

// La barra fissa in fondo — Dashboard/Giornaliero/Settimana — non c'e' piu'.
// Le sue tre voci valevano solo dentro la lavanderia, e un banner sempre
// visibile per tre destinazioni non giustificava piu' lo spazio che
// occupava: si prenota dal "+" accanto alle proprie prenotazioni, e le due
// schermate che restano — Giornaliero e Settimana — si scambiano fra loro
// con l'interruttore in cima a ciascuna (vedi IntestazioneVista) invece che
// da un banner sempre in vista. Su desktop restano nella sidebar.


// ─── Sidebar desktop ──────────────────────────────────────────────────────────

function DesktopSidebar({ lang, roomNumber, showNav, facility, onFacility, adminRole, onChangeRoom }: {
  lang: Lang;
  roomNumber: string | null; showNav: boolean;
  facility: Facility; onFacility: (f: Facility) => void;
  adminRole: AdminRole | null;
  onChangeRoom: () => void;
}) {
  const t   = T[lang];
  const fg  = "var(--foreground)";
  const sub = "var(--gray-accessible-text)";
  const div = "var(--border)";
  return (
    <aside className="w-60 shrink-0 h-dvh flex flex-col border-r" style={{ background:"var(--background)", borderColor:div }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 shrink-0 border-b" style={{ borderColor:div }}>
        <div className="p-2 rounded-xl" style={{ background:"color-mix(in srgb, var(--primary) 15%, transparent)" }}>
          <WashingMachine size={20} style={{ color:RED }}/>
        </div>
        <span className="text-lg font-bold" style={{ color:fg }}>Sez. Valentino</span>
      </div>

      {/* Navigazione */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {/* Strutture: Lavanderia / Cinema / Musica / Polivalente.
            Le schede Dashboard/Giornaliero/Settimana non sono piu' annidate
            sotto Lavanderia: sul telefono sono sparite da un pezzo — si
            arriva al giornaliero e alla settimana dai pulsanti della
            dashboard, e si torna indietro dall'interruttore in cima a
            ciascuna vista — e tenerle qui faceva del desktop una navigazione
            diversa da quella del telefono, per le stesse tre schermate. */}
        {showNav && facilitiesFor(roomNumber).map(({ id, icon: Icon, chiave }) => {
          const isActive = facility === id;
          return (
            <button key={id} onClick={()=>onFacility(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${isActive ? "" : "desk-nav"}`}
              style={isActive ? { background:RED, color:RED_FG } : { color:sub }}>
              <Icon size={18}/>{T[lang][chiave]}
            </button>
          );
        })}

        {/* Sezioni amministrative: stesso livello delle strutture, in coda e
            separate perché sono di natura diversa. Compaiono solo con una
            sessione attiva; l'uscita sta dentro la sezione stessa. */}
        {showNav && adminSectionsFor(adminRole).length > 0 && (
          <>
            <div className="h-px my-2 mx-2" style={{ background:div }}/>
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color:sub }}>
              {T[lang].amministrazione}
            </p>
            {adminSectionsFor(adminRole).map(({ id, icon: Icon, chiave }) => {
              const isActive = facility === id;
              return (
                <button key={id} onClick={()=>onFacility(id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${isActive ? "" : "desk-nav"}`}
                  style={isActive ? { background:RED, color:RED_FG } : { color:sub }}>
                  <Icon size={18}/>{T[lang][chiave]}
                </button>
              );
            })}
          </>
        )}
      </nav>

      {/* Controlli */}
      <div className="px-3 py-4 border-t flex flex-col gap-2 shrink-0" style={{ borderColor:div }}>
        {roomNumber !== null && (
          <button onClick={onChangeRoom}
            className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors desk-nav"
            style={{ color:fg }}>
            <span className="font-mono">{roomLabel(roomNumber, t)}</span>
            <LogOut size={13} style={{ color:sub }}/>
          </button>
        )}
        {/* Lingua, notifiche, installazione, accessibilità stanno tutte dentro
            Impostazioni. Il refresh manuale è sparito (tornare sull'app ricarica
            già i dati) e il tema segue sempre quello del sistema.

            Queste tre sono pagine come le altre — stesso `onFacility` delle
            strutture qui sopra — solo raggruppate qui perche' non sono
            strutture.

            Gate su showNav come le liste qui sopra: prima erano sempre
            visibili, anche a schermata di accesso ancora aperta (roomNumber
            null, prima di "Continua senza accedere"). Da li' si poteva
            aprire Impostazioni, che pero' non ha un pulsante indietro suo —
            l'unico modo di tornare era la pastiglia "Cambia camera" qui
            sotto, nascosta esattamente perche' non c'e' ancora una camera:
            un vicolo cieco raggiungibile solo da desktop, perche' sul
            telefono l'hamburger che apre queste stesse voci e' gia' dietro
            lo stesso showChrome. */}
        {showNav && PAGINE_UTILITA.map(({ id, chiave }) => {
          const Icona = id === "guasto" ? Wrench : id === "impostazioni" ? Settings : MessageSquare;
          const attiva = facility === id;
          return (
            <button key={id} onClick={()=>onFacility(id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${attiva ? "" : "desk-nav"}`}
              style={attiva ? { background:RED, color:RED_FG } : { color:fg }}>
              <Icona size={16} style={attiva ? undefined : { color:sub }}/>{T[lang][chiave]}
            </button>
          );
        })}
        <p className="text-center text-[10px] font-mono pt-1" style={{ color:sub }}>v. {APP_VERSION} (beta)</p>
      </div>
    </aside>
  );
}

// ─── Stati di caricamento / errore ─────────────────────────────────────────────

function CenterState({ children }: { isDark?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4"
      style={{ color:"var(--gray-accessible-text)" }}>
      {children}
    </div>
  );
}

// ─── Selettore struttura (Lavanderia / Cinema / Musica) ───────────────────────

//  e non l'etichetta: i testi stanno tutti in lingue/, e con sei
// lingue un oggetto { it, en } scritto qui dentro non reggeva piu'.
const FACILITIES: {
  id: Facility; icon: any;
  chiave: "navLavanderia" | "navCinema" | "navMusica" | "navConferenze" | "bici";
}[] = [
  { id: "laundry",    icon: WashingMachine, chiave: "navLavanderia" },
  { id: "cinema",     icon: Film,           chiave: "navCinema" },
  { id: "music",      icon: Music,          chiave: "navMusica" },
  // La sala conferenze non si prenota: la programma la direzione e qui la si
  // guarda. Sta comunque fra le strutture perche' la domanda che ci si fa
  // ("e' libera adesso?") e' la stessa che si fa per le altre.
  { id: "conferenze", icon: Presentation,   chiave: "navConferenze" },
  // Non e' una prenotazione ma la domanda ("questa camera ha una bici?") e'
  // la stessa specie delle altre: una struttura, non un'impostazione — per
  // questo sta qui e non piu' dentro Impostazioni.
  { id: "bike",       icon: Bike,           chiave: "bici" },
];

// La Direzione non e' una camera: non ha una bici da dichiarare, quindi non
// ha senso che veda la scheda. Nascondere la voce non e' una protezione (la
// sezione stessa mostra gia' un messaggio se ci si arriva lo stesso, vedi
// Bici.tsx) — e' solo per non promettere una cosa che DIREZIONE non puo' fare.
const facilitiesFor = (roomNumber: string | null) =>
  FACILITIES.filter((f) => f.id !== "bike" || roomNumber !== api.DIREZIONE);

// Le voci riservate al sistemista non compaiono con la sessione FDO, ma il
// controllo vero resta sul server: nascondere una voce non è un'autorizzazione.
const ADMIN_SECTIONS: {
  id: AdminTab; icon: any;
  chiave: "navMacchine" | "navSegnalazioni" | "navBici" | "navAccount" | "navRicorrenti" | "navNotifiche" | "navManutenzione" | "navTema";
  sistemistaOnly?: boolean;
  // Macchine e segnalazioni restano affari di FDO e sistemista: lo staff
  // prenota per conto della Direzione come l'FDO, ma non deve vedere lo
  // stato guasto/funzionante delle macchine ne' le segnalazioni.
  staffEsclusa?: boolean;
}[] = [
  { id: "macchine",       icon: Wrench,        chiave: "navMacchine",     staffEsclusa: true },
  { id: "segnalazioni",   icon: MessageSquare, chiave: "navSegnalazioni", staffEsclusa: true },
  // Quali camere hanno una bici: la vede chi e' in portineria, come le
  // macchine e le segnalazioni. Cancellarle tutte (reset annuale) resta al
  // sistemista — il pulsante compare solo a lui dentro la sezione stessa.
  { id: "bici",           icon: Bike,          chiave: "navBici",         staffEsclusa: true },
  // La programmazione della sala polivalente non e' piu' una scheda a se':
  // vive dentro la sezione "Polivalente" stessa (vedi Conferenze.tsx), visibile
  // li' a chiunque abbia una sessione admin — non serve piu' una voce qui.
  // Chi crea e disattiva gli account e' una decisione dello stesso livello di
  // "chi puo' cancellare tutto": resta al sistemista.
  { id: "account",        icon: UserCog,       chiave: "navAccount",      sistemistaOnly: true },
  { id: "ricorrenti",     icon: Repeat,        chiave: "navRicorrenti",   sistemistaOnly: true },
  { id: "notifiche",      icon: Bell,          chiave: "navNotifiche",    sistemistaOnly: true },
  { id: "manutenzione",   icon: Eraser,        chiave: "navManutenzione", sistemistaOnly: true },
  // Decorazione dell'app (neve, pipistrelli...), acceso/spento a piacere:
  // stesso livello di privilegio di Account e Manutenzione, non perche' sia
  // rischioso quanto quelli, ma perche' cambia cosa vede OGNI residente.
  { id: "tema",           icon: Sparkles,      chiave: "navTema",        sistemistaOnly: true },
];

const adminSectionsFor = (role: AdminRole | null) =>
  role === null ? [] : ADMIN_SECTIONS.filter((s) =>
    (!s.sistemistaOnly || role === "sistemista") && (!s.staffEsclusa || role !== "staff")
  );

// Le tre pagine di utilita', raggiunte dal fondo del menu: non sono
// strutture ne' sezioni amministrative, ma il titolo in cima serve anche a
// loro — vedi l'header mobile.
const PAGINE_UTILITA: { id: "guasto" | "impostazioni" | "feedback"; chiave: "reportOos" | "impostazioni" | "feedbackApp" }[] = [
  { id: "guasto",        chiave: "reportOos" },
  { id: "impostazioni",  chiave: "impostazioni" },
  { id: "feedback",      chiave: "feedbackApp" },
];

// Il menu laterale, su telefono.
//
// Le quattro strutture stavano in una griglia di pastiglie sotto l'orario, e
// con una sessione admin diventavano otto: mezza schermata di navigazione
// prima di arrivare al contenuto, ogni volta, anche per chi apre l'app solo
// per vedere se la lavatrice e' libera. Ora stanno dietro un pulsante, come la
// camera e le impostazioni: sono destinazioni, e una destinazione la si cerca
// quando serve.
//
// E' il gemello della sidebar del desktop — stesse voci, stesso ordine, stesse
// regole su chi vede cosa. Manca solo l'annidamento delle schede della
// lavanderia: quelle non ci sono piu' da nessuna parte, si arriva al
// giornaliero e alla settimana dai due pulsanti della dashboard.
function MenuStrutture({ aperto, onClose, facility, onChange, lang, adminRole, roomNumber }: {
  aperto: boolean; onClose: ()=>void;
  facility: Facility; onChange: (f: Facility)=>void;
  lang: Lang; adminRole: AdminRole | null; roomNumber: string | null;
}) {
  const sub      = "var(--gray-accessible-text)";
  const div      = "var(--border)";
  const sections = adminSectionsFor(adminRole);

  if (!aperto) return null;

  // py-2 e non py-3: con le sezioni admin al completo (sistemista) l'elenco
  // arrivava a superare l'altezza dello schermo e obbligava a scorrere il
  // pannello — qui basta stringere le righe perche' tutte le voci restino
  // visibili senza scorrere, sui telefoni normali.
  const Voce = ({ id, icon: Icon, label }: { id: Facility; icon: any; label: string }) => {
    const attiva = facility === id;
    return (
      <button onClick={()=>{ onChange(id); onClose(); }}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition-colors text-left"
        style={attiva ? { background:RED, color:RED_FG } : { color:sub }}>
        <Icon size={18} className="shrink-0"/>{label}
      </button>
    );
  };

  return (
    <>
      {/* Il velo chiude il menu. Sta sotto al pannello e sopra a tutto il
          resto: senza, si poteva toccare la pagina dietro con il menu
          ancora aperto. */}
      <div className="absolute inset-0 z-40 menu-velo" onClick={onClose} aria-hidden="true"
        style={{ background:"rgba(0,0,0,.45)" }}/>

      <nav className="absolute inset-y-0 left-0 z-50 w-[80%] max-w-[300px] flex flex-col border-r menu-pannello"
        style={{ background:"var(--background)", borderColor:div }}
        aria-label={T[lang].navStrutture}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2.5 shrink-0" style={{ borderBottom:`1px solid ${div}` }}>
          <span className="text-base font-bold" style={{ color:"var(--foreground)" }}>Sez. Valentino</span>
          <button onClick={onClose} aria-label={T[lang].cancel}
            className="p-1.5 rounded-lg" style={{ color:sub }}>
            <X size={18}/>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 flex flex-col gap-0.5">
          {facilitiesFor(roomNumber).map(({ id, icon, chiave }) => (
            <Voce key={id} id={id} icon={icon} label={T[lang][chiave]}/>
          ))}

          {/* Le sezioni amministrative in coda e separate: stesso livello
              delle strutture, natura diversa. Compaiono solo con una
              sessione attiva — ma il controllo vero resta sul server. */}
          {sections.length > 0 && (
            <>
              <div className="my-2 mx-3 border-t" style={{ borderColor:div }}/>
              {sections.map(({ id, icon, chiave }) => (
                <Voce key={id} id={id} icon={icon} label={T[lang][chiave]}/>
              ))}
            </>
          )}
        </div>

        {/* In fondo, dopo una riga: non sono strutture come le altre, ma
            destinazioni allo stesso modo — stesso `onChange`, stessa pagina
            a corpo intero. L'ingranaggio stava in alto a destra, accanto
            alla camera: due icone per due cose diverse, di cui una si usa
            una volta all'anno. Qui sta con le altre cose che non sono
            strutture. */}
        <div className="shrink-0 px-3 py-2 flex flex-col gap-0.5" style={{ borderTop:`1px solid ${div}` }}>
          {PAGINE_UTILITA.map(({ id, chiave }) => {
            const Icona = id === "guasto" ? Wrench : id === "impostazioni" ? Settings : MessageSquare;
            const attiva = facility === id;
            return (
              <button key={id} onClick={()=>{ onChange(id); onClose(); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold text-left"
                style={attiva ? { background:RED, color:RED_FG } : { color:sub }}>
                <Icona size={18} className="shrink-0"/>{T[lang][chiave]}
              </button>
            );
          })}
          <p className="text-center text-[10px] font-mono pt-1" style={{ color:sub }}>v. {APP_VERSION} (beta)</p>
        </div>
      </nav>
    </>
  );
}

// ─── Tema stagionale ─────────────────────────────────────────────────────────
//
// Livello puramente decorativo sopra il resto dell'app, acceso/spento dal
// sistemista (AdminPanel → Tema): neve a Natale, pipistrelli a Halloween.
// `pointer-events-none` su tutto il layer, cosi' non intercetta mai un
// tocco, qualunque sia il suo z-index rispetto al resto — non deve MAI
// impedire di prenotare un turno solo perche' e' Natale.
//
// Elementi generati con una posizione/ritardo derivati dall'indice (non
// Math.random): stabili fra un render e l'altro, non "saltano" ogni volta
// che qualcos'altro nell'app fa ridisegnare il componente.
const FIOCCHI_NEVE = Array.from({ length: 34 }, (_, i) => i);
const PIPISTRELLI = Array.from({ length: 8 }, (_, i) => i);
const ZUCCHE = Array.from({ length: 6 }, (_, i) => i);

function TemaEffetto({ tema }: { tema: api.TemaStagionale }) {
  if (tema === "natale") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 30 }} aria-hidden="true">
        {FIOCCHI_NEVE.map((i) => {
          // Tre "strati" di profondita': un fiocco vicino e' piu' grande, piu'
          // veloce e piu' opaco di uno lontano — senza, la nevicata sembrava
          // tutta sullo stesso piano invece di avere uno spessore vero.
          const strato = i % 3;
          return (
            <span key={i} className="tema-fiocco" style={{
              left: `${(i * 37) % 100}%`,
              fontSize: 9 + strato * 8,
              animationDuration: `${11.5 - strato * 2.8 + (i % 5) * 0.5}s`,
              animationDelay: `${-(i % 13) * 1.1}s`,
              ["--op" as any]: 0.4 + strato * 0.22,
            }}>❄</span>
          );
        })}
      </div>
    );
  }

  if (tema === "halloween") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 30 }} aria-hidden="true">
        <div className="tema-halloween-tinta" />
        {/* Ferme in basso, non attraversano lo schermo come i pipistrelli:
            sono zucche appoggiate, non cose che volano. */}
        {ZUCCHE.map((i) => (
          <span key={i} className="tema-zucca" style={{
            left: `${6 + (i * 83) % 88}%`,
            bottom: `${2 + (i % 3) * 5}%`,
            fontSize: 20 + (i % 3) * 7,
            animationDuration: `${3 + (i % 4) * 0.6}s`,
            animationDelay: `${-(i % 5) * 0.8}s`,
          }}>🎃</span>
        ))}
        {PIPISTRELLI.map((i) => (
          <span key={i} className="tema-pipistrello" style={{
            top: `${(i * 17) % 65}%`,
            animationDuration: `${7 + (i % 5) * 1.3}s`,
            animationDelay: `${-(i % 8) * 1.6}s`,
          }}>🦇</span>
        ))}
      </div>
    );
  }

  return null;
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]   = useState(0);
  // La dashboard e' `memo`: un callback creato al volo nel JSX cambierebbe a
  // ogni render e la farebbe ridisegnare da capo.
  //
  // Al giornaliero, non alla settimana: e' li' che si arriva con le fasce di
  // oggi gia' davanti, il posto piu' diretto per prenotare un turno adesso.
  const vaiAlGiorno = useCallback(() => setScreen(1), []);
  // 0 dashboard, 1 giornaliero, 2 settimana. Con useCallback perche' le tre
  // viste sono `memo`: un callback creato al volo dentro il JSX cambierebbe a
  // ogni render e le farebbe ridisegnare da capo — cioe' proprio il lavoro che
  // quel memo evita (la griglia settimanale sono 7x19 celle).
  const [facility, setFacility] = useState<Facility>("laundry");
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [menuAperto, setMenuAperto] = useState(false);   // il menu laterale, solo su telefono
  const [_aPrefs, _setAPrefs] = useState<AccessibilityPrefs>(loadPrefs);
  // Di default il tema segue quello del telefono ("system"); dalle
  // Impostazioni si può forzare chiaro o scuro. La preferenza vive in
  // tema.ts insieme alla funzione che la legge, cosi' come linguaIniziale
  // sta in i18n.ts.
  const [temaPref, setTemaPref] = useState<TemaPreferenza>(temaIniziale);
  const [theme, setTheme] = useState<Theme>(() => {
    const pref = temaIniziale();
    if (pref !== "system") return pref;
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  });
  const cambiaTema = useCallback((t: TemaPreferenza) => {
    setTemaPref(t);
    salvaTema(t);
    setTheme(t === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : t);
  }, []);
  const [lang,   setLang]     = useState<Lang>(linguaIniziale);
  const [roomNumber] = useState<string | null>(() => {
    try { return localStorage.getItem("laundryhub.room"); } catch { return null; }
  });
  const [week,   setWeek]     = useState<WeekData>({});
  const [status, setStatus]   = useState<StatusData>({});
  // Tema stagionale deciso dal sistemista (vedi AdminPanel → Tema): non e'
  // una preferenza di questo dispositivo, arriva dal server ad ogni
  // caricamento, come week/status.
  const [tema,   setTema]     = useState<api.TemaStagionale>("nessuno");
  const [loading, setLoading] = useState(true);
  const [error,  setError]    = useState<string | null>(null);
  // Preferiti caricati in base alla camera corrente (vedi loadFavs).
  const [favs,   setFavs]     = useState<Fav[]>(() => loadFavs(
    (() => { try { return localStorage.getItem("laundryhub.room"); } catch { return null; } })()
  ));
  const t = T[lang];

  // Quando cambia la stanza (login/logout/cambio camera) ricarico i preferiti
  // di QUELLA stanza, evitando di mostrare quelli della stanza precedente.
  useEffect(() => { setFavs(loadFavs(roomNumber)); }, [roomNumber]);

  const toggleFav = useCallback((day: number, slot: number) => {
    setFavs((prev) => {
      const exists = prev.some((f) => f.day === day && f.slot === slot);
      const next = exists
        ? prev.filter((f) => !(f.day === day && f.slot === slot))
        : [...prev, { day, slot }].sort((a, b) => a.day - b.day || a.slot - b.slot);
      try { if (roomNumber) localStorage.setItem(favsKey(roomNumber), JSON.stringify(next)); } catch {}
      return next;
    });
  }, [roomNumber]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Se l'utente cambia tema al telefono MENTRE l'app è aperta, si adegua
  // subito invece di aspettare una ricarica — ma solo quando la preferenza è
  // "system": chi ha forzato chiaro o scuro non deve vederselo scavalcare dal
  // telefono.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => { if (temaPref === "system") setTheme(e.matches ? "dark" : "light"); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [temaPref]);

  // Applica preferenze accessibilità al DOM al mount
  useEffect(() => { applyToDOM(accessibilityPrefs); }, []);

  const handleAccessibilityChange = useCallback((prefs: AccessibilityPrefs) => {
    accessibilityPrefs = prefs;  // aggiorna riferimento modulo per i componenti figli
    _setAPrefs(prefs);           // trigger re-render
    savePrefs(prefs);
    applyToDOM(prefs);
  }, []);
  
  const refresh = useCallback(async () => {
    try {
      const s = await api.getSnapshot();
      setWeek(s.week); setStatus(s.status); setTema(s.tema); setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Il pulsante di refresh manuale è sparito: "torno sull'app e si aggiorna
  // da sola" è vero solo se riaprirla fa davvero un caricamento nuovo. Senza
  // il pulsante, un'app lasciata aperta in background per ore manterrebbe
  // TODAY_DOW/CUR_SLOT calcolati al vecchio caricamento — sono valori fissati
  // all'avvio e non si aggiornano da soli al passare del tempo. Qui si
  // ricarica automaticamente quando l'app torna in primo piano dopo essere
  // rimasta nascosta più di 5 minuti, così l'assunzione diventa vera davvero.
  useEffect(() => {
    let hiddenAt: number | null = null;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt > 5 * 60_000) {
        window.location.reload();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Se questo dispositivo ha una sessione admin valida, l'app offre in più la
  // prenotazione a nome DIREZIONE e le voci riservate nel menu. Un solo
  // controllo qui, propagato a chi ne ha bisogno — il vero controllo resta
  // comunque sul cookie lato server: nascondere un pulsante non è
  // un'autorizzazione.
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  // Chi è entrato con la password provvisoria non deve poter fare altro che
  // cambiarla, e deve trovarsela davanti SUBITO — non scoprirlo più tardi,
  // provando a fare qualcosa che il server rifiuta. Vedi il gate più sotto.
  const [deveCambiarePassword, setDeveCambiarePassword] = useState(false);
  const isAdmin = adminRole !== null;

  // Un solo punto in cui la sessione amministrativa cambia, da qualunque parte
  // arrivi (login, uscita, scadenza rilevata da una sezione o dal controllo
  // all'avvio qui sotto). Chi smette di essere amministratore smette anche di
  // essere la DIREZIONE: senza questo resterebbe con un'identità che non può
  // più usare, e ogni prenotazione fallirebbe lato server senza che si capisca
  // perché.
  //
  // `setAdminRole` non va MAI chiamato altrove: prima il controllo all'avvio
  // qui sotto lo chiamava direttamente, scavalcando questa funzione. Chi
  // riapriva l'app (o veniva ricaricato dal controllo sulla tab rimasta
  // nascosta troppo a lungo, qualche schermata sopra) con la sessione admin
  // già scaduta si ritrovava con l'interfaccia admin correttamente nascosta
  // ma l'identità DIREZIONE ancora agganciata in localStorage — un downgrade
  // invece di un logout, che lasciava prenotare come DIREZIONE finché quella
  // richiesta non falliva a sua volta lato server (vedi SESSIONE_SCADUTA
  // sotto, e adminAction() in api.ts).
  const handleAdminSession = useCallback((r: AdminRole | null, deveCambiare = false) => {
    setAdminRole(r);
    // Chi non ha (più) una sessione non ha nemmeno una password provvisoria
    // da cambiare: il gate si spegne insieme al ruolo.
    setDeveCambiarePassword(r !== null && deveCambiare);
    // Traccia locale: dice ad adminSession() se al prossimo avvio vale la pena
    // chiedere al server. Vedi il commento in api.ts — non è autorizzazione.
    api.markAdminSeen(r !== null);
    if (r === null && localStorage.getItem("laundryhub.room") === api.DIREZIONE) {
      try { localStorage.removeItem("laundryhub.room"); } catch {}
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    api.adminSession().then(({ role, deveCambiarePassword: deve }) =>
      handleAdminSession((role as AdminRole) ?? null, deve));
  }, [handleAdminSession]);

  // Chi esce (o la cui sessione scade) mentre sta guardando una sezione
  // riservata non deve restare su una schermata che non gli appartiene più:
  // lo si riporta in lavanderia. Vale anche per il passaggio sistemista→FDO,
  // che perde Ricorrenti e Manutenzione.
  useEffect(() => {
    if (isAdminFacility(facility) &&
        !adminSectionsFor(adminRole).some((s) => s.id === facility)) {
      setFacility("laundry");
    }
  }, [adminRole, facility]);

  // L'uscita dalla modalità amministratore non ha più un pulsante suo: la fa
  // changeRoom(), cioè il pulsante della camera in alto. Vedi lì.

  // Riallinea in silenzio la subscription push col server.
  //
  // Due motivi: il nuovo database parte senza le subscription vecchie, e la
  // chiave VAPID è cambiata — in entrambi i casi chi aveva i promemoria attivi
  // smetterebbe di riceverli senza alcun segnale, perché il browser continua a
  // mostrarli come attivi. Girando a ogni avvio, ogni dispositivo si ripara da
  // solo la prima volta che qualcuno apre l'app.
  useEffect(() => {
    if (!roomNumber) return;
    push.refreshSubscription(roomNumber);
  }, [roomNumber]);

  // Il prompt "vuoi i promemoria?" compare una volta sola, subito dopo aver
  // scelto la camera — chooseRoom() ha lasciato il segnale in sessionStorage
  // apposta perche' sopravvivesse al reload. Lo si legge e lo si toglie
  // subito, cosi' un refresh successivo (o il prossimo avvio) non lo
  // ripropone: se qui non lo attiva, puo' sempre farlo dalle Impostazioni.
  //
  // Niente prompt se i promemoria sono gia' attivi (un altro dispositivo li
  // aveva gia' accesi per questa camera, e refreshSubscription qui sopra
  // l'ha appena confermato) — chiedere di nuovo sarebbe solo rumore.
  const [reminderPrompt, setReminderPrompt] = useState(false);
  useEffect(() => {
    if (!roomNumber) return;
    let chiesto = false;
    try { chiesto = sessionStorage.getItem("laundryhub.chiediNotifiche") === "1"; } catch {}
    if (!chiesto) return;
    try { sessionStorage.removeItem("laundryhub.chiediNotifiche"); } catch {}
    // Niente prompt se i promemoria sono gia' attivi. Dove le push non sono
    // disponibili (o sono bloccate) il prompt resta comunque utile finche' c'e'
    // Telegram: e' proprio il caso dell'iPhone, dove Telegram e' l'unica delle
    // due strade che funziona davvero.
    push.getReminderState().then((s) => {
      if (s === "on") return;
      if (s === "off" || import.meta.env.VITE_TELEGRAM_BOT) setReminderPrompt(true);
    });
  }, [roomNumber]);

  function chooseRoom(room: string) {
    // Solo per un vero accesso ("Continua senza accedere" manda ""), e non
    // per la DIREZIONE: quella non passa da qui digitando una camera, ci
    // arriva da sola aprendo una sessione amministrativa — chiederle se vuole
    // i promemoria nel mezzo di quel percorso non c'entrerebbe niente.
    //
    // sessionStorage e non localStorage: deve sopravvivere al reload qui
    // sotto (stessa scheda) ma sparire da solo se poi la scheda si chiude
    // senza che il prompt sia mai comparso — niente che si accumuli per
    // sempre se, fra il set e la lettura, qualcosa va storto.
    if (room && room !== api.DIREZIONE) {
      try { sessionStorage.setItem("laundryhub.chiediNotifiche", "1"); } catch {}
    }
    try { localStorage.setItem("laundryhub.room", room); } catch {}
    window.location.reload();
  }
  // Cambiare camera chiude anche la sessione amministrativa.
  //
  // Prima no, e il risultato era incoerente: "Esci" terminava la sessione,
  // "Cambia camera" lasciava la modalità amministratore attiva sotto un'altra
  // identità. Chi lascia la postazione tocca il pulsante che ha davanti, non
  // quello giusto in teoria — e un dispositivo condiviso restava con i poteri
  // di chi c'era prima. La sessione vive nel cookie, non nella camera: va
  // chiusa sul server, non basta dimenticare il numero.
  async function changeRoom() {
    if (adminRole !== null) {
      try {
        const { adminLogout } = await import("./AdminPanel");
        await adminLogout();
      } catch { /* offline: si esce comunque dalla camera */ }
    }
    try { localStorage.removeItem("laundryhub.room"); } catch {}
    window.location.reload();
  }

  // Un solo punto d'ingresso per tutte e tre le viste: se la camera è
  // DIREZIONE la richiesta passa dall'endpoint amministrativo (autorizzato dal
  // cookie di sessione, non dal client), altrimenti dal percorso normale.
  const handleBook = useCallback(async (day:number, slot:number, machine:string, room:string) => {
    try {
      const s = room === api.DIREZIONE
        ? await api.bookAsDirezione(day, slot, machine)
        : await api.book(day, slot, machine, room);
      setWeek(s.week); setStatus(s.status);
    } catch (e: any) {
      // La sessione DIREZIONE e' scaduta proprio mentre si tentava di
      // prenotare: niente errore generico, logout forzato come per qualunque
      // altra scadenza rilevata durante l'uso (vedi handleAdminSession sopra).
      if (e?.message === "SESSIONE_SCADUTA") { handleAdminSession(null); return; }
      throw e;
    }
  }, [handleAdminSession]);
  /**
   * Libera un turno.
   *
   * Per i residenti resta permissiva come sempre: senza login la camera è
   * autodichiarata, quindi un controllo di proprietà si aggirerebbe cambiando
   * una stringa nel browser.
   *
   * L'unica eccezione sono i turni della DIREZIONE, che il server protegge:
   * lì l'identità è verificata davvero, quindi difenderla ha senso. Chi ha la
   * sessione passa dal percorso amministrativo e può toglierli; gli altri
   * ricevono "riservata alla direzione".
   */
  const handleClear = useCallback(async (day:number, slot:number, machine:string) => {
    // Il percorso amministrativo si usa SOLO quando serve davvero, cioè su un
    // turno della Direzione. Per tutto il resto va bene quello pubblico, anche
    // per un amministratore: così l'unica strada che richiede la migrazione
    // 006 è quella che quella migrazione introduce, e nient'altro cambia
    // comportamento nel frattempo.
    const diChiE = week[day]?.[slot]?.[machine];
    try {
      const s = isAdmin && diChiE === api.DIREZIONE
        ? await api.clearAsDirezione(day, slot, machine)
        : await api.clearBooking(day, slot, machine);
      setWeek(s.week); setStatus(s.status);
    } catch (e: any) {
      if (e?.message === "SESSIONE_SCADUTA") { handleAdminSession(null); return; }
      throw e;
    }
  }, [isAdmin, week, handleAdminSession]);
  // Il residente segnala il guasto, non cambia lo stato: la segnalazione finisce
  // fra i feedback e un amministratore decide. Lo stato mostrato non cambia
  // subito, ed e' corretto cosi' — cambiera' quando l'admin l'avra' verificato.
  const handleStatus = useCallback(async (machine:string, _oos:boolean, nota?:string) => {
    await api.reportBroken(machine, nota);
  }, []);

  /**
   * Se mostrare la navigazione (barra in basso, selettore struttura, sidebar).
   *
   * Dipende SOLO dall'aver scelto una camera. Prima era
   * `roomNumber !== null && !loading && !error`, e quel `!error` era il motivo
   * per cui la barra in basso "spariva ogni tanto":
   *
   *   1. l'app è aperta e funziona, poi un refresh fallisce — basta un attimo
   *      di rete ballerina, un ascensore, il passaggio wifi/dati;
   *   2. `error` si popola e TUTTA la navigazione si smonta;
   *   3. se in quel momento eri su Cinema o Musica, il corpo continua a
   *      mostrare la sala (il ramo d'errore vale solo per la lavanderia),
   *      quindi restavi su una schermata senza più alcun modo di uscirne.
   *
   * Un errore di rete transitorio non è un buon motivo per togliere di mezzo
   * la navigazione: i dati già caricati sono ancora in `week`/`status` e
   * restano validi. L'errore va detto nel corpo, dove c'è il pulsante Riprova,
   * non facendo sparire i comandi.
   */
  const showChrome = roomNumber !== null;
  const isDesktop  = useMediaQuery("(min-width: 768px)");

  const globalStyle = (
    <style>{`
      @keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      .animate-toast-in{animation:toast-in .22s ease}
      @keyframes spin{to{transform:rotate(360deg)}}
      .animate-spin-slow{animation:spin 1s linear infinite}
      *{scrollbar-width:none}*::-webkit-scrollbar{display:none}
      .desk-nav{transition:background .15s ease}
      .desk-nav:hover{background:var(--secondary)}
    `}</style>
  );

  const mainContent = loading ? (
    <CenterState>
      <Loader2 size={28} className="animate-spin-slow" style={{ color:RED }}/>
      <p className="text-sm">{t.loading}</p>
    </CenterState>
  ) : error ? (
    <CenterState>
      <AlertTriangle size={28} style={{ color:OOS_T }}/>
      <p className="text-sm">{t.netError}</p>
      <p className="text-xs mt-2" style={{ color: "#888", userSelect: "text" }}>{error}</p>
      <button onClick={()=>{ setLoading(true); refresh(); }}
        className="mt-1 rounded-xl px-4 py-2 text-sm font-semibold" style={{ background:RED, color:RED_FG }}>
        {t.retry}
      </button>
    </CenterState>
  ) : roomNumber === null ? (
    <LoginScreen lang={lang} onLogin={chooseRoom} onAdmin={() => setAdminLoginOpen(true)}/>
  ) : (
    <>
      {screen===0 && <Dashboard   theme={theme} lang={lang} week={week} status={status} roomNumber={roomNumber} favs={favs} onToggleFav={toggleFav} onBook={handleBook} onClear={handleClear} onGoDay={vaiAlGiorno}/>}
      {screen===1 && <DaySchedule theme={theme} lang={lang} week={week} status={status} roomNumber={roomNumber} favs={favs} onToggleFav={toggleFav} onBook={handleBook} onClear={handleClear} isAdmin={isAdmin} onScreen={setScreen}/>}
      {screen===2 && <WeekOverview theme={theme} lang={lang} week={week} status={status} roomNumber={roomNumber} onBook={handleBook} onClear={handleClear} isAdmin={isAdmin} onScreen={setScreen}/>}
    </>
  );

  // Lavanderia → schermate laundry; Cinema/Musica/Conferenze → sala a corpo
  // intero; sezioni riservate → pannello amministrativo, nello stesso corpo
  // pagina. Un if/else unico invece di due booleani (isRoom, isPienaPagina)
  // derivati dallo stesso confronto ripetuto: quella forma confondeva il
  // narrowing di TypeScript, che finiva per segnare "conferenze" irraggiungibile.
  //
  // `isPienaPagina` e' sparito con la barra in fondo: serviva solo a nasconderla
  // nelle viste a corpo intero, e adesso non c'e' piu' niente da nascondere.
  let bodyContent: React.ReactNode;
  if (isAdminFacility(facility)) {
    // px-5 come le sezioni della lavanderia: senza, le schede amministrative
    // toccavano i bordi dello schermo sul telefono — il corpo pagina non ha
    // padding proprio, se lo mettono le viste.
    // pt-4 oltre al px-5: le altre viste cominciano con un'intestazione che
    // porta il suo margine, le sezioni amministrative no e partivano incollate
    // ai selettori qui sopra.
    bodyContent = <div className="px-5 pt-4"><Suspense fallback={null}><AdminScreens tab={facility} onSession={handleAdminSession}/></Suspense></div>;
  } else if (facility === "conferenze") {
    bodyContent = <Conferenze lang={lang} adminRole={adminRole}/>;
  } else if (facility === "cinema" || facility === "music") {
    bodyContent = <RoomView room={facility} lang={lang} roomNumber={roomNumber}/>;
  } else if (facility === "bike") {
    bodyContent = <BiciView lang={lang} roomNumber={roomNumber}/>;
  } else if (facility === "guasto") {
    bodyContent = (
      <SegnalaGuastoSheet lang={lang} status={status} onStatus={handleStatus}
        roomNumber={roomNumber}/>
    );
  } else if (facility === "impostazioni") {
    bodyContent = (
      <SettingsSheet lang={lang} room={roomNumber} adminRole={adminRole}
        onLang={(l)=>{ setLang(l); salvaLingua(l); }}
        temaPref={temaPref} onTema={cambiaTema}
        onAccessibility={() => setAccessibilityOpen(true)}
        onClose={() => setFacility("laundry")}/>
    );
  } else if (facility === "feedback") {
    bodyContent = <FeedbackModal lang={lang} room={roomNumber} onClose={() => setFacility("laundry")}/>;
  } else {
    bodyContent = mainContent;
  }

  // Pannello accessibilità (modale, condiviso tra mobile e desktop)
  const accessibilityModal = accessibilityOpen && (
    <AccessibilityPanel
      lang={lang}
      prefs={_aPrefs}
      onPrefsChange={handleAccessibilityChange}
      onClose={() => setAccessibilityOpen(false)}
    />
  );

  // Login amministratore: si apre digitando 1935 al posto della camera.
  // Chi amministra non ha una camera propria: la sua identità è DIREZIONE, e
  // con quella prenota — turni di lavanderia e sale — senza dover scegliere
  // ogni volta per conto di chi sta agendo.
  const adminLoginSheet = adminLoginOpen && (
    <Suspense fallback={null}>
      <AdminLoginSheet
        onClose={() => setAdminLoginOpen(false)}
        onSession={(r, deveCambiare) => {
          handleAdminSession(r, deveCambiare);
          if (r && roomNumber !== api.DIREZIONE) chooseRoom(api.DIREZIONE);
        }} />
    </Suspense>
  );

  // La password provvisoria si cambia PRIMA di qualunque altra cosa.
  //
  // Il divieto vero è lato server (api/admin/data.js rifiuta ogni azione
  // tranne il cambio password), ma finché questo gate non c'era lo si
  // scopriva solo sbattendoci contro: si entrava, si atterrava in lavanderia
  // come DIREZIONE, e la prima prenotazione falliva con un messaggio che
  // arrivava a cose fatte. La schermata dentro AdminScreens copriva solo chi
  // apriva una sezione amministrativa — non chi restava nell'app normale.
  //
  // Sta qui e non dentro il pannello perché una sessione admin cambia cosa
  // fa l'app INTERA (si prenota come DIREZIONE): il momento in cui la
  // password provvisoria è ancora buona non deve esistere in nessuna
  // schermata, non solo nelle sezioni riservate.
  const cambioPasswordGate = deveCambiarePassword && (
    <div className="absolute inset-0 z-[60] overflow-y-auto" style={{ background:"var(--background)" }}>
      <Suspense fallback={null}>
        <CambiaPasswordObbligata
          onFatto={() => {
            // Rilegge dal server invece di fidarsi: è il server ad avere
            // l'ultima parola su quando l'obbligo è soddisfatto.
            api.adminSession().then(({ role, deveCambiarePassword: deve }) =>
              handleAdminSession((role as AdminRole) ?? null, deve));
          }}
        />
      </Suspense>
    </div>
  );

  const reminderPromptSheet = reminderPrompt && roomNumber && (
    <WelcomeReminderPrompt lang={lang} room={roomNumber} onClose={() => setReminderPrompt(false)}/>
  );

  if (isDesktop) {
    return (
      <div className="relative h-dvh w-full flex overflow-hidden"
        style={{ fontFamily:"'DM Sans', sans-serif", background:"var(--background)" }}>
        <TemaEffetto tema={tema} />
        {globalStyle}
        {showChrome && <InstallPrompt lang={lang}/>}
        {accessibilityModal}
        {adminLoginSheet}
        {cambioPasswordGate}
        {reminderPromptSheet}
        <DesktopSidebar
          lang={lang}
          roomNumber={roomNumber} showNav={showChrome}
          facility={facility} onFacility={setFacility}
          adminRole={adminRole}
          onChangeRoom={changeRoom}
        />
        <main className="flex-1 h-dvh min-h-0 flex flex-col overflow-y-auto overscroll-contain">
          {/* Era max-w-6xl (1152px): su uno schermo grande restavano centinaia
              di pixel vuoti ai lati mentre la griglia settimanale stava
              stretta. 1600px sfrutta lo spazio senza arrivare al bordo su
              monitor molto larghi, dove le righe diventerebbero illeggibili
              da seguire con l'occhio. */}
          <div className="mx-auto w-full max-w-[1600px] flex-1 min-h-0 flex flex-col px-4 lg:px-8">
            {bodyContent}
          </div>
        </main>
      </div>
    );
  }

  // Icona della struttura/pagina corrente, per l'intestazione mobile.
  // Stessa fonte di FACILITIES/ADMIN_SECTIONS/PAGINE_UTILITA usata poco sotto
  // per il nome: cosi' icona e testo non possono mai disallinearsi.
  const TopbarIcon = isAdminFacility(facility)
    ? ADMIN_SECTIONS.find((x) => x.id === facility)!.icon
    : facility === "guasto" ? Wrench
    : facility === "impostazioni" ? Settings
    : facility === "feedback" ? MessageSquare
    : FACILITIES.find((x) => x.id === facility)!.icon;

  return (
    <div className="min-h-dvh w-full flex items-center justify-center md:py-8"
      style={{ fontFamily:"'DM Sans', sans-serif", background:"var(--muted)" }}>
      {globalStyle}
      <div className="relative flex flex-col overflow-hidden w-full h-dvh md:h-[844px] md:max-w-[420px] md:rounded-[3rem] md:shadow-2xl md:border"
        style={{ background:"var(--background)", borderColor:"var(--border)" }}>
        <TemaEffetto tema={tema} />
        {showChrome && <InstallPrompt lang={lang}/>}
        {accessibilityModal}
        {adminLoginSheet}
        {cambioPasswordGate}
        {reminderPromptSheet}

        <div className="flex items-center justify-between px-7 pt-3 pb-0 shrink-0 mt-2 md:mt-0">
          {/* Prima di scegliere una camera qui c'era un orologio finto (9:41,
              lo stesso hardcoded in ogni mockup Apple): non è mai stata l'ora
              vera e non serviva a niente, solo confondeva. */}
          {/* A sinistra: il menu delle strutture e dove ci si trova adesso.
              Il nome serve proprio perche' le pastiglie non ci sono piu': senza,
              aprendo Cinema non ci sarebbe piu' niente che dica "sei nel
              cinema". */}
          <div className="flex items-center gap-2 min-w-0">
            {showChrome && (
              <button onClick={() => setMenuAperto(true)} aria-label={T[lang].navStrutture}
                className="p-1.5 -ml-1.5 rounded-lg transition-colors" style={{ color:"var(--gray-accessible-text)" }}>
                <Menu size={18}/>
              </button>
            )}
            {showChrome && (
              <>
                <TopbarIcon size={16} className="shrink-0" style={{ color:"var(--foreground)" }}/>
                <span className="text-sm font-bold truncate" style={{ color:"var(--foreground)" }}>
                  {isAdminFacility(facility)
                    ? T[lang][ADMIN_SECTIONS.find((x) => x.id === facility)!.chiave]
                    : PAGINE_UTILITA.some((x) => x.id === facility)
                      ? T[lang][PAGINE_UTILITA.find((x) => x.id === facility)!.chiave]
                      : T[lang][FACILITIES.find((x) => x.id === facility)!.chiave]}
                </span>
              </>
            )}
          </div>
          <div className="w-24 h-6 rounded-full hidden md:flex items-center justify-center" style={{ background:"var(--secondary)" }}>
            <div className="w-3 h-3 rounded-full border" style={{ background:"var(--background)", borderColor:"var(--border)" }}/>
          </div>
          {/* Il refresh manuale è sparito: tornare sull'app ricarica già i
              dati da sola. Il tema segue sempre quello del telefono. Lingua,
              notifiche, installazione e accessibilità stanno tutte dentro
              Impostazioni, invece di quattro-cinque icone separate. */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Il saluto vive qui adesso, non piu' in una riga sua sopra la
                dashboard: "Buonasera, Camera 318" invece di due pezzi
                separati che dicevano in fondo la stessa cosa — chi sei e che
                ora e' — gia' scritta nella barra di stato del telefono.

                La camera pesa piu' del saluto: e' l'informazione che conta
                (a chi sto guardando la lavanderia?), il saluto e' solo
                educazione. Prima erano la stessa riga grigia, stesso peso —
                qui la camera ha il suo badge rosso e si legge per prima. */}
            {roomNumber !== null && (
              <button onClick={changeRoom}
                className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg transition-colors"
                style={{ background:"var(--secondary)" }}>
                <span className="text-[11px] font-mono" style={{ color:"var(--gray-accessible-text)" }}>
                  {T[lang].greeting(new Date().getHours())}
                </span>
                <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded-md"
                  style={{ background:`color-mix(in srgb, var(--primary) 16%, transparent)`, color:RED }}>
                  {roomNumber === api.DIREZIONE ? T[lang].direzioneNome : `${T[lang].camera} ${roomNumber}`}
                </span>
              </button>
            )}
          </div>
        </div>

        <MenuStrutture aperto={menuAperto} onClose={() => setMenuAperto(false)}
          facility={facility} onChange={setFacility} lang={lang} adminRole={adminRole} roomNumber={roomNumber}/>

        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 flex flex-col mt-2">
          {bodyContent}
        </div>


        <div className="pb-2 hidden md:flex justify-center shrink-0">
          <div className="w-28 h-1 rounded-full" style={{ background: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}/>
        </div>
      </div>
    </div>
  );
}