# refactor-enterprise — analisi e stato della migrazione

Questa cartella contiene solo l'analisi e il piano ([ARCHITETTURA-ENTERPRISE.md](./ARCHITETTURA-ENTERPRISE.md)). Il codice scaffoldato inizialmente qui dentro è stato **promosso** alla sua posizione definitiva, quella descritta nell'alberatura del documento:

- `src/shared/` — kernel condiviso (errori, error handling centralizzato, risposta HTTP, logging, config, client RPC, validazione condivisa in `validation/`).
- `src/modules/identity/` — modulo Identity completo e collegato in produzione: login, sessioni, cookie, gestione account, policy di autorizzazione.
- `src/modules/laundry/` — completo e collegato in produzione: prenotazione/liberazione turni, stato macchine, override amministrativi, regola ricorrente.
- `src/modules/common-spaces/` — completo e collegato in produzione: prenotazione/cancellazione pubblica (cinema, sala musica), panoramica e override amministrativi, regola ricorrente. Deliberatamente FUORI: `recurringList/SetActive/Delete/applyRecurring` (trasversale a lavanderia e sale, futuro modulo "ops") e la sala conferenze (dominio a sé, `conference-room`, non ancora scaffoldato).
- `src/modules/theme/` — modulo Theme (tema stagionale) **scaffoldato e testato, non ancora collegato**: il più piccolo dei quattro — sola lettura/scrittura del tema attivo, entrambe riservate al sistemista. La lettura lato residenti non passa da qui: è già inclusa nella risposta di `laundry_snapshot` (campo `tema`), letta dal modulo Laundry — nessun endpoint da duplicare.
- `tests/unit/identity.test.mjs`, `tests/unit/laundry.test.mjs`, `tests/unit/common-spaces.test.mjs`, `tests/unit/theme.test.mjs` — unit test dei quattro moduli, nessuna rete/database richiesti (`npm run test:unit`).

## Stato di avanzamento

| Passo | Stato |
|---|---|
| Scaffold del modulo Identity (domain/application/infrastructure) | ✅ fatto |
| Unit test del modulo, isolati da Supabase | ✅ fatto — 29/29, `npm run test:unit` |
| `api/admin/auth.js` collegato direttamente al modulo (login/logout/whoami) | ✅ fatto |
| `api/admin/data.js` migrato a chiamare il modulo direttamente per le azioni `account*` | ✅ fatto |
| `api/_lib/auth.js` (adapter di compatibilità) | ✅ rimosso — nessun consumatore rimasto, il modulo è l'unica fonte di verità |
| Scaffold del modulo Laundry (domain/application/infrastructure) | ✅ fatto — 33/33 unit test, `npm run test:unit` |
| `api/laundry.js` (book/clear/lettura griglia) collegato al modulo | ✅ fatto |
| Azioni lavanderia di `api/admin/data.js` (week, setMachineStatus, deleteBooking, forceBook, bookDirezione, clearDirezione, recurringAddLaundry) collegate al modulo | ✅ fatto |
| Scaffold del modulo Common Spaces (domain/application/infrastructure) | ✅ fatto — 26/26 unit test, `npm run test:unit` |
| `api/rooms.js` (book/clear/lettura) collegato al modulo | ✅ fatto |
| Azioni sale di `api/admin/data.js` (spaces, deleteSpaceBooking, bookSpaceDirezione, recurringAddSpace) collegate al modulo | ✅ fatto |
| Scaffold del modulo Theme (domain/application/infrastructure) | ✅ fatto — 15/15 unit test, `npm run test:unit` |
| Azioni tema di `api/admin/data.js` (temaGet, temaSet) collegate al modulo | ⏳ non ancora — il modulo esiste ed è testato, ma l'adapter originale non lo chiama ancora |
| Altri moduli (`conference-room`, `bikes`, `feedback`, `notifications`, `ops`) | ⏳ non ancora iniziati |

## Cosa è cambiato davvero nel codice esistente

- `api/admin/auth.js`: importa `authenticate`, `issueToken`, `setSessionCookie`, `clearSessionCookie`, `currentAdmin`, `adminConfigured`, `accountByUsername` direttamente da `src/modules/identity/index.js`, e l'intero handler è avvolto in `wrapHandler()` (error handling centralizzato — rete di sicurezza in più, nessun cambio di comportamento nei percorsi esistenti).
- `api/admin/data.js`: le sei azioni `account*` (`accountList`, `accountCreate`, `accountSetPassword`, `accountSetActive`, `accountDelete`, `accountChangeOwnPassword`) chiamano il modulo direttamente invece di `rpc()`/`hashPassword()`/`verifyPassword()` a mano. Le altre ~29 azioni (macchine, sale, conferenze, bici, sistemista...) sono invariate. Il catch finale riconosce in più gli errori tipizzati (`AppError`) del modulo e li traduce nella stessa forma `{ ok:false, error }` di sempre, con lo status che l'errore stesso porta invece di un 500 automatico — verificato che il frontend (`AdminPanel.tsx`) non fa nulla di diverso per uno status non-401, quindi nessun impatto visibile.
- `api/_lib/auth.js`: **rimosso**. Era un adapter di compatibilità temporaneo; una volta che anche `data.js` ha smesso di usarlo, non serviva più a nessuno.
- **Nessun URL, verbo HTTP, nome di campo o contratto di risposta è cambiato** per il client già installato sui telefoni, salvo lo status HTTP di tre casi di errore interni a `accountChangeOwnPassword` (200→400/expose), non osservabile dal frontend per come è scritto oggi.
- **Nessuna migrazione SQL, nessuna dipendenza aggiunta.** `package.json` ha solo un nuovo script (`test:unit`), che non tocca build o deploy.

