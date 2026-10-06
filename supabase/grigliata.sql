-- ─────────────────────────────────────────────────────────────────────────────
-- FILE CONSOLIDATO: contiene lo stato ATTUALE, non quello iniziale.
--
-- Le migrazioni in migrations/ sono gia' incorporate qui. Non vanno riapplicate
-- sopra a questo file, e questo file non va rieseguito su un database gia' in
-- produzione: le due cose insieme creerebbero doppioni di funzione (due
-- overload della stessa RPC = errore PGRST203, che PostgREST non sa risolvere).
--
-- Ordine di ricostruzione e ruolo di ciascun file: vedi README.md.
-- ─────────────────────────────────────────────────────────────────────────────
-- Grigliata: il delegato fa partire un evento (titolo, scadenza, giorno,
-- link di pagamento, menu con le loro voci-ticket), i residenti aderiscono e
-- scelgono il menu, dichiarano di aver pagato, il delegato conferma.
-- Percorso pubblico per i residenti (camera autodichiarata, stesso modello
-- di fiducia di tutto il resto dell'app) e amministrativo per creare/
-- chiudere l'evento e confermare i pagamenti — vedi
-- src/modules/grigliata/domain/policy.js: riservato a delegato e sistemista,
-- non a FDO/staff.
--
-- UNA grigliata alla volta: farne partire una nuova chiude automaticamente
-- quella ancora attiva (grigliata_admin_crea), così la scheda residenti non
-- deve mai scegliere fra due eventi contemporanei.

create table if not exists grigliata_evento (
  id            bigserial primary key,
  titolo        text not null default 'Grigliata',
  creato_da     text not null,
  scadenza      timestamptz not null,
  -- Il giorno VERO in cui si mangia, distinto dalla scadenza delle
  -- adesioni/pagamenti (che può cadere prima).
  giorno_evento date not null,
  paypal_link   text,
  satispay_link text,
  -- v1.4: il delegato può raccogliere le quote dall'app o no (grigliata
  -- offerta, contanti sul posto). Spenti, i link non sono obbligatori e la
  -- scheda residenti non mostra la sezione di pagamento; i flag di
  -- pagamento delle adesioni restano salvati, solo nascosti.
  pagamenti_attivi boolean not null default true,
  -- v1.4.1: quota a persona, facoltativa (null = non indicata). Il residente
  -- la vede sia con i pagamenti attivi sia spenti.
  quota         numeric(7, 2) check (quota is null or (quota >= 0 and quota <= 1000)),
  -- Disattivata invece di cancellata, come le regole ricorrenti e gli
  -- account: un evento passato resta nella dashboard del delegato (l'ultimo,
  -- se non ce n'è uno attivo) invece di sparire senza lasciare traccia.
  chiuso        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- I menu fra cui si sceglie (es. "Carne"/"Pesce"): li decide il delegato
-- per ogni grigliata, il primo è quello "di base". Un'adesione indica il suo
-- menu per id, non per nome: così rinominarlo non stacca chi l'aveva già
-- scelto.
create table if not exists grigliata_menu (
  id         bigserial primary key,
  evento_id  bigint not null references grigliata_evento(id) on delete cascade,
  nome       text not null check (char_length(btrim(nome)) between 1 and 40),
  posizione  int not null default 0
);
create unique index if not exists grigliata_menu_nome_unico on grigliata_menu (evento_id, lower(nome));

-- Le voci-ticket di un menu (es. menu "Carne" = "Salsiccia" + "Patatine" +
-- "Bibita") — definite dal delegato insieme al menu stesso. Ogni menu ne
-- richiede almeno una: niente "menu senza ticket" con un fallback implicito.
create table if not exists grigliata_menu_ticket (
  id        bigserial primary key,
  menu_id   bigint not null references grigliata_menu(id) on delete cascade,
  nome      text not null check (char_length(btrim(nome)) between 1 and 40),
  posizione int not null default 0
);
create unique index if not exists grigliata_menu_ticket_nome_unico on grigliata_menu_ticket (menu_id, lower(nome));

create table if not exists grigliata_adesione (
  id                   bigserial primary key,
  evento_id            bigint not null references grigliata_evento(id) on delete cascade,
  -- Come ogni altra identità in quest'app: la camera è autodichiarata, non
  -- verificata (vedi README, "L'identità è autodichiarata").
  room                 text not null,
  -- Una riga qui = una camera che partecipa: non esiste "adesione con
  -- partecipa=false" (v1.1 ha tolto la possibilità di rispondere "non
  -- parteciperò" — vedi la nota in grigliata_iscrivi più sotto). Un menu è
  -- quindi sempre presente. Un menu scelto da qualcuno non si può
  -- cancellare (grigliata_admin_modifica lo rifiuta con un messaggio chiaro
  -- prima ancora di arrivare al vincolo). Il vincolo è il `no action` di
  -- default e NON `restrict` di proposito: eliminare un evento cancella a
  -- cascata sia i suoi menu sia le sue adesioni nella stessa istruzione, e
  -- `restrict` controllerebbe riga per riga, subito — fallendo se il menu
  -- se ne va prima dell'adesione che lo indica. `no action` controlla alla
  -- fine dell'istruzione, quando entrambi sono già spariti.
  menu_id              bigint not null references grigliata_menu(id),
  -- Informazione A SÉ, indipendente dal menu scelto — si può scegliere il
  -- menu "Carne" e dichiararsi comunque vegani (il delegato prepara un
  -- piatto a parte). 'classico' = mangia di tutto, il valore di default: nel
  -- pannello non si segna, si segnano solo gli altri due (vedi
  -- GrigliataAdmin.tsx).
  dieta                text not null default 'classico'
                         check (dieta in ('classico', 'vegetariano', 'vegano')),
  -- Indipendente da menu E dieta (si può essere vegani E senza glutine), e
  -- una nota libera per allergie/intolleranze — informazioni per chi
  -- cucina, lette dal delegato nel pannello.
  senza_glutine        boolean not null default false,
  note                 text check (note is null or char_length(note) <= 300),
  pagamento_dichiarato boolean not null default false,
  pagamento_confermato boolean not null default false,
  confermato_da        text,
  confermato_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Un'adesione per camera per evento: aderire di nuovo aggiorna la
  -- precedente (upsert in grigliata_iscrivi), non ne crea una seconda.
  unique (evento_id, room)
);

-- Un ticket VERO, di UN'adesione, per UNA voce del suo menu — creato in
-- blocco alla conferma del pagamento (vedi grigliata_admin_conferma_pagamento
-- più sotto): uno "snapshot" di quel momento, non calcolato al volo. Se il
-- delegato cambia poi l'elenco ticket del menu, le adesioni già confermate
-- non cambiano. Un ticket "esiste" (è mostrabile/premibile) in quanto riga
-- qui — non serve una colonna a parte per dirlo.
create table if not exists grigliata_ticket (
  id             bigserial primary key,
  adesione_id    bigint not null references grigliata_adesione(id) on delete cascade,
  menu_ticket_id bigint not null references grigliata_menu_ticket(id),
  usato          boolean not null default false,
  numero         int,
  usato_at       timestamptz,
  unique (adesione_id, menu_ticket_id)
);

alter table grigliata_evento enable row level security;
alter table grigliata_menu enable row level security;
alter table grigliata_menu_ticket enable row level security;
alter table grigliata_adesione enable row level security;
alter table grigliata_ticket enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Percorso pubblico (residenti)
-- ─────────────────────────────────────────────────────────────────────────────

-- Solo il booleano, non l'evento intero: è quello che laundry_snapshot
-- incorpora (vedi functions.sql) per decidere se mostrare la scheda
-- "Grigliata" in navigazione, con la stessa cadenza di aggiornamento di tema
-- e cambio biancheria — nessun canale a parte, nessun altro giro di rete.
-- Il contenuto vero (evento, link di pagamento, la propria adesione) resta
-- dietro grigliata_stato_pubblico(), che la scheda stessa chiama quando si
-- apre.
create or replace function grigliata_attiva_bool()
returns boolean language sql stable as $$
  select exists (select 1 from grigliata_evento where not chiuso and now() < scadenza);
$$;

-- Cosa vede un residente: se c'è una grigliata attiva, i suoi dati, e la
-- propria adesione se ne ha già fatta una. 'attiva' e non chiusa e non
-- scaduta — le stesse due condizioni ripetute in ogni funzione qui sotto
-- che deve decidere "quale evento conta adesso".
create or replace function grigliata_stato_pubblico(p_room text)
returns jsonb language plpgsql stable as $$
declare
  v_evento grigliata_evento%rowtype;
  v_adesione grigliata_adesione%rowtype;
begin
  select * into v_evento from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento.id is null then
    return jsonb_build_object('ok', true, 'attiva', false);
  end if;

  select * into v_adesione from grigliata_adesione
    where evento_id = v_evento.id and room = coalesce(p_room, '');

  return jsonb_build_object(
    'ok', true,
    'attiva', true,
    'evento', jsonb_build_object(
      'id', v_evento.id,
      'titolo', v_evento.titolo,
      'scadenza', v_evento.scadenza,
      'giorno_evento', v_evento.giorno_evento,
      'pagamenti_attivi', v_evento.pagamenti_attivi,
      'quota', v_evento.quota,
      'paypal_link', v_evento.paypal_link,
      'satispay_link', v_evento.satispay_link,
      'menu', grigliata_menu_di(v_evento.id)
    ),
    'mia_adesione', case when v_adesione.id is null then null else jsonb_build_object(
      'menu_id', v_adesione.menu_id,
      'dieta', v_adesione.dieta,
      'senza_glutine', v_adesione.senza_glutine,
      'note', v_adesione.note,
      'pagamento_dichiarato', v_adesione.pagamento_dichiarato,
      'pagamento_confermato', v_adesione.pagamento_confermato,
      'ticket', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', gt.id, 'nome', mt.nome, 'usato', gt.usato, 'numero', gt.numero
        ) order by mt.posizione, mt.id)
        from grigliata_ticket gt
        join grigliata_menu_ticket mt on mt.id = gt.menu_ticket_id
        where gt.adesione_id = v_adesione.id
      ), '[]'::jsonb)
    ) end
  );
