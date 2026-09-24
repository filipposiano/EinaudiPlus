# CLAUDE.md

Guida per chi (persona o agente) lavora su questo codice. Il "cosa fa l'app" e la mappa dei file vivono in [README.md](./README.md); il deploy e le variabili d'ambiente in [DEPLOY.md](./DEPLOY.md). Questo file copre le **convenzioni** — come è organizzato il backend e cosa aspettarsi lavorandoci.

## Architettura: monolite modulare

Il backend (`api/` + `src/`) è stato rifattorizzato da un flat di endpoint Vercel a un monolite modulare. Analisi completa, security audit e cronologia della migrazione in [refactor-enterprise/ARCHITETTURA-ENTERPRISE.md](./refactor-enterprise/ARCHITETTURA-ENTERPRISE.md) e [refactor-enterprise/README.md](./refactor-enterprise/README.md) — quei due file sono il registro storico, questo è la sintesi operativa.

```
api/                    # Adapter Vercel — SOLO istradamento HTTP, zero logica di dominio
  admin/{auth,data}.js
  laundry.js  rooms.js  conferenze.js  grigliata.js  telegram.js  cron.js  health.js
  _lib/http.js          # ciò che resta di puramente HTTP (readBody, json, fail, methodOk)

src/
  modules/<nome>/
    domain/             # regole pure: costanti, policy di autorizzazione, tipi
    application/        # use-case: orchestrano domain + infrastructure, validano l'input
    infrastructure/      # chiamate RPC/servizi esterni reali
    index.js             # ← UNICA superficie importabile da fuori il modulo

  shared/                # kernel condiviso — NESSUNA logica di dominio qui dentro
    db/rpcClient.js       # client RPC verso Supabase/PostgREST
    http/{response,rateLimit}.js
    errors/{AppError,wrapHandler}.js
    logging/logger.js
    validation/{number,room}.js
    audit/auditLog.js
```

Undici moduli: **Identity, Laundry, Common Spaces, Theme, Notifications, Bikes, Feedback, Conference Room, Ops, Linen Change, Grigliata**. Ognuno possiede per intero la propria fetta di `admin/data.js` di un tempo (business logic + validazione + autorizzazione), non solo un pezzo di UI.

Gli ultimi due, aggiunti dopo il refactor iniziale, seguono lo stesso pattern parola per parola — sono la prova che regge oltre il caso originale: **Linen Change** (`src/modules/linen-change`) decide grande/piccolo/nessuno per il cambio biancheria del martedì; **Grigliata** (`src/modules/grigliata`) introduce anche il primo ruolo "stretto" dell'app, **delegato** — non un quarto livello generico di fiducia operativa come fdo/staff/sistemista, ma un ruolo confinato a un'unica funzionalità (vedi `src/modules/identity/domain/roles.js`).

