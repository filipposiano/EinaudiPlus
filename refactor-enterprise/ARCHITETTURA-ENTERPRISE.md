# EinaudiPlus — Piano di rifattorizzazione verso un Monolite Modulare

> Documento di analisi e proposta architetturale. Nessun file dell'applicazione esistente è stato modificato: questa cartella (`refactor-enterprise/`) vive accanto al codice attuale e non viene importata da nulla in produzione.

Data analisi: 2026-09-13

> **Aggiornamento**: la migrazione descritta qui è stata completata. Tutti e nove i domini della Sezione 2 sono moduli veri, collegati agli adapter e verificati contro produzione (242 unit test + suite end-to-end). Dettaglio in [README.md](./README.md). Questo documento resta come registro dell'analisi originale; le sezioni sotto descrivono lo stato *iniziale* (as-is) che ha motivato il lavoro, non lo stato attuale.

---

## 0. Perché questo documento

L'app è cresciuta come singola pagina + un pugno di funzioni serverless, senza confini di dominio: tutto vive a livello di root (`App.tsx` da 3072 righe, `AdminPanel.tsx` da 2636 righe) e `api/admin/data.js` è un unico switch da 650 righe che fa da controller per almeno otto domini di business diversi. L'obiettivo di questo documento è disegnare un **Monolite Modulare**: stessa base di codice, stesso deploy (Vercel + Supabase), ma con confini interni netti, sicurezza di produzione e codice manutenibile/testabile.

Questo non è un rifacimento da zero. Il codice attuale, letto da vicino, mostra scelte di sicurezza già ragionate (scrypt + confronto a tempo costante, rate limiting su Postgres, CSP già stretta, verifica CSRF via header custom). Il problema non è "il codice è insicuro dappertutto", è che **manca struttura**: le buone pratiche esistono ma sono ripetute a mano ovunque invece che imposte una volta sola, e i domini sono mescolati fra loro.

---

## 1. Situazione attuale (as-is)

### 1.1 Superficie del codice

```
api/
  admin/auth.js     (74 righe)   — login pannello
  admin/data.js     (666 righe)  — TUTTO il resto del pannello: switch su ~35 action
  rooms.js          (74 righe)   — spazi comuni (cinema, sala musica) — nome fuorviante
  laundry.js        (171 righe)  — lavanderia + bici + feedback + push-subscribe
  conferenze.js     (28 righe)   — lettura pubblica sala conferenze
  telegram.js       (107 righe)  — webhook bot
  cron.js           (127 righe)  — tick promemoria
  health.js         (86 righe)
  _lib/{db,http,auth,push,telegram}.js  — kernel condiviso

App.tsx             (3072 righe) — shell + quasi tutta la UI residente
AdminPanel.tsx      (2636 righe) — intero pannello amministrativo
Rooms.tsx, Bici.tsx, Conferenze.tsx, ... — feature isolate ma non isolate a livello di stato/API
```

### 1.2 Cosa non è un problema (da non toccare)

