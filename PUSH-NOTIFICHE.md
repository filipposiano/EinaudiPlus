# Notifiche push — promemoria turni lavanderia

Promemoria ~15 minuti prima dell'inizio del turno, anche ad app chiusa.

## Architettura (3 pezzi)

1. **Frontend** (`push.ts`, `public/sw.js`, campanello 🔔 nell'header)
   registra il Service Worker, chiede il permesso notifiche, crea l'iscrizione
   push e la manda all'Apps Script insieme al numero di camera.
2. **Relay su Vercel** (`api/push.js`) firma (VAPID) e invia la push: è la parte
   crittografica che Apps Script non sa fare.
3. **Apps Script lavanderia** (`apps-script/laundry-push.gs`) ogni 5 minuti
   controlla i turni in arrivo e, per ogni camera prenotata, chiama il relay.

## Chiavi VAPID

Chiave **pubblica** (già inserita in `push.ts`, non è segreta):

```
BLG2P3_gpSsGhGi9vrVKD_Kr2-Ql6S-8bh3xDaB8s5U-aA3o59LMtPjRAoww6DzbJ_Gkl7So00O_o0DOQPSuVWg
```

La chiave **privata** è segreta: NON è nel repo. È stata generata e va incollata
solo nelle variabili d'ambiente di Vercel (vedi sotto). Per rigenerarle:
`npx web-push generate-vapid-keys --json`.

## Setup

### 1. Vercel — variabili d'ambiente
Project → Settings → Environment Variables (Production), poi **Redeploy**:

| Nome | Valore |
|------|--------|
| `VAPID_PUBLIC_KEY` | la chiave pubblica qui sopra |
| `VAPID_PRIVATE_KEY` | la chiave privata (segreta) |
| `VAPID_SUBJECT` | `https://einaudi-plus.vercel.app` |
| `RELAY_SECRET` | una password a tua scelta (segreta) |

La funzione relay sarà su `https://einaudi-plus.vercel.app/api/push`.

### 2. Apps Script lavanderia
- Sostituisci TUTTO il contenuto del `Code.gs` della lavanderia con
  `apps-script/laundry-Code.gs` (è il tuo script con le notifiche già integrate;
  dispatch `subscribe`/`unsubscribe` nel `doPost` e `sendDueReminders` inclusi).
- In cima al file, nella sezione PUSH, imposta `RELAY_URL` (l'URL Vercel
  `/api/push`) e `RELAY_SECRET` (uguale a quello su Vercel).
- Ridistribuisci la Web App (Gestisci distribuzioni → ✏️ → Nuova versione).
- Crea un **trigger a tempo**: orologio → Aggiungi trigger → funzione
  `sendDueReminders`, "In base al tempo" → "Timer a minuti" → "Ogni 5 minuti".

> Il vecchio `apps-script/laundry-push.gs` (solo add-on) non serve più: la
> versione completa è `laundry-Code.gs`.

### 3. iPhone (importante)
Su iOS le push web funzionano SOLO se l'app è **aggiunta alla schermata Home**
(Safari → Condividi → "Aggiungi a Home"), iOS 16.4+. Poi apri l'app dalla Home e
tocca il campanello 🔔 per attivare i promemoria. Su Android/Chrome basta toccare
il campanello.

## Test
1. Attiva il campanello (concedi il permesso).
2. Prenota un turno che inizia tra ~15–20 minuti.
3. Entro pochi minuti dovresti ricevere la notifica.
Per un test immediato puoi eseguire `sendDueReminders` a mano dall'editor Apps
Script dopo aver prenotato un turno imminente.
