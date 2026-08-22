# EinaudiPlus

App del Collegio Einaudi per prenotare **lavanderia**, **sala cinema** e **sala
musica**. È una PWA: si installa dal browser e manda promemoria push.

## Com'è fatta

```
browser ──▶ /api/* (funzioni serverless Vercel) ──▶ Postgres (Supabase)
                                                        ▲
                                pg_cron ogni minuto ────┘
                                   └──▶ /api/cron ──▶ Web Push · Telegram
```

Il browser **non parla mai** direttamente col database: la chiave Supabase sta
solo lato server. Tutte le scritture passano da funzioni SQL, che sono anche il
posto dove vivono i vincoli (niente doppie prenotazioni, niente sovrapposizioni
nelle sale).

## I file, e cosa c'è dentro

### Frontend

| File | Cosa fa |
|---|---|
| `App.tsx` | la lavanderia: dashboard, vista giornaliera, griglia settimanale, e il guscio dell'app |
| `Rooms.tsx` | cinema e musica, che funzionano a fasce libere invece che a turni fissi |
| `AdminPanel.tsx` | le sezioni riservate (macchine, segnalazioni, ricorrenti, manutenzione). Caricato solo a chi fa l'accesso |
| `AccessibilityPanel.tsx` · `statusConfig.ts` | colori e simboli di stato personalizzabili |
| `api.ts` · `roomsApi.ts` | le uniche due porte verso `/api`. Nessun altro file fa `fetch` di dati |
| `push.ts` · `public/sw.js` | notifiche push |
| `style.css` | i design token. **Da leggere prima di toccare un colore**: la palette ha due livelli e il perché è spiegato lì |

### Backend

| File | Cosa fa |
|---|---|
| `api/laundry.js` | tutto ciò che riguarda la lavanderia |
| `api/rooms.js` | cinema e musica |
| `api/cron.js` | invia i promemoria dovuti. Lo chiama `pg_cron`, non Vercel |
| `api/telegram.js` | webhook del bot |
| `api/admin/auth.js` · `api/admin/data.js` | accesso e operazioni riservate |
| `api/_lib/` | pezzi condivisi: `db.js` (chiamate SQL), `http.js` (lettura corpo, validazione, rate limit), `auth.js` (password e sessioni), `push.js` (invio Web Push) |
| `supabase/` | schema e funzioni SQL, consolidati. `migrations/` è la storia delle modifiche, numerata |

## Il database

I file in `supabase/` sono **consolidati**: contengono lo stato attuale, non
quello iniziale. Ricostruire un database da zero significa eseguirli in
quest'ordine, e nient'altro:

| # | File | Cosa contiene |
|---|---|---|
| 1 | `schema.sql` | tabelle, vincoli, dati iniziali (lavanderie, macchine, sale) |
| 2 | `functions.sql` | lettura e scrittura di lavanderia e sale, per i residenti |
| 3 | `admin.sql` | operazioni del pannello, comprese quelle a nome della Direzione |
| 4 | `sysadmin.sql` | regole ricorrenti e pulizia, riservate al sistemista |
| 5 | `polivalente.sql` | sala polivalente: tabella, agenda, programmazione |
| 6 | `account.sql` | account amministrativi e cambio password |
| 7 | `telegram.sql` | collegamento del bot |
| 8 | `reminders.sql` | promemoria dovuti e potatura periodica |
| 9 | `cron.sql` | job `pg_cron` (va personalizzato: contiene dei segnaposto) |
| 10 | **`permessi.sql`** | **restringe l'esecuzione a `service_role`. Non è facoltativo** |

`permessi.sql` va **per ultimo** e va eseguito: agisce su tutte le funzioni
già create, e senza di lui ognuna resta invocabile via `/rest/v1/rpc/` da
chiunque abbia la chiave pubblicabile di Supabase — scavalcando cookie di
sessione, hash delle password e rate limit in un colpo solo.

`migrations/` non serve a una ricostruzione: quelle modifiche sono già dentro
i file qui sopra. Restano perché spiegano **perché** una cosa è come è, e
perché vanno applicate una alla volta al database che è già in produzione.

## Lavorarci

```bash
npm install
npm run dev      # http://localhost:5173, /api compreso
npm test         # gira contro il database VERO: vedi sotto
npm run build
```

> **`npm test` parla con la produzione.** Non esiste un database di staging:
> `.env.local` punta lì. I test scelgono turni liberi e ripuliscono ciò che
> creano, ma un test scritto male scrive su dati veri. La pulizia distruttiva
> è dietro `TEST_ALLOW_PURGE=1` apposta.

Per applicare una migrazione:

```bash
node scripts/db.cjs apply supabase/migrations/00X-nome.sql
node scripts/db.cjs query "select ..."
```

## Due cose da sapere prima di cambiare qualcosa

**L'identità è autodichiarata.** Il numero di camera sta in `localStorage` e
chiunque può scriverci quello che vuole. Non c'è un login per i residenti. Da
qui discende che la quota di 2 turni e la proprietà delle prenotazioni sono
indicazioni, non regole applicabili: un controllo si aggirerebbe cambiando una
stringa nel browser, e fermerebbe solo chi lo rispettava già. Se un giorno
arriverà un'autenticazione vera, è nelle funzioni SQL che vanno rimessi i
controlli.

**Gli amministratori invece hanno un login vero** (cookie httpOnly firmato,
password con hash scrypt) e i loro poteri sono verificati sul server. Si entra
digitando `1935` al posto della camera.

## Documenti

- [DEPLOY.md](DEPLOY.md) — variabili d'ambiente, scheduler, migrazione da Google
  Sheets, e le trappole (fra cui: **mai commenti in `vercel.json`**)
- [PUSH-NOTIFICHE.md](PUSH-NOTIFICHE.md) — come funzionano i promemoria
