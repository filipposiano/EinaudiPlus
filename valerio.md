Nella mia repository sono presenti due file Google Apps Script: laundry-Code.gs (per la lavanderia con 3 lavatrici) e new-laundry-Code.gs (per la lavanderia con 1 lavatrice).

Ho bisogno che tu legga entrambi i file e mi generi il codice completo e aggiornato per new-laundry-Code.gs (portandolo alla versione 0.3.1), implementando due cose fondamentali:

Integrazione Notifiche Push:
Porta tutto il sistema di notifiche push presente in laundry-Code.gs (incluse le funzioni handleSubscribe_, handleUnsubscribe_, la gestione del foglio PushSubs e il trigger sendDueReminders) all'interno di new-laundry-Code.gs.
Attenzione: Il foglio new-laundry-Code ha una struttura diversa (gestisce solo la 'Lavatrice A' e i dati sono salvati a righe alterne). Riadatta la funzione sendDueReminders in modo che legga correttamente i turni usando la funzione getWeek_() specifica di questo script. Mantieni la logica e le tempistiche degli avvisi identiche al primo script (15 min prima dell'inizio, fine lavatrice/inizio asciugatrice, fine asciugatrice).

Fix Bug Formattazione Data ("19/1"):
Nel file new-laundry-Code.gs, c'è un bug fastidioso: se un utente prenota inserendo la camera nel formato "19/1" (camera 19, persona 1), quando lo script fa il setValue() Google Sheets converte automaticamente l'input in una data ("19 gennaio").
Modifica la logica di inserimento per forzare Google Sheets a trattare l'input sempre e solo come testo semplice, impedendo la conversione automatica in data (ad esempio, inserendo un apice singolo ' all'inizio della stringa prima di salvarla nella cella, oppure formattando la cella come plain text).

Restituiscimi il codice completo di new-laundry-Code.gs pronto per essere salvato e deployato.