end;
$$;

-- Aderisce, col menu — non c'è più modo di "declinare" (v1.1: tolta la
-- possibilità di rispondere "non parteciperò", vedi la nota gemella in
-- src/modules/grigliata/application/iscriviti.js). Upsert: aderire due
-- volte aggiorna la stessa riga (per cambiare menu), non ne crea una
-- seconda (vedi il vincolo unique sulla tabella). I flag di pagamento NON
-- si toccano qui apposta: cambiare menu non deve far sparire in silenzio
-- una conferma di pagamento già data dal delegato.
create or replace function grigliata_iscrivi(
  p_room text, p_menu_id bigint, p_dieta text, p_senza_glutine boolean, p_note text
) returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_dieta text;
  v_note text;
begin
  select id into v_evento_id from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  -- Il menu deve essere uno di QUESTA grigliata, non di una precedente.
  if p_menu_id is null or not exists (
    select 1 from grigliata_menu where id = p_menu_id and evento_id = v_evento_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;

  v_dieta := case when p_dieta in ('vegetariano', 'vegano') then p_dieta else 'classico' end;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('ok', false, 'error', 'nota troppo lunga (massimo 300 caratteri)');
  end if;

  insert into grigliata_adesione (evento_id, room, menu_id, dieta, senza_glutine, note, updated_at)
  values (v_evento_id, p_room, p_menu_id, v_dieta, coalesce(p_senza_glutine, false), v_note, now())
  on conflict (evento_id, room) do update
    set menu_id = excluded.menu_id,
        dieta = excluded.dieta,
        senza_glutine = excluded.senza_glutine,
        note = excluded.note,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

-- "Ho pagato": non conferma nulla da sola, dice solo che il residente
-- afferma di aver inviato la quota. La conferma vera è amministrativa (vedi
-- grigliata_admin_conferma_pagamento più sotto).
create or replace function grigliata_dichiara_pagamento(p_room text)
returns jsonb language plpgsql as $$
declare
  v_evento grigliata_evento%rowtype;
  v_id bigint;
begin
  select * into v_evento from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento.id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  if not v_evento.pagamenti_attivi then
    return jsonb_build_object('ok', false, 'error', 'i pagamenti non sono attivi per questa grigliata');
  end if;

  select id into v_id
    from grigliata_adesione where evento_id = v_evento.id and room = p_room;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'devi prima aderire');
  end if;

  update grigliata_adesione set pagamento_dichiarato = true, updated_at = now() where id = v_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- "Usa" UN ticket (una delle voci del proprio menu) — percorso pubblico,
