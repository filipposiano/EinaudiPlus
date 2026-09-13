# refactor-enterprise — analisi e stato della migrazione

Questa cartella contiene solo l'analisi e il piano ([ARCHITETTURA-ENTERPRISE.md](./ARCHITETTURA-ENTERPRISE.md)). Il codice vive nella sua posizione definitiva, quella descritta nell'alberatura del documento: `src/shared/`, `src/modules/*`.

## Stato: migrazione completa

Tutti e nove i domini individuati nell'analisi iniziale sono ora moduli (`domain/application/infrastructure/index.js`), collegati agli adapter Vercel e verificati contro il database di produzione:

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

**242 unit test** (`npm run test:unit`), nessuna rete/database richiesti — mai esistiti prima di questo lavoro per nessuno di questi domini.

## Cosa è cambiato nel kernel condiviso (oltre ai moduli)

Tre richieste esplicite, tutte chiuse in questo giro:

- **Logging centralizzato**: ogni adapter con un contratto di risposta standard (`admin/auth`, `admin/data`, `laundry`, `rooms`, `conferenze`, `cron`) è avvolto in `wrapHandler()`, che logga in modo strutturato (JSON, un campo per richiesta) invece del vecchio `console.error("[tag]", ...)` sparso e diverso in ogni file. `api/telegram.js` fa eccezione apposta: risponde sempre 200 a Telegram anche in caso di errore (per non farlo ritentare in loop), un contratto diverso da tutti gli altri — usa comunque il logger strutturato, solo non `wrapHandler`.
- **Rate limiting centralizzato**: `src/shared/http/rateLimit.js` sostituisce il vecchio `allow()` di `api/_lib/http.js`, richiamato a mano e diversamente in ogni endpoint. Un'unica funzione (`checkRateLimit(bucket, identificatore, limite, finestra)`), usata sia per i limiti per-IP (lavanderia, sale, conferenze, login) sia per quello per-account del broadcast — quest'ultimo iniettato come dipendenza nel modulo Notifications, non importato a mano, per restare testabile senza rete.
- **`LIMITI` (il dizionario di validazione condiviso fra domini migrati e non) è stato rimosso del tutto** da `api/admin/data.js`. Ogni campo che validava (`id`, `laundry_id`, `space_id`, `day`, `slot`, `offset`, `limit`, `start`, `end`, `giorno`) è ora validato dal modulo che possiede l'azione corrispondente — compreso un buco chiuso in Identity, che non validava i propri `id` prima di questo giro.

L'autorizzazione per-azione ha seguito lo stesso principio: le due `Set()` centrali (`SOLO_SISTEMISTA`, `VIETATE_A_STAFF`) in `api/admin/data.js` sono sparite, sostituite da una `authorize(claims, action)` per modulo, provate in sequenza finché una non riconosce l'azione come propria.

## File rimossi (morti dopo la migrazione)

`api/_lib/auth.js`, `api/_lib/db.js`, `api/_lib/push.js`, `api/_lib/telegram.js` — tutti sostituiti dal kernel condiviso e dai moduli. `api/_lib/http.js` resta, ma ridotto a ciò che è puro HTTP (lettura corpo, risposta, metodi ammessi): rate limiting e validazione non ci vivono più.

## Scelte di fedeltà deliberate (non ovvie, documentate invece di "corrette" silenziosamente)

- **`forceBook`, `clearDirezione`, `adminSetMachineStatus`, `bookSpaceDirezione`** non validano il formato di camera/sala — fedeli all'originale, che non lo faceva neppure lui (si affida al filtro lato SQL). Candidati naturali per un piccolo hardening futuro.
- **Irrigidimento deliberato**: diversi campi (`laundry_id`, `day`, `slot`, `start`, `end`, `space_id`, `giorno`, `limit`) ora devono essere *presenti*, non solo validi se presenti — il vecchio `LIMITI` saltava il controllo su un campo del tutto assente. Un campo mancante prima produceva un errore Postgres grezzo più a valle; ora un rifiuto pulito 400. Verificato che nessuna azione della suite di test manda questi campi come assenti.
- **`getAgenda`** (sala conferenze pubblica) fa eccezione all'irrigidimento: un valore mancante o malformato ricade sul default (30 giorni), non viene rifiutato — fedele all'originale (`intero(...) ?? 30`), perché è un endpoint di sola lettura senza nulla da proteggere.
- **Status HTTP delle validazioni**: gli errori di validazione dei moduli rispondono con lo status che l'errore stesso porta (400 per input malformato, 429 per rate limit) invece del 200 di sempre — verificato che né `api.ts` né `AdminPanel.tsx` controllano lo status HTTP (solo il caso speciale 401), quindi nessun impatto sul client. Un solo assert nella suite esistente lo notava ed è stato aggiornato su richiesta esplicita.
- **Messaggio di autorizzazione unificato**: i due messaggi originali ("riservato al sistemista" / "riservato a FDO e sistemista") sono diventati un unico "permesso negato", conseguenza naturale di avere ogni modulo con la propria `authorize()` invece di due liste centrali con messaggi diversi. Cambio di testo minimo, mai verificato dai test, ma vale la pena saperlo.
- **`sendDueReminders`** (cron): l'intero invio — push E Telegram — resta condizionato alla sola configurazione di push (`pushSender.configured()`), un comportamento preesistente non introdotto qui.

## Verifica fatta

- `node --check` su ogni file toccato, `npx tsc --noEmit` pulito.
- **242/242 unit test**, nessuna rete.
- Smoke test offline: caricamento di tutti gli adapter (nessun errore di import/dipendenza circolare) + percorsi non autenticati.
- **`npm test` contro il database di produzione** (non esiste uno staging): **122/123**, stabile su più run consecutivi in questa sessione. L'unico residuo è una flakiness pre-esistente e documentata nel file stesso (collisione su dati di prenotazione reali), verificata più volte come indipendente da queste modifiche.
- **Verifica mirata aggiuntiva e auto-pulente** per i due domini che la suite esistente non copriva affatto (sala conferenze, flusso reale delle bici — solo il rifiuto di autorizzazione era testato prima): 12/12, contro produzione, ogni riga creata cancellata a fine prova.

## Non fatto (fuori scope, deliberatamente)

- Nessuna modifica alle funzioni SQL/migrazioni: restano l'autorità sui vincoli.
- Nessun hardening aggiuntivo sulle asimmetrie di validazione elencate sopra.
- Nessuna CI: la verifica resta manuale (`npm run test:unit` + `npm test`), come per tutta questa sessione.