Un ruolo stretto introdotto dentro un sistema pensato per pochi ruoli generici apre quasi sempre lo stesso buco: OGNI policy esistente va riaperta e va deciso esplicitamente se escluderlo, perché un `return true` finale (comune a metà delle policy di questo progetto) lo concederebbe per default, non avendolo mai previsto. Non basta scrivere la policy del modulo nuovo: `laundry`, `common-spaces`, `ops`, `bikes`, `feedback`, `conference-room` e `linen-change` hanno tutti ricevuto `if (isDelegato(claims)) return false;` (o l'equivalente) per questo — vedi `laundry/domain/policy.js` per il commento esteso, e i test di ciascun modulo per la verifica.

## Regola di confine (imposta da ESLint, non solo a parole)

**Un modulo importa solo l'`index.js` di un altro modulo, mai i suoi file interni.** Verificato da `npm run lint` (`eslint-plugin-boundaries`, config in `eslint.config.js`) — un import come `from "../altro-modulo/infrastructure/xRepository.js"` fallisce la build. Un modulo che ha bisogno di un altro (es. Bikes → Notifications per gli avvisi, tutti i moduli → Identity per `isStaff`/`isSysadmin`) lo dichiara importando SOLO quell'`index.js`.

Dentro lo stesso modulo, `domain/`/`application/`/`infrastructure/` si importano liberamente fra loro.

## Il pattern di un modulo

Ogni file in `application/` ha la stessa forma:

```js
// src/modules/<modulo>/application/<useCase>.js
import { ValidationError } from "../../../shared/errors/AppError.js";

export async function useCase({ campo1, campo2 }, { xRepository }) {
  // 1. valida (throw ValidationError se l'input non va bene)
  // 2. orchestra domain + repository
  // 3. torna il risultato — niente qui sa nulla di HTTP (req/res)
}
```

Le dipendenze (repository, sender, altri moduli) sono **iniettate**, mai importate direttamente dentro l'use-case: è quello che li rende testabili con un finto al posto del vero, senza rete né database. `index.js` cablea le dipendenze reali una volta sola:

```js
// src/modules/<modulo>/index.js
const deps = { xRepository };
export async function useCase(input) { return _useCase(input, deps); }
```

Gli adapter in `api/*.js` chiamano solo queste funzioni di superficie — non conoscono `domain/`/`application/`/`infrastructure/` di nessun modulo.

## Autorizzazione: un `authorize()` per modulo

Non esistono più liste centrali (`SOLO_SISTEMISTA`, `VIETATE_A_STAFF`). Ogni modulo espone `authorize(claims, action)` in `domain/policy.js`:

- torna `null` se l'azione non è sua (il chiamante prova il modulo successivo)
- torna `true`/`false` se lo è

`api/admin/data.js` prova ogni `authorize()` in sequenza (`authorizeAction()`) finché uno non risponde. Aggiungere un'azione a un modulo **richiede** di decidere la sua policy lì — non c'è modo di dimenticarla in una lista esterna.

## Error handling ed errori tipizzati

- `src/shared/errors/AppError.js`: `ValidationError` (400), `UnauthenticatedError` (401), `ForbiddenError` (403), `RateLimitedError` (429) — tutti con `expose: true`, il loro messaggio è sicuro da mostrare al client.
- `src/shared/errors/wrapHandler.js`: avvolge l'intero handler di un adapter. Un `AppError` esposto torna col proprio messaggio/status; qualunque altro errore (bug, RPC grezza) torna un messaggio generico — mai uno stack trace al client, sempre il dettaglio nel log strutturato.
  - `wrapHandler(nome, handler, { exposeInternalErrors: true })`: usalo solo per endpoint amministrativi, dove il messaggio di un errore RPC grezzo è già la diagnosi per un admin autenticato (vedi `admin/data.js`).
  - `api/telegram.js` **non** usa `wrapHandler`: deve rispondere sempre 200 a Telegram anche in errore (altrimenti Telegram ritenta in loop) — contratto incompatibile. Usa comunque il logger strutturato direttamente.

## Rate limiting e validazione

- `src/shared/http/rateLimit.js`: `checkRateLimit(bucket, identificatore, limite, finestra)` — un'unica funzione, sostituisce l'`allow()` di un tempo. `identificatore` è l'IP (`clientIp(req)`) per i limiti anti-abuso generici, o un valore di dominio (es. lo username) per un limite di business come il broadcast — iniettato come dipendenza nel modulo, non importato a mano, per restare testabile.
- `src/shared/validation/{number,room}.js`: `parseIntInRange(v, min, max)` e `parseRoomNumber(v)` — usali per ogni campo numerico o "numero di camera" invece di validare a mano. Non esiste più un dizionario di validazione condiviso: ogni modulo valida i propri campi.

## Testare un modulo

`tests/unit/<modulo>.test.mjs` — uno per modulo, **nessuna rete, nessun Supabase**: gli use-case ricevono repository/sender finti come dipendenza. Stile del runner: `check(nome, condizione, dettaglio)` + un contatore finale, niente framework esterno (coerente con `tests/run.mjs`, il file di test end-to-end preesistente).

```bash
npm run test:unit   # tutti i moduli, secondi, nessuna rete
npm test            # end-to-end contro il database di PRODUZIONE — vedi sotto
npx tsc --noEmit    # type-check del frontend
npm run lint        # regola di confine fra moduli
```

## ⚠️ `npm test` gira contro produzione

**Non esiste un database di staging.** `tests/run.mjs` (la suite end-to-end preesistente, non toccata da questo refactor) fa prenotazioni vere, crea e cancella un account admin vero, contro il Supabase di produzione. È scritta per essere auto-pulente e a prova di questo, ma:

- non impostare mai `TEST_ALLOW_PURGE=1` a meno di volere davvero cancellare dati veri.
- un fallimento isolato in `"la regola sala non è ancora prenotata"` è una flakiness nota e documentata nel file stesso (collisione su dati di prenotazione reali) — non è quasi mai una regressione.
- se tocchi un endpoint pubblico o un'azione admin, verifica prima con `npm run test:unit` (gratis, veloce), poi con `npm test` con la stessa cautela di sempre.

## Filosofia di migrazione: fedeltà prima, hardening dopo — ed esplicito quando lo fai

Quando un modulo viene migrato da codice esistente, il comportamento originale si replica **esattamente**, incluse le sue asimmetrie — e quelle asimmetrie si documentano nel codice invece di "correggerle" silenziosamente. Se decidi di irrobustire qualcosa (aggiungere una validazione che prima non c'era), fallo in un passo dichiarato, con la sua motivazione nel commento e verificato che non rompa la suite esistente — non mescolato dentro un refactor "di forma".

## Frontend: riorganizzazione completata

`App.tsx` e `AdminPanel.tsx` erano i due file grandi (~3000 e ~2600 righe): entrambi sono stati spezzati in `features/<dominio>/`, speculari ai moduli backend. La verifica di questo lavoro ha richiesto il browser (visiva/interattiva) oltre a `tsc`/`vite build`, non solo test automatici — a differenza del backend.

Struttura per dominio, lato residenti e lato admin:

```
features/
  <dominio>/
    <Componenti residenti>.tsx     # es. Dashboard.tsx, Rooms.tsx, Bici.tsx
    admin/
      <Componenti admin>.tsx       # es. MacchineTab.tsx, BiciTab.tsx

  admin-shared/       # kernel condiviso SOLO dal pannello admin
    adminApi.ts         # call() — fetch verso /api/admin/data
    adminStyles.ts       # S — stili condivisi da ogni scheda
    adminHelpers.ts       # DAYS — usato da più di una scheda
    types.ts               # Role, Tab
```

Dodici domini lato admin: **Identity** (Login, Accounts, Session/AdminLoginSheet), **Laundry** (MacchineTab), **Feedback** (Segnalazioni), **Bikes** (BiciTab), **Common Spaces** (SaleTab — chiude/riapre una sala, es. per il deposito dei pacchi), **Ops** (Ricorrenti, Manutenzione — le due schede riservate al sistemista che toccano più domini insieme), **Notifications** (NotificheTab), **Theme** (Tema), **Conference Room** (GiornoSheetAdmin), **Linen Change** (CambioBiancheriaTab), **Grigliata** (GrigliataAdmin — l'unico visibile anche al ruolo **delegato**, non solo al sistemista). `App.tsx` e `AdminPanel.tsx` restano solo il guscio: routing fra facility/schede, login, sidebar, sessione, tema stagionale — più i re-export che tengono invariata la superficie pubblica per chi importa da loro (`App.tsx`: `LoginScreen`/`DesktopSidebar`/... restano lì; `AdminPanel.tsx`: `Role`, `Tab`, `AdminScreens`, `AdminLoginSheet`, `adminLogout`, `CambiaPasswordObbligata`, `GiornoSheetAdmin`).

`ADMIN_SECTIONS` in `App.tsx` (quali voci compaiono in navigazione, a chi) usa un elenco esplicito di ruoli per voce (`ruoli: Role[]`) e non due booleani di esclusione (`sistemistaOnly`/`staffEsclusa`, lo schema di prima): con quattro ruoli invece di tre un'esclusione sola non basta più a dire chi resta fuori. Aggiungendo un quinto ruolo, o una quinta voce, si estende quell'elenco — non si aggiunge un terzo booleano.

`RuotaPicker.tsx` e `pannelli.tsx` restano alla radice: sono condivisi da più feature, non appartengono a una sola. Stessa cosa per `hooks.ts`/`icons.tsx` (condivisi fra la shell di `App.tsx` e `features/laundry/`).

Un dominio admin può importare tipi da un altro (es. Segnalazioni importa `Laundry`/`Machine` da `features/laundry/admin/types.ts` per risolvere `setMachineStatus`) — rispecchia il fatto che anche il backend lo fa (Bikes → Notifications). Non c'è una regola ESLint di confine per il frontend come per `src/modules` (quella resta specifica al backend).

### ⚠️ `npm run dev` parla con la produzione

`vite.config.ts` fa da proxy di `/api/*` verso `https://einaudi-plus.vercel.app` — **il database vero**, non uno di prova (non esiste uno staging, stessa situazione del backend). Verificando nel browser durante `npm run dev`: naviga e leggi liberamente, ma non inviare prenotazioni, segnalazioni o azioni admin a meno di volerlo fare davvero e ripulire dopo.

## Cosa NON è ancora vero

- Nessuna osservabilità oltre ai log strutturati (niente alerting automatico su errori ripetuti).
- `npm test` non gira in CI (richiederebbe segreti di produzione in GitHub Actions — decisione operativa non presa).