-- camera autodichiarata come grigliata_dichiara_pagamento. Il ticket deve
-- appartenere all'adesione di QUESTA camera: non basta indovinarne l'id. Il
-- numero progressivo (per evento+voce-ticket: quante "Salsiccia" sono già
-- uscite in tutto l'evento) si assegna SOLO in questo momento, mai prima —
-- uno screenshot fatto in anticipo non porta nessun numero valido, e una
-- volta usato il bottone sparisce per sempre nella UI perché lo stato vive
-- qui, non nello screenshot. `pg_advisory_xact_lock` serializza solo i
-- ticket della stessa voce nello stesso evento, così due persone che premono
-- "Usa" sulla stessa voce nello stesso istante non ricevono lo stesso numero.
create or replace function grigliata_usa_ticket(p_room text, p_ticket_id bigint)
returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_adesione_id bigint;
  v_ticket grigliata_ticket%rowtype;
  v_ticket_nome text;
  v_numero int;
  v_ricontrollo boolean;
begin
  select id into v_evento_id from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  select id into v_adesione_id
    from grigliata_adesione where evento_id = v_evento_id and room = p_room;

  if v_adesione_id is null then
    return jsonb_build_object('ok', false, 'error', 'devi prima aderire');
  end if;

  select * into v_ticket from grigliata_ticket where id = p_ticket_id and adesione_id = v_adesione_id;

  if v_ticket.id is null then
    return jsonb_build_object('ok', false, 'error', 'ticket non trovato');
  end if;

  if v_ticket.usato then
    return jsonb_build_object('ok', false, 'error', 'ticket già usato', 'ticket_numero', v_ticket.numero);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_evento_id::text || ':' || v_ticket.menu_ticket_id::text));

  -- Si rilegge lo stato DOPO il lock: un'altra sessione potrebbe aver
  -- marcato questo stesso ticket nel frattempo (due tocchi quasi simultanei).
  select usato into v_ricontrollo from grigliata_ticket where id = v_ticket.id;
  if v_ricontrollo then
    return jsonb_build_object('ok', false, 'error', 'ticket già usato');
  end if;

  select coalesce(count(*), 0) + 1 into v_numero
    from grigliata_ticket gt
    join grigliata_adesione a on a.id = gt.adesione_id
    where a.evento_id = v_evento_id and gt.menu_ticket_id = v_ticket.menu_ticket_id and gt.usato;

  update grigliata_ticket set usato = true, numero = v_numero, usato_at = now() where id = v_ticket.id;

  select nome into v_ticket_nome from grigliata_menu_ticket where id = v_ticket.menu_ticket_id;

  return jsonb_build_object('ok', true, 'ticket_numero', v_numero, 'ticket_nome', v_ticket_nome);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Percorso amministrativo (delegato, sistemista)
-- ─────────────────────────────────────────────────────────────────────────────

-- Un link "paypal.me/mario", senza schema, è un URL RELATIVO per un <a href>:
-- il browser lo risolve contro la pagina corrente invece che aprire PayPal.
-- Qui si aggiunge https:// se manca, così quel che finisce nel database è
-- sempre assoluto — il residente non deve mai pensarci, e non conta se lo
-- dimentica anche il delegato compilando il form.
create or replace function grigliata_normalizza_link(p_link text)
returns text language sql immutable as $$
  select case
    when p_link is null or btrim(p_link) = '' then null
    when btrim(p_link) ~* '^https?://' then btrim(p_link)
    else 'https://' || btrim(p_link)
  end;
