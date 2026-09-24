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
-- Grigliata: il delegato fa partire un evento (titolo, scadenza, link di
-- pagamento), i residenti aderiscono e scelgono il menu, dichiarano di aver
-- pagato, il delegato conferma. Percorso pubblico per i residenti (camera
-- autodichiarata, stesso modello di fiducia di tutto il resto dell'app) e
-- amministrativo per creare/chiudere l'evento e confermare i pagamenti —
-- vedi src/modules/grigliata/domain/policy.js: riservato a delegato e
-- sistemista, non a FDO/staff.
--
-- UNA grigliata alla volta: farne partire una nuova chiude automaticamente
-- quella ancora attiva (grigliata_admin_crea), così la scheda residenti non
-- deve mai scegliere fra due eventi contemporanei.

create table if not exists grigliata_evento (
  id            bigserial primary key,
  titolo        text not null default 'Grigliata',
  creato_da     text not null,
  scadenza      timestamptz not null,
  paypal_link   text,
  satispay_link text,
  -- Disattivata invece di cancellata, come le regole ricorrenti e gli
  -- account: un evento passato resta nella dashboard del delegato (l'ultimo,
  -- se non ce n'è uno attivo) invece di sparire senza lasciare traccia.
  chiuso        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- I menu fra cui si sceglie: li decide il delegato per ogni grigliata (v1.3
-- — prima erano un elenco fisso). Il PRIMO (posizione 0) è quello "di
-- base": nel pannello non viene segnato sulle pastiglie, si segnano solo i
-- casi diversi. Un'adesione indica il suo menu per id, non per nome: così
-- rinominarlo non stacca chi l'aveva già scelto.
create table if not exists grigliata_menu (
  id         bigserial primary key,
  evento_id  bigint not null references grigliata_evento(id) on delete cascade,
  nome       text not null check (char_length(btrim(nome)) between 1 and 40),
  posizione  int not null default 0
);
create unique index if not exists grigliata_menu_nome_unico on grigliata_menu (evento_id, lower(nome));

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
  -- v1.3: indipendente dal menu (si può essere vegani E senza glutine), e
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

alter table grigliata_evento enable row level security;
alter table grigliata_menu enable row level security;
alter table grigliata_adesione enable row level security;

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
      'paypal_link', v_evento.paypal_link,
      'satispay_link', v_evento.satispay_link,
      'menu', grigliata_menu_di(v_evento.id)
    ),
    'mia_adesione', case when v_adesione.id is null then null else jsonb_build_object(
      'menu_id', v_adesione.menu_id,
      'senza_glutine', v_adesione.senza_glutine,
      'note', v_adesione.note,
      'pagamento_dichiarato', v_adesione.pagamento_dichiarato,
      'pagamento_confermato', v_adesione.pagamento_confermato
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
--
-- v1.3: anche "senza glutine" e una nota libera — riscritti entrambi a ogni
-- adesione (il form li rimanda sempre, già precompilati), una nota vuota
-- torna null invece di restare una stringa vuota.
create or replace function grigliata_iscrivi(p_room text, p_menu_id bigint, p_senza_glutine boolean, p_note text)
returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
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

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('ok', false, 'error', 'nota troppo lunga (massimo 300 caratteri)');
  end if;

  insert into grigliata_adesione (evento_id, room, menu_id, senza_glutine, note, updated_at)
  values (v_evento_id, p_room, p_menu_id, coalesce(p_senza_glutine, false), v_note, now())
  on conflict (evento_id, room) do update
    set menu_id = excluded.menu_id,
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
  v_evento_id bigint;
  v_id bigint;
begin
  select id into v_evento_id from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  select id into v_id
    from grigliata_adesione where evento_id = v_evento_id and room = p_room;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'devi prima aderire');
  end if;

  update grigliata_adesione set pagamento_dichiarato = true, updated_at = now() where id = v_id;
  return jsonb_build_object('ok', true);
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

-- L'elenco dei menu è valido? Torna il messaggio d'errore, o null se va
-- bene. Usata sia da grigliata_admin_crea sia da grigliata_admin_modifica,
-- così le regole sono scritte una volta sola (le stesse di controllaMenu()
-- in src/modules/grigliata/domain/validazione.js).
create or replace function grigliata_menu_errore(p_menu jsonb)
returns text language plpgsql immutable as $$
declare
  v_voce jsonb;
  v_nome text;
  v_visti text[] := '{}';
  v_ids text[] := '{}';
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
  end loop;

  return null;
end;
$$;

-- I menu di un evento, nell'ordine scelto dal delegato — la forma che
-- stato_pubblico e admin_overview restituiscono entrambi.
create or replace function grigliata_menu_di(p_evento_id bigint)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome) order by m.posizione, m.id), '[]'::jsonb)
  from grigliata_menu m where m.evento_id = p_evento_id;