## Verifica fatta

- `node --check` su tutti i file toccati (sintassi valida).
- Unit test del modulo: 29/29 verdi, senza rete.
- Smoke test offline (nessun Supabase coinvolto) su `api/admin/auth.js` e `api/admin/data.js`: GET whoami senza cookie, logout, login rifiutato quando l'admin non è configurato, 401/400 sui percorsi protetti — tutti confermati identici al comportamento originale.
- **`npm test` completo, contro il Supabase di produzione**: eseguito con le vecchie `api/_lib/auth.js`/`api/admin/auth.js` (via `git stash`) per isolare la causa di 3 fallimenti sul login — confermato **preesistente e indipendente dal refactor** (credenziali `TEST_ADMIN_USER`/`TEST_ADMIN_PASSWORD` non più valide). Dopo aver rigenerato l'account di test e allineato `.env.local`, la suite gira a **122-123/123** con il collegamento nuovo attivo: l'unico residuo occasionale è la stessa flakiness che il file `tests/run.mjs` documenta da solo (test contro dati di prenotazione reali, senza staging). Login, sessione, cookie, gestione account: tutti verdi in modo stabile.

## Scelte di fedeltà fatte durante il collegamento (non ovvie, vale la pena rileggerle)

- **`forceBook` e `clearDirezione`** non validano il formato di `room` (a differenza del percorso pubblico `book`/`clear`) — fedele all'originale, che non lo faceva neppure lui. Candidato naturale per un piccolo hardening futuro, non fatto qui per non cambiare comportamento silenziosamente.
- **`adminSetMachineStatus`** non valida affatto `room`/`machine` — stessa ragione, si affida al filtro lato SQL come sempre.
- **Irrigidimento deliberato**: `adminWeek`, `adminForceBook`, `adminBookAsDirezione`, `adminAddRecurringRule` ora richiedono che `laundry_id`/`day`/`slot` siano *presenti*, non solo validi se presenti (a differenza del vecchio `LIMITI`, che salta il controllo quando il campo manca del tutto). Un campo completamente assente prima produceva un errore Postgres grezzo più a valle; ora un rifiuto pulito 400. Verificato che `npm test` non lo nota (nessuna azione della suite manda questi campi come assenti).
- **Status HTTP delle validazioni pubbliche**: gli errori di validazione di `bookSlot`/`clearSlot` (giorno/turno/camera) ora rispondono **400** invece di 200 di sempre — stesso messaggio, verificato che né `api.ts` né `AdminPanel.tsx` controllano lo status (solo il caso speciale 401). L'unico assert nella suite che lo notava (`tests/run.mjs`, sezione "Push e segnalazioni") è stato aggiornato su richiesta esplicita per non controllare più lo status esatto, coerente con come già si comportano tutti gli altri controlli dello stesso file.
- **`LIMITI` in `api/admin/data.js` non è stato toccato**: è ridondante per i campi della lavanderia (validati anche dal modulo), ma altre azioni non ancora migrate — incluse le azioni account di Identity, che non validano i propri `id` — dipendono ancora da quel controllo condiviso.

## Scelte di fedeltà fatte durante il collegamento di Common Spaces

- **`adminBookAsDirezione`** (azione `bookSpaceDirezione`) non valida lo slug della sala contro l'elenco `SPACES` — fedele all'originale, che non lo faceva neppure lui; decide la funzione SQL.
- Il controllo "sala valida" resta anche nell'adapter `api/rooms.js` (invariato, prima del try/catch) oltre che dentro il modulo: ridondante ma innocuo, e preserva l'ordine originale delle risposte (token non valido prima di sala non valida).
- Stesso irrigidimento già visto in Laundry: `adminBookAsDirezione` e `adminAddRecurringRule` ora richiedono `day`/`start`/`end`/`space_id` *presenti*, non solo validi se presenti — verificato che `npm test` non lo nota.

## Prossimo passo consigliato

Il modulo Theme esiste ed è testato (15/15), ma `temaGet`/`temaSet` in `api/admin/data.js` chiamano ancora `rpc()` a mano. È il collegamento più piccolo e a più basso rischio rimasto: due azioni, entrambe già riservate al sistemista, nessun percorso pubblico coinvolto.