$$;

-- L'elenco delle voci-ticket di UN menu è valido? Gemella di
-- grigliata_menu_errore, un livello più in basso — stesse regole (almeno
-- una voce, nomi non vuoti, non duplicati, non più di 10, id duplicato
-- rifiutato), sulle voci invece che sui menu. Usata DENTRO
-- grigliata_menu_errore, per ciascun menu dell'elenco.
create or replace function grigliata_ticket_errore(p_ticket jsonb)
returns text language plpgsql immutable as $$
declare
  v_voce jsonb;
  v_nome text;
  v_visti text[] := '{}';
  v_ids text[] := '{}';
begin
  if p_ticket is null or jsonb_typeof(p_ticket) <> 'array' then
    return 'elenco ticket non valido';
  end if;
  if jsonb_array_length(p_ticket) < 1 then
    return 'serve almeno un ticket per menu';
  end if;
  if jsonb_array_length(p_ticket) > 10 then
    return 'al massimo 10 ticket per menu';
  end if;

  for v_voce in select value from jsonb_array_elements(p_ticket) loop
    v_nome := btrim(coalesce(v_voce->>'nome', ''));
    if v_nome = '' then
      return 'ogni ticket deve avere un nome';
    end if;
    if char_length(v_nome) > 40 then
      return 'nome del ticket troppo lungo (massimo 40 caratteri)';
    end if;
    if lower(v_nome) = any(v_visti) then
      return 'due ticket con lo stesso nome: ' || v_nome;
    end if;
    v_visti := v_visti || lower(v_nome);
    if v_voce->>'id' is not null then
      if (v_voce->>'id') = any(v_ids) then
        return 'ticket non valido';
      end if;
      v_ids := v_ids || (v_voce->>'id');
    end if;
  end loop;

  return null;
end;
$$;

-- L'elenco dei menu è valido? Torna il messaggio d'errore, o null se va
-- bene. Usata sia da grigliata_admin_crea sia da grigliata_admin_modifica,
-- così le regole sono scritte una volta sola (le stesse di controllaMenu()
-- in src/modules/grigliata/domain/validazione.js). Ogni menu porta anche le
-- sue voci-ticket, validate da grigliata_ticket_errore.
create or replace function grigliata_menu_errore(p_menu jsonb)
returns text language plpgsql immutable as $$
declare
  v_voce jsonb;
  v_nome text;
  v_visti text[] := '{}';
  v_ids text[] := '{}';
  v_err_ticket text;
begin
  if p_menu is null or jsonb_typeof(p_menu) <> 'array' then
    return 'menu non valido';
  end if;
  if jsonb_array_length(p_menu) < 1 then
    return 'serve almeno un menu';
  end if;
  if jsonb_array_length(p_menu) > 10 then
    return 'al massimo 10 menu';
  end if;

  for v_voce in select value from jsonb_array_elements(p_menu) loop
    v_nome := btrim(coalesce(v_voce->>'nome', ''));
    if v_nome = '' then
      return 'ogni menu deve avere un nome';
    end if;
    if char_length(v_nome) > 40 then
      return 'nome del menu troppo lungo (massimo 40 caratteri)';
    end if;
    if lower(v_nome) = any(v_visti) then
      return 'due menu con lo stesso nome: ' || v_nome;
    end if;
    v_visti := v_visti || lower(v_nome);
    -- Lo stesso menu esistente elencato due volte: uno dei due nomi
    -- sparirebbe in silenzio.
    if v_voce->>'id' is not null then
      if (v_voce->>'id') = any(v_ids) then
        return 'menu non valido';
      end if;
      v_ids := v_ids || (v_voce->>'id');
    end if;

    v_err_ticket := grigliata_ticket_errore(v_voce->'ticket');
    if v_err_ticket is not null then
      return format('menu "%s": %s', v_nome, v_err_ticket);
    end if;
  end loop;

  return null;
end;
$$;

-- I menu di un evento, CON le loro voci-ticket — la forma che stato_pubblico
-- e admin_overview restituiscono entrambi (il residente ignora `ticket` nel
-- picker iniziale; il pannello admin la usa per precompilare l'editor di
-- modifica).
create or replace function grigliata_menu_di(p_evento_id bigint)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'nome', m.nome,
    'ticket', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome) order by t.posizione, t.id)
      from grigliata_menu_ticket t where t.menu_id = m.id
    ), '[]'::jsonb)
  ) order by m.posizione, m.id), '[]'::jsonb)
  from grigliata_menu m where m.evento_id = p_evento_id;
$$;

