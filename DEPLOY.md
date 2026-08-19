# Migrazione a Postgres — istruzioni di deploy

Documento per chi ha accesso all'account Vercel del progetto.

L'app passa da Google Sheets (4 deployment Apps Script) a Postgres su Supabase.
Le risposte scendono da 800ms–3s a 50–150ms, e l'integrità delle prenotazioni
passa dai controlli applicativi ai vincoli del database.

**Il vecchio backend non viene toccato.** I 4 Apps Script restano attivi e
raggiungibili per tutta la finestra di rollback. Si torna indietro con una
variabile d'ambiente.

---

## 1. Variabili d'ambiente da aggiungere su Vercel

Project → Settings → Environment Variables. Tutte per **Production** e **Preview**.

| Nome | Valore | Note |
|---|---|---|
| `SUPABASE_URL` | `https://drdowugqpjgdptnrvenw.supabase.co` | pubblico |
| `SUPABASE_SECRET_KEY` | chiedere a Filippo | **segreto** — bypassa la RLS, mai lato client |
| `CRON_SECRET` | chiedere a Filippo | **segreto** — condiviso con il job pg_cron |
| `APP_TOKEN` | stesso valore di `VITE_SECRET_TOKEN` | copia server-side, per il confronto in `/api` |

Nessun prefisso `VITE_`: queste devono restare lato server. Le variabili `VITE_`
finiscono compilate dentro il bundle JavaScript pubblico.

### Chiavi VAPID — da rigenerare

Le notifiche push cambiano chiave, perché la privata attuale è accessibile solo
da questo account.

```bash
npx web-push generate-vapid-keys
```

Poi aggiorna:

| Nome | Dove |
|---|---|
| `VAPID_PUBLIC_KEY` | env var Vercel |
| `VAPID_PRIVATE_KEY` | env var Vercel — **segreto** |
| `VAPID_SUBJECT` | env var Vercel, es. `mailto:...` |

**E la stessa chiave pubblica va incollata in [push.ts](push.ts), riga 17**
(costante `VAPID_PUBLIC_KEY`). Le due devono coincidere, altrimenti le notifiche
partono ma nessun browser le accetta.

Le variabili `RELAY_SECRET`, `VAPID_*` già presenti servono a [api/push.js](api/push.js),
che resta in piedi: durante la finestra di rollback i trigger Apps Script devono
poter continuare a spedire. **Non rimuoverle.**

---

## 2. Deploy

```bash
git checkout independent-db
git push -u origin independent-db
```

Su Vercel esce un **preview deployment**. La produzione non cambia: il branch
`main` resta quello servito agli utenti.

Prendi nota dell'URL di preview, serve al passo dopo.

---

## 3. Accendere lo scheduler

I promemoria sono valutati ogni minuto da `pg_cron` **dentro Supabase**, non da
Vercel Cron: il piano Hobby limita i cron a una volta al giorno, che non basta.

Su Supabase → SQL Editor, apri [supabase/cron.sql](supabase/cron.sql), sostituisci
i due segnaposto ed esegui:

- `{{APP_URL}}` → l'URL di preview (poi, al cutover, quello di produzione)
- `{{CRON_SECRET}}` → lo stesso valore messo su Vercel

Il segreto finisce nel **Vault**, non nel corpo del job: `cron.job` è leggibile
in chiaro da chiunque possa interrogarla.

### Verifica

```sql
-- Il job è registrato e attivo?
select jobname, schedule, active from cron.job;

-- Sta partendo?
select jobname, status, return_message, start_time
from cron.job_run_details order by start_time desc limit 10;

-- Vercel risponde 200?
select status_code, content, created
from net._http_response order by created desc limit 10;
```

---

## 4. Prova end-to-end prima del cutover

Da fare sul preview, con un telefono vero.

1. Apri l'app, scegli una camera, attiva i promemoria
2. Prenota un turno che inizi **fra ~20 minuti**
3. Aspetta. Deve arrivare **una** notifica, e una sola
4. Controlla che non ne arrivi una seconda:
   ```sql
   select booking_id, kind, claimed_at, sent_ok, sent_fail
   from reminder_log order by claimed_at desc limit 10;
   ```
5. Ripeti con una camera **sotto il 100** (lavanderia sezione): lì i promemoria
   sono **tre** — inizio turno, fine lavaggio, fine asciugatura

Verifica anche: prenotare, cancellare, sovrapposizione sale, segnalazione guasto.

---

## 5. Cutover

**Da fare di domenica sera**, perché la settimana si azzera comunque a mezzanotte
e si parte da uno stato pulito.

1. Merge di `independent-db` su `main`
2. Ripunta il job pg_cron all'URL di produzione:
   ```sql
   select cron.unschedule('promemoria-lavanderia');
   -- poi riesegui la sezione cron.schedule di supabase/cron.sql con l'URL giusto
   ```
3. **Disattiva i trigger Apps Script**, altrimenti arrivano notifiche doppie:
   - `sendDueReminders` (×2, uno per lavanderia)
   - `clearRange` (×2) e `clearRangeLavanderia`
4. Guarda i log lunedì mattina, quando parte il turno delle 07:00

---

## 6. Rollback

Se qualcosa va storto:

1. Su Vercel, aggiungi `VITE_API_BASE` = `legacy`
2. Redeploy (~2 minuti)
3. Riattiva i trigger Apps Script

L'app torna a parlare con Google Sheets. I fogli sono intatti, i 4 script non
sono stati toccati.

> Non è un interruttore a runtime: Vite compila la scelta nel bundle, quindi
> serve il redeploy. Circa due minuti.

**Quando fare rollback**, deciso in anticipo per non doverci pensare sul momento:
errori 5xx sopra l'1%, un conflitto di prenotazione risolto male, o zero
promemoria partiti la prima mattina.

---

## 7. Dopo due settimane di calma

Solo a questo punto, e non prima:

- Togli le voci Google da `connect-src` in [vercel.json](vercel.json)
- Archivia la cartella `apps-script/`
- Elimina le variabili `RELAY_SECRET` e il file [api/push.js](api/push.js)

> Togliere Google dalla CSP **prima** rende il rollback silenziosamente
> inefficace: l'app si carica, ogni richiesta viene bloccata dal browser, e non
> compare alcun errore visibile all'utente.

---

## Cosa cambia per chi usa l'app

- **Il pulsante "fuori servizio" diventa una segnalazione.** Il residente segnala
  il guasto, un amministratore verifica e decide. Prima quel pulsante non
  funzionava affatto: il client mandava l'azione `status`, il backend si
  aspettava `setStatus`, e nessun ramo combaciava.
- **Chi ha i promemoria attivi va ri-registrato.** La chiave VAPID cambia, quindi
  le subscription esistenti smettono di ricevere. L'app se ne accorge e si
  ri-registra da sola al primo avvio, ma chi non la apre per due settimane per
  due settimane non riceve niente.
- **Segnare una macchina guasta non impedisce di prenotarla**, mostra un avviso.
- **La quota di 2 turni a settimana ora è applicata dal server.** Prima era solo
  lato client, quindi aggirabile.
