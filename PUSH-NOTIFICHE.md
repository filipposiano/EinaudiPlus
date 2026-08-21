# Promemoria — Web Push e Telegram

Promemoria dei turni di lavanderia, anche ad app chiusa.

## Quando arrivano

Tre per ogni prenotazione, in entrambe le lavanderie:

| Momento | Testo |
|---|---|
| 16 minuti prima dell'inizio | «Il tuo turno inizia tra poco!» |
| a fine lavaggio | «Sposta i vestiti in asciugatrice!» |
| a fine asciugatura | «Ritira i tuoi vestiti!» |

I tre condividono lo stesso `tag`, quindi il telefono **sostituisce** il
precedente invece di accumularli: chi guarda a fine ciclo trova "Ritira i tuoi
vestiti", non tre avvisi sovrapposti.

Il numero di promemoria è una proprietà della lavanderia
(`laundry.reminder_mode`), non del codice. Al Valentino fino ad agosto 2026 era
uno solo — ereditato dal vecchio Apps Script — ed è per quello che sembrava che
asciugatrice e ritiro fossero rotti.

## Come funzionano

```
1. push.ts registra il Service Worker, chiede il permesso, crea la
   subscription e la manda a /api/laundry (azione `subscribe`).

2. pg_cron, DENTRO Supabase, chiama /api/cron ogni minuto.
   Non Vercel Cron: il piano Hobby limita i cron a una volta al giorno.

3. claim_due_reminders() decide in SQL chi va avvisato adesso, e nello stesso
   colpo marca i promemoria come inviati. La INSERT ... RETURNING rende il
   doppio invio impossibile, non solo improbabile: se due tick si sovrappongono
   il secondo non ottiene nulla.

4. /api/cron firma e spedisce: Web Push (VAPID) e, per chi l'ha collegato,
   Telegram. Le subscription che rispondono 404/410 vengono potate.
```

`public/sw.js` sceglie l'icona in base al tipo di promemoria: lavatrice per
l'inizio turno, asciugatrice per gli altri due.

## Chiavi VAPID

La chiave **pubblica** sta in `push.ts` e non è un segreto — finisce comunque
nel bundle. Deve però essere **identica** a `VAPID_PUBLIC_KEY` fra le variabili
d'ambiente di Vercel: se divergono le push partono, nessun servizio le accetta,
e l'utente continua a vedere i promemoria come "attivi". `sameKey()` in
`push.ts` se ne accorge e rifà la subscription, ma solo al primo avvio.

La chiave **privata** sta solo su Vercel.

> Rigenerarle **uccide tutte le iscrizioni esistenti**: ogni residente smette di
> ricevere promemoria finché non riapre l'app. Farlo solo per un motivo di
> sicurezza reale.

## Telegram

Alternativa alle push, per chi le ha bloccate o preferisce.

Dal menu promemoria si genera un codice usa-e-getta e si apre il bot con
`https://t.me/<bot>?start=<codice>`. Serve un codice e non basta la camera:
altrimenti chiunque potrebbe scrivere al bot «sono la 112» e ricevere i
promemoria di un altro. Il codice vale una volta sola e scade in 24 ore.

Serve `VITE_TELEGRAM_BOT` fra le variabili di Vercel. È l'unica delle tre con
prefisso `VITE_`, quindi Vite la compila **dentro il bundle al momento della
build**: aggiungerla non basta, serve anche un deploy nuovo.

## Su iPhone

Le push web funzionano **solo** se l'app è aggiunta alla schermata Home
(Condividi → "Aggiungi a Home"), da iOS 16.4. Aperta da lì, si attivano dal
menu promemoria. Su Android basta attivarle.

## Provare che funzionino

Prenota un turno che inizi fra ~20 minuti, poi:

```sql
select booking_id, kind, claimed_at, sent_ok, sent_fail
from reminder_log order by claimed_at desc limit 10;
```

`sent_ok = 0` con `sent_fail > 0` vuol dire che il servizio push ha rifiutato:
quasi sempre è la chiave VAPID che non combacia.