-- Fa partire una nuova grigliata, coi suoi menu (array jsonb di
-- {nome, ticket: [{nome}, ...]}, nell'ordine voluto: il primo menu è quello
-- di base). Chiude da sola qualunque evento ancora attivo prima di crearne
-- uno: una alla volta, sempre — la scheda residenti non deve mai scegliere
-- fra due.
create or replace function grigliata_admin_crea(
  p_titolo text, p_scadenza timestamptz, p_giorno_evento date, p_paypal text, p_satispay text, p_menu jsonb, p_attore text,
  -- default: il codice già in produzione (che non manda questo parametro)
  -- continua a funzionare fra l'applicazione di questa migrazione e il deploy.
  p_pagamenti_attivi boolean default true,
  p_quota numeric default null
) returns jsonb language plpgsql as $$
declare
  v_id bigint;
  v_paypal text;
  v_satispay text;
  v_errore text;
  v_voce record;
  v_menu_id bigint;
  v_pagamenti boolean := coalesce(p_pagamenti_attivi, true);
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
  end if;

  if p_giorno_evento is null then
    return jsonb_build_object('ok', false, 'error', 'indica il giorno della grigliata');
  end if;

  v_paypal := grigliata_normalizza_link(p_paypal);
  v_satispay := grigliata_normalizza_link(p_satispay);

  if v_pagamenti and v_paypal is null and v_satispay is null then
    return jsonb_build_object('ok', false, 'error', 'inserisci almeno un link per il pagamento (PayPal o Satispay)');
  end if;

  if p_quota is not null and (p_quota < 0 or p_quota > 1000) then
    return jsonb_build_object('ok', false, 'error', 'quota non valida (fra 0 e 1000 €)');
  end if;

  v_errore := grigliata_menu_errore(p_menu);
  if v_errore is not null then
    return jsonb_build_object('ok', false, 'error', v_errore);
  end if;

  update grigliata_evento set chiuso = true where not chiuso;

  insert into grigliata_evento (titolo, creato_da, scadenza, giorno_evento, paypal_link, satispay_link, pagamenti_attivi, quota)
  values (
    coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
    p_attore, p_scadenza, p_giorno_evento, v_paypal, v_satispay, v_pagamenti, round(p_quota, 2)
  )
  returning id into v_id;

  -- Un evento nuovo non ha menu (né voci-ticket) esistenti: un ciclo, non
  -- un'unica INSERT...SELECT, perché ogni menu appena creato deve portare
  -- subito le proprie voci — serve il suo id, che solo RETURNING dà.
  for v_voce in select e.value, e.ordinality from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality) loop
    insert into grigliata_menu (evento_id, nome, posizione)
    values (v_id, btrim(v_voce.value->>'nome'), v_voce.ordinality - 1)
    returning id into v_menu_id;

    insert into grigliata_menu_ticket (menu_id, nome, posizione)
    select v_menu_id, btrim(t.value->>'nome'), t.ordinality - 1
    from jsonb_array_elements(v_voce.value->'ticket') with ordinality as t(value, ordinality);
  end loop;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Imposta (o toglie, con null) la quota a persona di un evento esistente.
-- Indipendente dai pagamenti attivi: anche con i pagamenti spenti la quota
-- dice al residente quanto portare (es. contanti sul posto).
create or replace function grigliata_admin_imposta_quota(p_evento_id bigint, p_quota numeric)
returns jsonb language plpgsql as $$
begin
  if p_quota is not null and (p_quota < 0 or p_quota > 1000) then
    return jsonb_build_object('ok', false, 'error', 'quota non valida (fra 0 e 1000 €)');
  end if;

  update grigliata_evento set quota = round(p_quota, 2) where id = p_evento_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Attiva/disattiva i pagamenti di un evento esistente, e ne aggiorna i
-- link. Un link passato null o vuoto NON cancella quello salvato: così
-- spegnere e riaccendere non chiede di riscriverli. Riattivare un evento
-- che non ha nessun link (creato con i pagamenti spenti) li richiede.
create or replace function grigliata_admin_imposta_pagamenti(
  p_evento_id bigint, p_attivi boolean, p_paypal text, p_satispay text
) returns jsonb language plpgsql as $$
declare
  v_evento grigliata_evento%rowtype;
  v_paypal text;
  v_satispay text;
begin
  select * into v_evento from grigliata_evento where id = p_evento_id;
  if v_evento.id is null then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

  v_paypal := coalesce(grigliata_normalizza_link(p_paypal), v_evento.paypal_link);
  v_satispay := coalesce(grigliata_normalizza_link(p_satispay), v_evento.satispay_link);

  if coalesce(p_attivi, false) and v_paypal is null and v_satispay is null then
    return jsonb_build_object('ok', false, 'error', 'inserisci almeno un link per il pagamento (PayPal o Satispay)');
  end if;

  update grigliata_evento
    set pagamenti_attivi = coalesce(p_attivi, false), paypal_link = v_paypal, satispay_link = v_satispay
    where id = p_evento_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Cambia titolo, scadenza, giorno e menu (con le loro voci-ticket) di un
