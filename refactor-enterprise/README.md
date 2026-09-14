# refactor-enterprise — analisi e stato della migrazione

Questa cartella contiene l'analisi tecnica ([ARCHITETTURA-ENTERPRISE.md](./ARCHITETTURA-ENTERPRISE.md)) e una presentazione narrativa del lavoro ([PRESENTAZIONE.md](./PRESENTAZIONE.md)). Le convenzioni operative per chi lavora sul codice sono in [CLAUDE.md](../CLAUDE.md), alla radice del progetto. Il codice vive nella sua posizione definitiva: `src/shared/`, `src/modules/*`.

## Stato: migrazione completa + secondo giro di irrobustimento

Tutti e nove i domini individuati nell'analisi iniziale sono moduli, collegati agli adapter Vercel e verificati contro il database di produzione:

| Modulo | Cosa possiede |
|---|---|
| **Identity** | Login, sessioni, cookie, gestione account, policy di autorizzazione |
| **Laundry** | Prenotazione/liberazione turni, stato macchine, override amministrativi, regola ricorrente |
| **Common Spaces** | Cinema/sala musica: prenotazione/cancellazione pubblica, panoramica, override, regola ricorrente |
| **Theme** | Lettura/scrittura del tema stagionale (riservate al sistemista) |
| **Notifications** | Iscrizioni push, collegamento Telegram, promemoria automatici (cron), broadcast, "avvisa una camera" |
| **Bikes** | Censimento bici per camera, override amministrativi (dipende da Notifications per gli avvisi) |
| **Feedback** | Segnalazioni residenti (pubblico + gestione admin) |
| **Conference Room** | Sala conferenze: agenda pubblica + regole/eccezioni amministrative |
| **Ops** | Regole ricorrenti generiche (trasversali a Laundry e Common Spaces), pulizia, conteggi, panoramica |

**247 unit test** (`npm run test:unit`), nessuna rete/database richiesti.

## Primo giro — kernel condiviso e migrazione dei domini

- **Logging centralizzato**: `wrapHandler()` avvolge ogni adapter con un contratto di risposta standard, logga in JSON strutturato invece di `console.error` sparso. `api/telegram.js` fa eccezione (risponde sempre 200 a Telegram), usa comunque il logger direttamente.
- **Rate limiting centralizzato**: `checkRateLimit(bucket, identificatore, limite, finestra)` in `src/shared/http/rateLimit.js`, sostituisce il vecchio `allow()` richiamato a mano e diversamente in ogni endpoint.
- **`LIMITI` (dizionario di validazione condiviso fra domini migrati e non) rimosso del tutto.** Ogni modulo valida i propri campi.
- **Autorizzazione per-modulo**: le due `Set()` centrali (`SOLO_SISTEMISTA`, `VIETATE_A_STAFF`) sono sparite, sostituite da un `authorize(claims, action)` per modulo.
- **File morti rimossi**: `api/_lib/{auth,db,push,telegram}.js`.

## Secondo giro — irrobustimenti

