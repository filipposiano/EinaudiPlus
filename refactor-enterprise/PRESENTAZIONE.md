# EinaudiPlus verso l'enterprise-readiness — presentazione del lavoro

## Il punto di partenza

EinaudiPlus — l'app del Collegio Einaudi per prenotare lavanderia, cinema e sala musica — funzionava bene, ma era cresciuta come spesso cresce un progetto reale: un file per endpoint, tutta la logica di un dominio mescolata a quella di altri, un unico file da 650 righe (`api/admin/data.js`) che faceva da controller per almeno otto aree di business diverse. Non era codice insicuro — anzi, un'analisi da vicino ha trovato scelte già solide (password con scrypt, rate limiting, protezione CSRF, header di sicurezza corretti) — ma non aveva **confini**: aggiungere una funzione voleva dire capire a memoria dove finiva un dominio e iniziava l'altro, e non c'era modo di verificarlo se non rileggendo tutto.

## L'obiettivo

Trasformare l'app in un **monolite modulare**: stesso deploy, stesso database, stesso contratto verso il client già installato sui telefoni — ma con domini separati, ognuno responsabile della propria logica, della propria validazione e di chi può fare cosa.

## Cosa è stato fatto

**Nove moduli**, ognuno con la stessa forma (regole di dominio, use-case, accesso ai dati, superficie pubblica): Identity, Laundry, Common Spaces, Theme, Notifications, Bikes, Feedback, Conference Room, Ops. Ogni azione che prima viveva in un unico grande switch ora appartiene a un modulo preciso, con la propria validazione e la propria regola su chi può eseguirla.

**Un kernel condiviso** invece di codice duplicato in ogni file: un solo modo di parlare al database, un solo modo di rispondere agli errori (mai più uno stack trace mostrato per sbaglio), un solo modo di limitare le richieste, un solo modo di validare un numero o un numero di camera, un solo log strutturato al posto di annotazioni sparse e diverse in ogni file.

**Una regola imposta dalla build, non dalla memoria**: un modulo non può più importare i dettagli interni di un altro modulo — solo la sua porta d'ingresso ufficiale. Se qualcuno lo fa per sbaglio, la build fallisce, non se ne accorge un revisore mesi dopo.

**247 test automatici** nuovi che verificano ogni modulo in isolamento, in meno di un secondo, senza toccare mai il database — cosa impossibile prima, quando l'unico modo di testare una funzione era farla girare contro Supabase vero.

**Una pipeline di verifica automatica** (GitHub Actions): a ogni modifica, i test, il controllo dei tipi, la regola di confine e la build di produzione girano da soli, senza bisogno che qualcuno se ne ricordi.

**Sicurezza aggiornata**: dipendenze verificate e aggiornate, alcune validazioni mancanti chiuse (dove un input malformato prima raggiungeva il database invece di essere respinto subito), un nome di funzione corretto perché non traesse in inganno chi lo avrebbe letto in futuro.

## Come è stato verificato

Ogni passo di questo lavoro — inclusi quelli fatti su un'app già in produzione, con prenotazioni vere di persone vere — è stato verificato prima di considerarlo concluso: build pulita, tutti i test automatici verdi, e una suite end-to-end fatta girare più volte contro il database reale (l'unico che esiste, non c'è un ambiente di prova separato), confermando che nessun comportamento visibile dal client è cambiato. Ogni scelta che si allontanava anche di poco dal comportamento originale è stata documentata esplicitamente, non nascosta in un refactor "di forma".

## Cosa resta

Il frontend (le due schermate principali dell'app, migliaia di righe ciascuna) non è stato ancora toccato: ha lo stesso problema di struttura che il backend aveva prima di questo lavoro, ma è un progetto a sé. E non c'è ancora un modo automatico di essere avvisati se qualcosa smette di funzionare in produzione, al di là dei log.

## In una frase

L'app fa esattamente le stesse cose di prima, per chi la usa non cambia nulla — ma chi la manterrà da qui in avanti lavora su una base con confini chiari, verificata da una pipeline automatica invece che dalla memoria di chi l'ha scritta.