-- evento esistente — non tocca chiuso: se il delegato aveva chiuso l'evento
-- a mano, modificarlo non lo riapre (vedi grigliata_admin_riapri per
-- quello). I menu arrivano come array jsonb di {id?, nome, ticket}: con id
-- = uno che esiste già (si rinomina/sposta), senza id = nuovo; quelli
-- dell'evento non più elencati si tolgono — ma non se qualche camera li ha
-- già scelti, e lo stesso per una voce-ticket già assegnata a un'adesione.
create or replace function grigliata_admin_modifica(
  p_evento_id bigint, p_titolo text, p_scadenza timestamptz, p_giorno_evento date, p_menu jsonb
) returns jsonb language plpgsql as $$
declare
  v_errore text;
  v_nome text;
  v_quante int;
  v_voce record;
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
  end if;

  if p_giorno_evento is null then
    return jsonb_build_object('ok', false, 'error', 'indica il giorno della grigliata');
  end if;

  if not exists (select 1 from grigliata_evento where id = p_evento_id) then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

  v_errore := grigliata_menu_errore(p_menu);
  if v_errore is not null then
    return jsonb_build_object('ok', false, 'error', v_errore);
  end if;

  -- Un id che non appartiene a QUESTO evento non si rinomina: sarebbe un
  -- menu di un'altra grigliata.
  if exists (
    select 1 from jsonb_array_elements(p_menu) e
    where e.value->>'id' is not null
      and not exists (select 1 from grigliata_menu m where m.id = (e.value->>'id')::bigint and m.evento_id = p_evento_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'menu non valido');
  end if;

  -- Un menu tolto dall'elenco che qualche camera ha già scelto: si rifiuta
  -- invece di lasciare adesioni senza menu. Il delegato può rinominarlo, o
  -- prima spostare quelle camere su un altro menu.
  select m.nome, count(*) into v_nome, v_quante
  from grigliata_menu m
  join grigliata_adesione a on a.menu_id = m.id
  where m.evento_id = p_evento_id
    and m.id not in (
      select (e.value->>'id')::bigint from jsonb_array_elements(p_menu) e where e.value->>'id' is not null
    )
  group by m.id, m.nome
  limit 1;

  if v_nome is not null then
    return jsonb_build_object('ok', false, 'error',
      format('il menu "%s" è già stato scelto da %s %s: non si può togliere', v_nome, v_quante,
             case when v_quante = 1 then 'camera' else 'camere' end));
  end if;

  -- Una voce-ticket tolta da un menu ESISTENTE che ha già almeno un ticket
  -- vero assegnato (grigliata_ticket, creato alla conferma di un pagamento)
  -- si rifiuta allo stesso modo — altrimenti sparirebbe un ticket già in
  -- mano a chi ha già pagato.
  for v_voce in select e.value from jsonb_array_elements(p_menu) e where e.value->>'id' is not null loop
    select t.nome, count(gt.id) into v_nome, v_quante
    from grigliata_menu_ticket t
    join grigliata_ticket gt on gt.menu_ticket_id = t.id
    where t.menu_id = (v_voce.value->>'id')::bigint
      and t.id not in (
        select (e2.value->>'id')::bigint
        from jsonb_array_elements(v_voce.value->'ticket') e2
        where e2.value->>'id' is not null
      )
    group by t.id, t.nome
    limit 1;

    if v_nome is not null then
      return jsonb_build_object('ok', false, 'error',
        format('il ticket "%s" è già assegnato a %s %s: non si può togliere', v_nome, v_quante,
               case when v_quante = 1 then 'adesione' else 'adesioni' end));
    end if;
  end loop;

  update grigliata_evento
    set titolo = coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
        scadenza = p_scadenza,
        giorno_evento = p_giorno_evento
    where id = p_evento_id;

  delete from grigliata_menu m
  where m.evento_id = p_evento_id
    and m.id not in (
      select (e.value->>'id')::bigint from jsonb_array_elements(p_menu) e where e.value->>'id' is not null
    );

  -- Due passaggi per i nomi: prima un nome provvisorio unico, poi quello
  -- vero — altrimenti scambiare due nomi fra loro ("A"↔"B") violerebbe
  -- per un istante il vincolo di unicità a metà dell'aggiornamento.
  update grigliata_menu set nome = '#' || id where evento_id = p_evento_id;

  update grigliata_menu m
    set nome = btrim(e.value->>'nome'), posizione = e.ordinality - 1
  from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality)
  where e.value->>'id' is not null and m.id = (e.value->>'id')::bigint;

  insert into grigliata_menu (evento_id, nome, posizione)
  select p_evento_id, btrim(e.value->>'nome'), e.ordinality - 1
  from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality)
  where e.value->>'id' is null;

  -- Ora che ogni menu del payload corrisponde a una riga vera (esistente o
  -- appena creata, e con il nome finale — il passaggio sopra lo garantisce),
  -- si sincronizzano le sue voci-ticket: stesso schema a due passaggi per i
  -- nomi, un livello più in basso. Il nome è univoco per evento (vincolo
  -- grigliata_menu_nome_unico), quindi il join è affidabile.
  for v_voce in
    select e.value, m.id as menu_id
    from jsonb_array_elements(p_menu) e
    join grigliata_menu m on m.evento_id = p_evento_id and m.nome = btrim(e.value->>'nome')
  loop
    delete from grigliata_menu_ticket t
    where t.menu_id = v_voce.menu_id
      and t.id not in (
        select (e2.value->>'id')::bigint from jsonb_array_elements(v_voce.value->'ticket') e2
        where e2.value->>'id' is not null
      );

    update grigliata_menu_ticket set nome = '#' || id where menu_id = v_voce.menu_id;

    update grigliata_menu_ticket t
      set nome = btrim(e2.value->>'nome'), posizione = e2.ordinality - 1
    from jsonb_array_elements(v_voce.value->'ticket') with ordinality as e2(value, ordinality)
    where e2.value->>'id' is not null and t.id = (e2.value->>'id')::bigint;

    insert into grigliata_menu_ticket (menu_id, nome, posizione)
    select v_voce.menu_id, btrim(e2.value->>'nome'), e2.ordinality - 1
    from jsonb_array_elements(v_voce.value->'ticket') with ordinality as e2(value, ordinality)
    where e2.value->>'id' is null;
  end loop;

  return jsonb_build_object('ok', true, 'scadenza', p_scadenza);
end;
$$;