- **`npm audit fix`**: chiuse 5 vulnerabilità su 6 nelle devDependencies (toolchain di build, mai nel bundle di produzione). Resta solo esbuild/vite, che richiederebbe un salto di major version (Vite 8) con `--force` — non fatto, da decidere a parte.
- **Le quattro asimmetrie di validazione segnalate nel primo giro sono state chiuse**: `adminForceBook`, `adminClearAsDirezione` (Laundry) e `adminSetMachineStatus` (Laundry) ora validano la camera con `parseRoomNumber` (le prime due ammettono anche `"DIREZIONE"`, coerente con l'uso reale di quelle azioni); `adminBookAsDirezione` (Common Spaces, azione `bookSpaceDirezione`) valida lo slug della sala con `isValidSpace`. Unit test aggiornati per riflettere il nuovo comportamento invece del vecchio "fedele all'originale, non validato".
- **`tokenOk` rinominato in `botFilterTokenOk`**: il nome ora dice da solo cosa fa (filtro anti-scanner, non autorizzazione) invece di rischiare di essere scambiato per un controllo di sicurezza vero. La variabile d'ambiente `APP_TOKEN` resta invariata di proposito: rinominarla è un intervento sulla configurazione Vercel, separato da questo.
- **Audit log centralizzato**: `src/shared/audit/auditLog.js` (`logAdminAction`) sostituisce due chiamate `rpc("admin_log", ...)` duplicate (login/logout in `admin/auth.js`, mutazioni in `admin/data.js`), ognuna con la propria gestione d'errore leggermente diversa — ora un solo punto, stesso comportamento (sempre best-effort, mai far fallire l'azione vera).
- **Regola di confine imposta da ESLint**: `eslint-plugin-boundaries` (config in `eslint.config.js`, root del progetto) blocca alla build un modulo che importa i file interni di un altro invece del suo `index.js`. Verificato empiricamente creando un import scorretto di prova (bloccato correttamente) prima di confermare che l'intero `src/modules/` passa pulito. `npm run lint`.
- **CI** (`.github/workflows/ci.yml`): a ogni push/PR gira `npm run test:unit`, `tsc --noEmit`, `npm run lint`, `npx vite build`. Deliberatamente **non** include `npm test` (la suite contro produzione): non esiste uno staging, e farla girare in CI vorrebbe dire mettere segreti di produzione veri in GitHub Actions — decisione operativa non presa qui.
- **`CLAUDE.md`** (root del progetto): convenzioni per chi lavora sul codice — pattern di un modulo, regola di confine, error handling, come testare, l'avviso su `npm test` contro produzione.
- **`PRESENTAZIONE.md`**: sintesi narrativa del lavoro, senza dettagli tecnici — per chi deve capire cosa è cambiato senza leggere il codice.

## Scelte di fedeltà deliberate rimaste (non ovvie, documentate invece di "corrette" silenziosamente)

- **Irrigidimento deliberato**: diversi campi (`laundry_id`, `day`, `slot`, `start`, `end`, `space_id`, `giorno`, `limit`) devono essere *presenti*, non solo validi se presenti — il vecchio `LIMITI` saltava il controllo su un campo del tutto assente. Verificato che nessuna azione della suite di test manda questi campi come assenti.
- **`getAgenda`** (sala conferenze pubblica) fa eccezione: un valore mancante o malformato ricade sul default (30 giorni), non viene rifiutato — fedele all'originale, endpoint di sola lettura senza nulla da proteggere.
- **Status HTTP delle validazioni**: rispondono con lo status che l'errore porta (400/429) invece del 200 di sempre — verificato che il client non lo nota.
- **Messaggio di autorizzazione unificato**: "permesso negato" al posto dei due messaggi originali diversi — conseguenza di avere un `authorize()` per modulo invece di due liste con messaggi diversi.
- **`sendDueReminders`** (cron): l'intero invio (push E Telegram) resta condizionato alla sola configurazione di push — comportamento preesistente, non introdotto qui.
- **`machine`** (nome macchina, es. "W-A") non è validato in nessuna azione, pubblica o admin — fedele all'originale ovunque, non un'asimmetria: il database filtra da sé sulle macchine "bookable" esistenti.

## Verifica fatta (entrambi i giri)

- `node --check` su ogni file toccato, `npx tsc --noEmit` pulito, `npx vite build` pulita.
- **247/247 unit test**, nessuna rete.
- Smoke test offline: caricamento di tutti gli adapter (nessun errore di import/dipendenza circolare) + percorsi non autenticati.
- **`npm test` contro il database di produzione**: **122/123**, stabile su più run consecutivi in questa sessione (anche dopo il secondo giro di hardening). L'unico residuo è una flakiness pre-esistente e documentata nel file stesso, verificata più volte come indipendente da queste modifiche.
- **Verifica mirata e auto-pulente** per sala conferenze e flusso reale delle bici (la suite esistente non li copriva affatto): 12/12.
- **Regola di confine ESLint**: verificata empiricamente con un import scorretto di prova, poi rimosso.

## Non fatto (fuori scope, deliberatamente)

- Nessuna modifica alle funzioni SQL/migrazioni: restano l'autorità sui vincoli.
- Salto di major version Vite/esbuild (l'unica vulnerabilità rimasta) — richiede test più ampi del solo `npm audit fix`.
- `npm test` non gira in CI (richiederebbe segreti di produzione in GitHub Actions).
- Frontend (`App.tsx`, `AdminPanel.tsx`) non toccato: stesso problema di struttura del backend prima di questo lavoro, ma è un progetto a sé.
- Nessuna osservabilità/alerting oltre ai log strutturati.