$$;

-- Fa partire una nuova grigliata, coi suoi menu (array jsonb di {nome},
-- nell'ordine voluto: il primo è quello di base). Chiude da sola qualunque
-- evento ancora attivo prima di crearne uno: una alla volta, sempre — la
-- scheda residenti non deve mai scegliere fra due.
create or replace function grigliata_admin_crea(
  p_titolo text, p_scadenza timestamptz, p_paypal text, p_satispay text, p_menu jsonb, p_attore text
) returns jsonb language plpgsql as $$
declare
  v_id bigint;
  v_paypal text;
  v_satispay text;
  v_errore text;
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
  end if;

  v_paypal := grigliata_normalizza_link(p_paypal);
  v_satispay := grigliata_normalizza_link(p_satispay);

  if v_paypal is null and v_satispay is null then
    return jsonb_build_object('ok', false, 'error', 'inserisci almeno un link per il pagamento (PayPal o Satispay)');
  end if;

  v_errore := grigliata_menu_errore(p_menu);
  if v_errore is not null then
    return jsonb_build_object('ok', false, 'error', v_errore);
  end if;

  update grigliata_evento set chiuso = true where not chiuso;

  insert into grigliata_evento (titolo, creato_da, scadenza, paypal_link, satispay_link)
  values (
    coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
    p_attore, p_scadenza, v_paypal, v_satispay
  )
  returning id into v_id;

  insert into grigliata_menu (evento_id, nome, posizione)
  select v_id, btrim(e.value->>'nome'), e.ordinality - 1
  from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Cambia titolo, scadenza e menu di un evento esistente — non tocca chiuso:
-- se il delegato aveva chiuso l'evento a mano, modificarlo non lo riapre
-- (vedi grigliata_admin_riapri per quello). Serve a correggere un nome o
-- una data sbagliata, dare più tempo, o aggiungere/rinominare/togliere un
-- menu, senza dover chiudere e far ripartire tutto da capo (perdendo le
-- adesioni già raccolte, che grigliata_admin_crea invece azzera sempre). Il
-- titolo ricade su 'Grigliata' se lasciato vuoto, stessa regola di
-- grigliata_admin_crea.
--
-- I menu arrivano come array jsonb di {id?, nome}: con id = uno che esiste
-- già (si rinomina/sposta), senza id = nuovo; quelli dell'evento non più
-- elencati si tolgono — ma non se qualche camera li ha già scelti.
create or replace function grigliata_admin_modifica(
  p_evento_id bigint, p_titolo text, p_scadenza timestamptz, p_menu jsonb
) returns jsonb language plpgsql as $$
declare
  v_errore text;
  v_nome text;
  v_quante int;
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
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

  update grigliata_evento
    set titolo = coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
        scadenza = p_scadenza
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

  return jsonb_build_object('ok', true, 'scadenza', p_scadenza);
end;
$$;

-- La dashboard del delegato: l'evento più recente (attivo o l'ultimo
-- chiuso — non uno storico di tutti, solo l'ultimo: un delegato lavora su
-- una grigliata alla volta) e tutte le adesioni, con menu e stato del
-- pagamento di ciascuna.
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
      'paypal_link', v_evento.paypal_link, 'satispay_link', v_evento.satispay_link,
      'chiuso', v_evento.chiuso, 'attiva', (not v_evento.chiuso and now() < v_evento.scadenza),
      'menu', grigliata_menu_di(v_evento.id)
    ),
    'adesioni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'room', a.room, 'menu_id', a.menu_id,
        'senza_glutine', a.senza_glutine, 'note', a.note,
        'pagamento_dichiarato', a.pagamento_dichiarato, 'pagamento_confermato', a.pagamento_confermato,
        'confermato_da', a.confermato_da, 'confermato_at', a.confermato_at
      ) order by a.room)
      from grigliata_adesione a where a.evento_id = v_evento.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Conferma il pagamento di UNA adesione. Torna room + titolo dell'evento:
-- non per il client (che si ferma a {ok}), ma per lo strato JS
-- (adminConfermaPagamento.js), che li usa per notificare la camera —
-- questa funzione non sa nulla di push o Telegram, quello è compito del
-- modulo Notifications, chiamato da fuori.
create or replace function grigliata_admin_conferma_pagamento(p_adesione_id bigint, p_attore text)
returns jsonb language plpgsql as $$
declare
  v_room text;
  v_titolo text;
begin
  update grigliata_adesione a
  set pagamento_confermato = true, confermato_da = p_attore, confermato_at = now(), updated_at = now()
  from grigliata_evento e
  where a.id = p_adesione_id and e.id = a.evento_id
  returning a.room, e.titolo into v_room, v_titolo;

  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'adesione non trovata');
  end if;

  return jsonb_build_object('ok', true, 'room', v_room, 'titolo', v_titolo);
end;
$$;

-- Aggiunge (o corregge) a mano l'adesione di una camera — per chi non usa
-- l'app, o per registrare chi ha dato la sua parola di persona. Upsert come
-- grigliata_iscrivi: se la camera aveva già risposto, la sua riga si
-- aggiorna invece di duplicarsi (stesso vincolo unique(evento_id, room)).
-- Tocca solo il menu (uno di quelli di QUESTO evento): "senza glutine" e la
-- nota di una camera che aveva già risposto da sé restano quelli che ha
-- scritto lei (una riga nuova parte dai default: glutine sì, nessuna nota).
create or replace function grigliata_admin_aggiungi_adesione(p_evento_id bigint, p_room text, p_menu_id bigint)
returns jsonb language plpgsql as $$
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

  insert into grigliata_adesione (evento_id, room, menu_id, updated_at)
  values (p_evento_id, btrim(p_room), p_menu_id, now())
  on conflict (evento_id, room) do update
    set menu_id = excluded.menu_id, updated_at = now();

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

-- Elimina un evento e, per la on delete cascade sulla tabella
-- grigliata_adesione, tutte le sue adesioni — irreversibile, per questo
-- solo su un evento già chiuso: un evento ancora attivo va chiuso prima,
-- così non sparisce sotto i piedi a una scheda residenti che lo sta
-- ancora mostrando.
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
revoke all on function grigliata_iscrivi(text, bigint, boolean, text) from public, anon, authenticated;
revoke all on function grigliata_dichiara_pagamento(text) from public, anon, authenticated;
revoke all on function grigliata_normalizza_link(text) from public, anon, authenticated;
revoke all on function grigliata_menu_errore(jsonb) from public, anon, authenticated;
revoke all on function grigliata_menu_di(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_crea(text, timestamptz, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function grigliata_admin_modifica(bigint, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function grigliata_admin_overview() from public, anon, authenticated;
revoke all on function grigliata_admin_conferma_pagamento(bigint, text) from public, anon, authenticated;
revoke all on function grigliata_admin_aggiungi_adesione(bigint, text, bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_rimuovi_adesione(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_chiudi(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_riapri(bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_elimina(bigint) from public, anon, authenticated;

grant execute on function grigliata_attiva_bool() to service_role;
grant execute on function grigliata_stato_pubblico(text) to service_role;
grant execute on function grigliata_iscrivi(text, bigint, boolean, text) to service_role;
grant execute on function grigliata_dichiara_pagamento(text) to service_role;
grant execute on function grigliata_normalizza_link(text) to service_role;
grant execute on function grigliata_menu_errore(jsonb) to service_role;
grant execute on function grigliata_menu_di(bigint) to service_role;
grant execute on function grigliata_admin_crea(text, timestamptz, text, text, jsonb, text) to service_role;
grant execute on function grigliata_admin_modifica(bigint, text, timestamptz, jsonb) to service_role;
grant execute on function grigliata_admin_overview() to service_role;
grant execute on function grigliata_admin_conferma_pagamento(bigint, text) to service_role;
grant execute on function grigliata_admin_aggiungi_adesione(bigint, text, bigint) to service_role;
grant execute on function grigliata_admin_rimuovi_adesione(bigint) to service_role;
grant execute on function grigliata_admin_chiudi(bigint) to service_role;
grant execute on function grigliata_admin_riapri(bigint) to service_role;
grant execute on function grigliata_admin_elimina(bigint) to service_role;