-- La dashboard del delegato: l'evento più recente (attivo o l'ultimo
-- chiuso — non uno storico di tutti, solo l'ultimo: un delegato lavora su
-- una grigliata alla volta) e tutte le adesioni, con menu, ticket e stato
-- del pagamento di ciascuna.
create or replace function grigliata_admin_overview()
returns jsonb language plpgsql stable as $$
declare
  v_evento grigliata_evento%rowtype;
begin
  select * into v_evento from grigliata_evento order by created_at desc limit 1;

  if v_evento.id is null then
    return jsonb_build_object('ok', true, 'evento', null, 'adesioni', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'evento', jsonb_build_object(
      'id', v_evento.id, 'titolo', v_evento.titolo, 'scadenza', v_evento.scadenza,
      'giorno_evento', v_evento.giorno_evento,
      'pagamenti_attivi', v_evento.pagamenti_attivi, 'quota', v_evento.quota,
      'paypal_link', v_evento.paypal_link, 'satispay_link', v_evento.satispay_link,
      'chiuso', v_evento.chiuso, 'attiva', (not v_evento.chiuso and now() < v_evento.scadenza),
      'menu', grigliata_menu_di(v_evento.id)
    ),
    'adesioni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'room', a.room, 'menu_id', a.menu_id, 'dieta', a.dieta,
        'senza_glutine', a.senza_glutine, 'note', a.note,
        'pagamento_dichiarato', a.pagamento_dichiarato, 'pagamento_confermato', a.pagamento_confermato,
        'confermato_da', a.confermato_da, 'confermato_at', a.confermato_at,
        'ticket', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', gt.id, 'nome', mt.nome, 'usato', gt.usato, 'numero', gt.numero, 'usato_at', gt.usato_at
          ) order by mt.posizione, mt.id)
          from grigliata_ticket gt
          join grigliata_menu_ticket mt on mt.id = gt.menu_ticket_id
          where gt.adesione_id = a.id
        ), '[]'::jsonb)
      ) order by a.room)
      from grigliata_adesione a where a.evento_id = v_evento.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Conferma il pagamento di UNA adesione, e genera i suoi ticket — uno per
-- ogni voce del menu scelto, nello stato in cui quel menu si trova ADESSO
-- (snapshot: se il delegato cambia poi l'elenco ticket del menu, questa
-- adesione non cambia). Idempotente: confermare di nuovo un pagamento già
-- confermato non duplica i ticket già creati. Torna room + titolo
-- dell'evento: non per il client (che si ferma a {ok}), ma per lo strato JS
-- (adminConfermaPagamento.js), che li usa per notificare la camera — questa
-- funzione non sa nulla di push o Telegram, quello è compito del modulo
-- Notifications, chiamato da fuori.
create or replace function grigliata_admin_conferma_pagamento(p_adesione_id bigint, p_attore text)
returns jsonb language plpgsql as $$
declare
  v_room text;
  v_titolo text;
  v_menu_id bigint;
begin
  update grigliata_adesione a
  set pagamento_confermato = true, confermato_da = p_attore, confermato_at = now(), updated_at = now()
  from grigliata_evento e
  where a.id = p_adesione_id and e.id = a.evento_id
  returning a.room, e.titolo, a.menu_id into v_room, v_titolo, v_menu_id;

  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'adesione non trovata');
  end if;

  insert into grigliata_ticket (adesione_id, menu_ticket_id)
  select p_adesione_id, t.id
  from grigliata_menu_ticket t
  where t.menu_id = v_menu_id
  on conflict (adesione_id, menu_ticket_id) do nothing;

  return jsonb_build_object('ok', true, 'room', v_room, 'titolo', v_titolo);
end;
$$;

-- Aggiunge (o corregge) a mano l'adesione di una camera — per chi non usa
-- l'app, o per registrare chi ha dato la sua parola di persona. Upsert come
-- grigliata_iscrivi: se la camera aveva già risposto, la sua riga si
-- aggiorna invece di duplicarsi (stesso vincolo unique(evento_id, room)).
-- Tocca menu e dieta (uno di quelli di QUESTO evento, la dieta con lo
-- stesso default 'classico' di grigliata_iscrivi se non riconosciuta):
-- "senza glutine" e la nota di una camera che aveva già risposto da sé
-- restano quelli che ha scritto lei (una riga nuova parte dai default:
-- glutine sì, nessuna nota).
create or replace function grigliata_admin_aggiungi_adesione(
  p_evento_id bigint, p_room text, p_menu_id bigint, p_dieta text
) returns jsonb language plpgsql as $$
declare
  v_dieta text;
begin
  if not exists (select 1 from grigliata_evento where id = p_evento_id) then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;
  if p_room is null or btrim(p_room) = '' then
    return jsonb_build_object('ok', false, 'error', 'camera mancante');
  end if;
  if p_menu_id is null or not exists (
    select 1 from grigliata_menu where id = p_menu_id and evento_id = p_evento_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;

  v_dieta := case when p_dieta in ('vegetariano', 'vegano') then p_dieta else 'classico' end;

  insert into grigliata_adesione (evento_id, room, menu_id, dieta, updated_at)
  values (p_evento_id, btrim(p_room), p_menu_id, v_dieta, now())
  on conflict (evento_id, room) do update
    set menu_id = excluded.menu_id, dieta = excluded.dieta, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

-- Toglie un'adesione — la riga sparisce del tutto: la camera torna come se
-- non avesse mai risposto. Per correggere un'adesione aggiunta per sbaglio,
-- o una camera che il delegato sa per certo non parteciperà più.
create or replace function grigliata_admin_rimuovi_adesione(p_adesione_id bigint)
returns jsonb language plpgsql as $$
begin
  delete from grigliata_adesione where id = p_adesione_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'adesione non trovata');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Chiude un evento a mano, prima della scadenza naturale.
