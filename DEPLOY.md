# Migrazione a Postgres — istruzioni di deploy

Documento per chi ha accesso all'account Vercel del progetto.

L'app passa da Google Sheets (4 deployment Google Apps Script) a Postgres su
Supabase. Le risposte scendono da 800ms–3s a 50–150ms, e l'integrità delle
prenotazioni passa dai controlli applicativi ai vincoli del database.

**Il vecchio backend non viene toccato.** I 4 Apps Script restano attivi e
raggiungibili per tutta la finestra di rollback. Si torna indietro con una
variabile d'ambiente.

Branch: `independent-db`.

---

## 1. Variabili d'ambiente su Vercel

Project → Settings → Environment Variables, per **Production** e **Preview**.

Nessun prefisso `VITE_` sulle prime: quelle restano lato server. Le variabili
`VITE_` finiscono compilate dentro il bundle JavaScript pubblico, quindi non
possono contenere segreti.

### Obbligatorie

| Nome | Valore |
|---|---|
| `SUPABASE_URL` | `https://drdowugqpjgdptnrvenw.supabase.co` |
| `SUPABASE_SECRET_KEY` | chiedere a Filippo — **segreto**, bypassa la RLS |
| `CRON_SECRET` | chiedere a Filippo — **segreto**, condiviso col job pg_cron |
| `APP_TOKEN` | stesso valore di `VITE_SECRET_TOKEN` |
| `ADMIN_USER` | `admin` — portineria |
| `ADMIN_PASSWORD_HASH` | chiedere a Filippo — è un hash scrypt, non la password |
| `SYSADMIN_USER` | `sistemista` — super admin |
| `SYSADMIN_PASSWORD_HASH` | chiedere a Filippo — hash scrypt |
| `ADMIN_SESSION_SECRET` | chiedere a Filippo — **segreto**, firma i cookie di sessione |

I due account hanno poteri diversi:

| | portineria | sistemista |
|---|---|---|
| Macchine fuori servizio, prenotazioni, segnalazioni, sale | ✓ | ✓ |
| Regole ricorrenti | | ✓ |
| Pulizia dei dati | | ✓ |

Il controllo è sul server, in `api/admin/data.js`: nascondere le schede nel
pannello non sarebbe un'autorizzazione.

> La password del pannello è passata da una chat durante lo sviluppo. Vale la
> pena cambiarla: `node scripts/hash-password.cjs "nuova-password"` rigenera
> l'hash, che poi va incollato in `ADMIN_PASSWORD_HASH`.

### Chiavi VAPID — da rigenerare

Le notifiche push cambiano chiave, perché la privata attuale è accessibile solo
da questo account.

```bash
npx web-push generate-vapid-keys
```

| Nome | Dove |
|---|---|
| `VAPID_PUBLIC_KEY` | env var Vercel |
| `VAPID_PRIVATE_KEY` | env var Vercel — **segreto** |
| `VAPID_SUBJECT` | env var Vercel, es. `mailto:...` |

**La stessa chiave pubblica va anche incollata in [push.ts](push.ts)**, nella
costante `VAPID_PUBLIC_KEY` (circa riga 17). Se le due divergono le notifiche
partono e nessun browser le accetta.

Le variabili `RELAY_SECRET` e `VAPID_*` già presenti servono a
[api/push.js](api/push.js), che resta in piedi per la finestra di rollback:
i trigger Apps Script devono poter continuare a spedire. **Non rimuoverle.**

### Telegram (opzionale, si può fare dopo)