- `vercel.json`: CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy` già configurati correttamente.
- Password: scrypt con confronto a tempo costante (`crypto.timingSafeEqual`), hash fasullo per non rivelare quali username esistono via timing.
- Cookie di sessione: `HttpOnly`, `Secure`, `SameSite=Strict`, versionato (`v: 2`) per invalidare sessioni vecchie.
- Rate limiting su login admin (5 tentativi/15 min) e su broadcast push (3/30 min per account, non per IP — scelta corretta perché segue "chi", non "da dove").
- Validazione dell'endpoint push contro SSRF (`endpointAllowed`) — il commento nel codice documenta un test reale con l'indirizzo dei metadata cloud (`169.254.169.254`) che veniva accettato prima della fix.
- Fail-closed sul webhook Telegram se manca il secret — corretto, e il codice stesso nota che era l'unico dei tre endpoint sensibili a non fallire chiuso prima della fix.

Questi punti vanno **preservati esattamente come sono** durante la migrazione, non "modernizzati".

### 1.3 Cosa è un problema

Vedi Sezione 3 (Security Audit) per il dettaglio con severità e rimedio.

---

## 2. Domini logici (Bounded Context)

| Dominio | Responsabilità | Dove vive oggi |
|---|---|---|
| **Identity** | Login FDO/staff/sistemista, sessioni, gestione account, cambio password | `api/admin/auth.js`, azioni `account*` in `api/admin/data.js` |
| **Laundry** | Prenotazione lavatrici/asciugatrici, stato macchine, regole ricorrenti | `api/laundry.js`, azioni lavanderia in `api/admin/data.js` |
| **Common Spaces** | Cinema, sala musica | `api/rooms.js` |
| **Conference Room** | Sala conferenze: regole, ricorrenza, eccezioni, spostamenti | `api/conferenze.js` (lettura) + azioni `conferenza*` in `api/admin/data.js` (scrittura) |
| **Bikes** | Censimento bici per camera | `bikeGet/bikeSet` in `api/laundry.js` + azioni `bici*` in `api/admin/data.js` |
| **Feedback** | Segnalazioni dei residenti | `feedback` in `api/laundry.js` + `markFeedback` in `api/admin/data.js` |
| **Notifications** | Push web, Telegram, promemoria automatici, broadcast manuale | `api/_lib/push.js`, `api/_lib/telegram.js`, `api/telegram.js`, `api/cron.js` |
| **Theme** | Tema stagionale (Halloween, Natale) | `temaGet/temaSet` in `api/admin/data.js` |
| **Ops / Sysadmin** | Purge dati, conteggi, audit log, retention | Azioni `purge`, `counts`, `recurring*` in `api/admin/data.js` |
| **Shared Kernel** | Client RPC verso Supabase, validazione input, helper HTTP | `api/_lib/db.js`, `api/_lib/http.js` |

Nota su `api/laundry.js`: il codice stesso ammette che bici, feedback e push-subscribe ci vivono "perché è l'unico endpoint pubblico già legato a una camera" — è la prova più diretta della mancanza di confini che questo piano corregge.

---

## 3. Nuova architettura: alberatura proposta

```
EinaudiPlus/
├─ api/                          # Adapter Vercel — SOLO instradamento HTTP, zero logica di dominio
│  ├─ admin/
│  │  ├─ auth.js                 → delega a src/modules/identity
│  │  └─ data.js                 → risolve modulo+action e delega, non contiene più lo switch di business
│  ├─ rooms.js                   → src/modules/common-spaces
│  ├─ laundry.js                 → src/modules/laundry (bici/feedback/push restano richiamabili
│  │                                per compatibilità URL, ma solo come forwarding al modulo giusto)
│  ├─ conferenze.js              → src/modules/conference-room
│  ├─ telegram.js                → src/modules/notifications
│  ├─ cron.js                    → src/modules/notifications
│  └─ health.js                  → src/shared/health
│
├─ src/
│  ├─ modules/
│  │  ├─ identity/
│  │  │  ├─ domain/               (ruoli, regole password)
│  │  │  ├─ application/          (use-case: login, createAccount, changeOwnPassword...)
│  │  │  ├─ infrastructure/       (sessionToken, accountRepository → rpc)
│  │  │  └─ index.ts              ← unica superficie importabile da fuori il modulo
│  │  ├─ laundry/          {domain,application,infrastructure,index.ts}
│  │  ├─ common-spaces/    {...}
│  │  ├─ conference-room/  {...}
│  │  ├─ bikes/            {...}
│  │  ├─ feedback/         {...}
│  │  ├─ notifications/    {...}
│  │  ├─ theme/            {...}
│  │  └─ ops/              {...}
│  │
│  ├─ shared/                     # Kernel condiviso — NESSUNA logica di dominio qui dentro
│  │  ├─ db/                      (client RPC verso Supabase/PostgREST — sostituisce _lib/db.js)
│  │  ├─ http/                    (readBody, response JSON uniforme, rate-limit dichiarativo)
│  │  ├─ errors/                  (AppError, wrapHandler centralizzato)
│  │  ├─ logging/                 (logger strutturato con request id)
│  │  └─ config/                  (env var tipizzate, validate all'avvio del processo)
│  │
│  └─ contracts/                  # Tipi condivisi fra moduli (Piano, Room, Ruolo...)
│
├─ web/                           # Frontend riorganizzato per feature
│  ├─ app/                        (App.tsx spezzato in shell + routing + providers)
│  ├─ features/
│  │  ├─ laundry/  common-spaces/  conference-room/  bikes/  admin/  accessibility/
│  ├─ i18n/
│  └─ shared-ui/
│
├─ supabase/                      # invariato — le migrazioni SQL restano l'autorità sui vincoli
└─ tests/
   ├─ unit/                       (mirror di src/modules — mock del repository, no rete)
   └─ integration/                (un file per endpoint api/*, contro un Supabase di test)
```

### Regola di confine (da far rispettare in CI, non solo a parole)

Un modulo **non importa mai** un file interno di un altro modulo — solo il suo `index.ts`. Si applica con `eslint-plugin-boundaries` (o `import/no-restricted-paths`), così un PR che viola il confine fallisce la build invece di essere scoperto a revisione.

---

## 4. Security Audit — problemi rilevati e rimedio

| # | Problema | Gravità | Rimedio | Stato |
|---|---|---|---|---|
| 1 | Segreti reali (`SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`, `CRON_SECRET`) presenti in chiaro in `.env.local`, letti durante questa analisi | **Critico — azione manuale immediata** | Ruotare le chiavi da Supabase Dashboard / Vercel env vars. Non è un problema di architettura. | ⏳ **azione dell'utente**, non del codice |
| 2 | Error handling non centralizzato: ogni `api/*.js` reimplementa il proprio try/catch; `admin/data.js` restituisce `err.message` grezzo al client | Alto | `shared/errors`: classe `AppError` + `wrapHandler()` unico usato da ogni adapter | ✅ fatto — `wrapHandler` su tutti gli adapter tranne `telegram.js` (contratto diverso, logger diretto) |
| 3 | Autorizzazione admin gestita con tre `Set()` in `admin/data.js`, da tenere sincronizzati a mano | Alto | La policy vive dentro il modulo proprietario (`authorize(role, action)`) | ✅ fatto — nove `authorize()`, uno per modulo, provati in sequenza in `authorizeAction()` |
| 4 | Validazione input manuale e ripetuta — bug noti: bypass cambio-password, buco su `LIMITI` | Medio | Contratto di validazione nello strato `application/` di ogni modulo | ✅ fatto — validazione manuale (non Zod: nessuna dipendenza aggiunta, coerente con lo stile del progetto), ma un contratto per modulo, non un dizionario condiviso. `LIMITI` **rimosso interamente** |
| 5 | `tokenOk()`/`APP_TOKEN` rischia di essere scambiato per un vero controllo d'accesso | Basso | Rinominarlo esplicitamente | ✅ fatto — funzione rinominata `botFilterTokenOk`. La variabile d'ambiente `APP_TOKEN` resta invariata: rinominarla è un intervento sulla configurazione Vercel, separato da questo |
| 6 | Rate limiting invocato manualmente (`allow()`) endpoint per endpoint | Medio | Primitiva centralizzata | ✅ fatto — `checkRateLimit()` in `shared/http/rateLimit.js`, unico punto per tutti i bucket (IP e per-account) |
| 7 | Logging non strutturato, tag ad-hoc, nessun request id | Medio | Logger unico in `shared/logging` | ✅ fatto — adottato da `wrapHandler` ovunque si applica |
| 8 | Nessuna copertura di test sullo switch da 650 righe | Medio | Use-case puri, testabili in isolamento | ✅ fatto — 242 unit test, nessuna rete |
| 9 | Domain creep: bici, feedback, push-subscribe in `api/laundry.js` | Medio | Un modulo per dominio, stesso URL pubblico | ✅ fatto — `bikes`, `feedback`, `notifications` sono moduli propri; `api/laundry.js` delega, non possiede più la logica |
| 10 | CSP, HSTS, `X-Frame-Options`, `Referrer-Policy` in `vercel.json` | — | Nessuna azione | — invariato, come da piano |

---

## 5. Manutenibilità

- **Logging strutturato**: un solo logger (`shared/logging`), mai più `console.error` sparso; ogni voce porta `requestId`, modulo, action.
- **Error handling centralizzato**: un solo `wrapHandler()` attraversato da tutti gli adapter in `api/`; gli adapter stessi si riducono a poche righe di puro instradamento.
- **Testabilità**: dentro ogni modulo, `application/` (logica pura) è separato da `infrastructure/` (chiamate RPC) — oggi è impossibile testare `admin/data.js` senza un database vero, dopo sarà possibile testare ogni use-case da solo.
- **Config validata all'avvio**: `shared/config` legge e valida le env var una volta sola (tipizzate), invece del pattern attuale di controllare `Boolean(process.env.X)` sparso in ogni file (`dbConfigured()`, `adminConfigured()`, `pushConfigured()`, `telegramConfigured()` duplicano la stessa idea in quattro punti diversi).

---

## 6. Piano di migrazione (strangler pattern, non invasivo)

1. **Nessun big-bang**: si lavora modulo per modulo dentro `src/modules/`, un dominio alla volta, a partire da quello con meno dipendenze (candidato: `theme`, il più piccolo, per validare il pattern) e poi via via verso `identity` e `laundry` (i più critici).
2. Gli adapter in `api/*.js` continuano a rispondere **esattamente agli stessi URL, verbi e contratti** già in uso dal client installato sui telefoni (vincolo esplicito documentato più volte nel codice attuale: il "cutover" da Google Apps Script non è ancora concluso per tutti i client).
3. Ogni modulo migrato porta con sé la propria suite di test unit prima di essere collegato all'adapter.
4. Nessun merge su `main`/deploy in produzione finché un modulo non è verificato in isolamento — coerente con l'aver messo questo piano in una cartella separata invece che iniziare a modificare i file esistenti.
5. Solo a migrazione di tutti i moduli completata si rimuove lo switch monolitico in `api/admin/data.js`, sostituendolo con il semplice instradamento verso i moduli.

## 7. Cosa esplicitamente NON cambia in questa fase

- Nessuna migrazione SQL: `supabase/` resta l'autorità sui vincoli, invariata.
- Nessuna modifica a `vercel.json` (già corretto).
- Nessun cambio di libreria di sessione/hash (scrypt + HMAC restano, sono scelte corrette e già motivate nel codice).
- Nessun endpoint pubblico cambia URL o contratto.