create or replace function grigliata_admin_chiudi(p_evento_id bigint)
returns jsonb language plpgsql as $$
begin
  update grigliata_evento set chiuso = true where id = p_evento_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Riapre un evento chiuso. Chiude prima qualunque ALTRO evento ancora
-- attivo: "attiva" è calcolato (not chiuso and now() < scadenza), non un
-- flag a sé — senza questo passaggio si potrebbero ritrovare due grigliate
-- attive insieme, e la scheda residenti ne mostra sempre una sola.
--
-- Non tocca la scadenza: se era già passata, l'evento torna "non chiuso"
-- ma resta comunque non attivo finché non si sposta anche la data (vedi
-- grigliata_admin_modifica) — due decisioni separate, non una.
create or replace function grigliata_admin_riapri(p_evento_id bigint)
returns jsonb language plpgsql as $$
begin
  update grigliata_evento set chiuso = true
    where id <> p_evento_id and not chiuso and now() < scadenza;

  update grigliata_evento set chiuso = false where id = p_evento_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Elimina un evento e, per la on delete cascade sulle tabelle
-- grigliata_adesione/grigliata_menu/grigliata_menu_ticket/grigliata_ticket,
-- tutto quel che gli appartiene — irreversibile, per questo solo su un
-- evento già chiuso: un evento ancora attivo va chiuso prima, così non
-- sparisce sotto i piedi a una scheda residenti che lo sta ancora mostrando.
create or replace function grigliata_admin_elimina(p_evento_id bigint)
returns jsonb language plpgsql as $$
declare
  v_chiuso boolean;
begin
  select chiuso into v_chiuso from grigliata_evento where id = p_evento_id;
  if v_chiuso is null then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;
  if not v_chiuso then
    return jsonb_build_object('ok', false, 'error', 'chiudi prima la grigliata per poterla eliminare');
  end if;

  delete from grigliata_evento where id = p_evento_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permessi
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function grigliata_attiva_bool() from public, anon, authenticated;
revoke all on function grigliata_stato_pubblico(text) from public, anon, authenticated;
revoke all on function grigliata_iscrivi(text, bigint, text, boolean, text) from public, anon, authenticated;
revoke all on function grigliata_dichiara_pagamento(text) from public, anon, authenticated;
revoke all on function grigliata_usa_ticket(text, bigint) from public, anon, authenticated;
revoke all on function grigliata_normalizza_link(text) from public, anon, authenticated;
revoke all on function grigliata_ticket_errore(jsonb) from public, anon, authenticated;
revoke all on function grigliata_menu_errore(jsonb) from public, anon, authenticated;
revoke all on function grigliata_menu_di(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_crea(text, timestamptz, date, text, text, jsonb, text, boolean, numeric) from public, anon, authenticated;
revoke all on function grigliata_admin_imposta_quota(bigint, numeric) from public, anon, authenticated;
revoke all on function grigliata_admin_imposta_pagamenti(bigint, boolean, text, text) from public, anon, authenticated;
revoke all on function grigliata_admin_modifica(bigint, text, timestamptz, date, jsonb) from public, anon, authenticated;
revoke all on function grigliata_admin_overview() from public, anon, authenticated;
revoke all on function grigliata_admin_conferma_pagamento(bigint, text) from public, anon, authenticated;
revoke all on function grigliata_admin_aggiungi_adesione(bigint, text, bigint, text) from public, anon, authenticated;
revoke all on function grigliata_admin_rimuovi_adesione(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_chiudi(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_riapri(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_elimina(bigint) from public, anon, authenticated;

grant execute on function grigliata_attiva_bool() to service_role;
grant execute on function grigliata_stato_pubblico(text) to service_role;
grant execute on function grigliata_iscrivi(text, bigint, text, boolean, text) to service_role;
grant execute on function grigliata_dichiara_pagamento(text) to service_role;
grant execute on function grigliata_usa_ticket(text, bigint) to service_role;
grant execute on function grigliata_normalizza_link(text) to service_role;
grant execute on function grigliata_ticket_errore(jsonb) to service_role;
grant execute on function grigliata_menu_errore(jsonb) to service_role;
grant execute on function grigliata_menu_di(bigint) to service_role;
grant execute on function grigliata_admin_crea(text, timestamptz, date, text, text, jsonb, text, boolean, numeric) to service_role;
grant execute on function grigliata_admin_imposta_quota(bigint, numeric) to service_role;
grant execute on function grigliata_admin_imposta_pagamenti(bigint, boolean, text, text) to service_role;
grant execute on function grigliata_admin_modifica(bigint, text, timestamptz, date, jsonb) to service_role;
grant execute on function grigliata_admin_overview() to service_role;
grant execute on function grigliata_admin_conferma_pagamento(bigint, text) to service_role;
grant execute on function grigliata_admin_aggiungi_adesione(bigint, text, bigint, text) to service_role;
grant execute on function grigliata_admin_rimuovi_adesione(bigint) to service_role;
grant execute on function grigliata_admin_chiudi(bigint) to service_role;
grant execute on function grigliata_admin_riapri(bigint) to service_role;
grant execute on function grigliata_admin_elimina(bigint) to service_role;