Bot da creare con [@BotFather](https://t.me/BotFather).

| Nome | Valore |
|---|---|
| `TELEGRAM_BOT_TOKEN` | il token del bot — **segreto** |
| `TELEGRAM_WEBHOOK_SECRET` | una stringa casuale a piacere — **segreto** |
| `VITE_TELEGRAM_BOT` | username del bot senza `@`, es. `einaudiplus_bot` |

Dopo il deploy, registra il webhook una volta sola:

```bash
curl -F "url=https://<dominio>/api/telegram" \
     -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     https://api.telegram.org/bot<TOKEN>/setWebhook
```

Senza queste variabili tutto il resto funziona: il pulsante "Collega" nell'app
darà errore, e nient'altro.

---

## 2. Deploy

```bash
git checkout independent-db
git push -u origin independent-db
```

Su Vercel esce un **preview deployment**; la produzione non cambia.

Le funzioni serverless sono 7 (`laundry`, `rooms`, `push`, `cron`, `telegram`,
`admin/auth`, `admin/data`), sotto il limite di 12 del piano Hobby.

---

## 3. Accendere lo scheduler

I promemoria sono valutati ogni minuto da `pg_cron` **dentro Supabase**, non da
Vercel Cron: il piano Hobby limita i cron a una volta al giorno.

Su Supabase → SQL Editor, apri [supabase/cron.sql](supabase/cron.sql), sostituisci
i due segnaposto ed esegui:

- `{{APP_URL}}` → l'URL di preview (poi quello di produzione)
- `{{CRON_SECRET}}` → lo stesso valore messo su Vercel

Il segreto finisce nel **Vault**: il corpo dei job in `cron.job` è leggibile in
chiaro da chiunque possa interrogare quella tabella.

### Verifica

```sql
select jobname, schedule, active from cron.job;

select jobname, status, return_message, start_time
from cron.job_run_details order by start_time desc limit 10;

select status_code, content, created
from net._http_response order by created desc limit 10;
```

---

## 4. Prova prima del cutover

Sul preview, con un telefono vero.

1. Apri l'app, scegli una camera, attiva i promemoria dal campanello
2. Prenota un turno che inizi **fra ~20 minuti**
3. Deve arrivare **una** notifica, e una sola:
   ```sql
   select booking_id, kind, claimed_at, sent_ok, sent_fail
   from reminder_log order by claimed_at desc limit 10;
   ```
4. Ripeti con una camera **sotto il 100**: lì i promemoria sono **tre** —
   inizio turno, fine lavaggio, fine asciugatura
5. Apri `/admin`, entra, metti una macchina fuori servizio e verifica che
   nell'app compaia come guasta **ma resti prenotabile con un avviso**
6. Dall'app segnala un guasto e controlla che compaia in `/admin` → Segnalazioni

---

## 5. Cutover

**Di domenica sera**, perché la settimana si azzera comunque a mezzanotte.

1. Svuota i dati di prova rimasti dallo sviluppo:
   ```sql
   select reset_dev_data();
   ```
   Non tocca la configurazione (lavanderie, macchine, sale).
2. Facoltativo: importa lo storico segnalazioni dal foglio "Feedback"
   ```bash
   node scripts/import-feedback.cjs feedback.csv
   ```
3. Merge di `independent-db` su `main`
4. Ripunta il job pg_cron all'URL di produzione:
   ```sql
   select cron.unschedule('promemoria-lavanderia');
   -- poi riesegui la sezione cron.schedule di supabase/cron.sql con l'URL giusto
   ```
5. **Disattiva i trigger Apps Script**, altrimenti arrivano notifiche doppie:
   `sendDueReminders` (×2), `clearRange` (×2), `clearRangeLavanderia`
6. Guarda i log lunedì mattina, quando parte il turno delle 07:00

> **Le vecchie subscription push non si migrano.** Sono legate alla vecchia
> chiave VAPID: importarle produrrebbe solo endpoint che rispondono 403 e
> vengono potati al primo invio. I dispositivi si ri-registrano da soli al
> primo avvio dell'app.

---

## 6. Rollback

1. Su Vercel, aggiungi `VITE_API_BASE` = `legacy`
2. Redeploy (~2 minuti)
3. Riattiva i trigger Apps Script

L'app torna a Google Sheets. I fogli sono intatti, i 4 script non sono stati
toccati.

> Non è un interruttore a runtime: Vite compila la scelta nel bundle, quindi
> serve il redeploy.

**Quando fare rollback**, deciso in anticipo: errori 5xx sopra l'1%, un conflitto
di prenotazione risolto male, o zero promemoria partiti la prima mattina.

---

## 7. Dopo due settimane di calma

- Togli le voci Google da `connect-src` in [vercel.json](vercel.json)
- Archivia la cartella `apps-script/`
- Elimina `RELAY_SECRET` e [api/push.js](api/push.js)
- Revoca il Personal Access Token Supabase usato per le migrazioni

> Togliere Google dalla CSP **prima** rende il rollback silenziosamente
> inefficace: l'app si carica, ogni richiesta viene bloccata dal browser, e non
> compare alcun errore visibile all'utente.

---

## Cosa cambia per chi usa l'app

- **Il pulsante "fuori servizio" diventa una segnalazione.** Il residente
  segnala, un amministratore verifica e decide da `/admin`. Prima quel pulsante
  non funzionava affatto: il client mandava l'azione `status`, il backend si
  aspettava `setStatus`, nessun ramo combaciava.
- **Segnare una macchina guasta non impedisce di prenotarla**, mostra un avviso.
- **Chi ha i promemoria attivi va ri-registrato**, e succede da solo al primo
  avvio. Chi non apre l'app per due settimane, per due settimane non riceve.
- **La quota di 2 turni a settimana ora è applicata dal server.** Prima era solo
  lato client, quindi aggirabile.
- **Nuovo pannello `/admin`** e **promemoria Telegram opzionali**.

---

## Prenotazioni ricorrenti

Dal pannello, scheda **Ricorrenti** (solo sistemista): «ogni lunedì alle 09:30
la lavatrice B è della camera 101», lo stesso per cinema e musica.

Una regola non è una prenotazione: è la ricetta con cui, **ogni notte alle 02:00
UTC**, le prenotazioni della settimana corrente vengono create. Sono
materializzate e non calcolate al volo, così compaiono nella griglia come tutte
le altre, i promemoria partono senza casi speciali, e in una settimana
particolare si può cancellare la singola occorrenza senza toccare la regola.

Tre comportamenti da conoscere:

- **Una regola creata adesso vale già da adesso**, non dal lunedì successivo.
- **Se il turno è già prenotato da qualcuno, la regola cede.** Non gli si toglie
  il turno alle spalle. Il conteggio "saltate" dice quando succede.
- **Cancellare una regola non cancella le prenotazioni già create.** Restano
  fino a fine settimana e si tolgono dalla scheda Prenotazioni.

Il job gira ogni giorno e non solo il lunedì: la funzione è idempotente, quindi
rieseguirla non fa danni, e così si auto-ripara se una notte salta.
