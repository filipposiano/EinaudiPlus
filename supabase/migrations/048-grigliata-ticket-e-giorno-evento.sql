-- v1.4: due aggiunte alla Grigliata.
--
-- 1. `giorno_evento`: finora l'unica data sull'evento era `scadenza` (quando
--    chiudono le adesioni/i pagamenti) — non il giorno in cui si mangia
--    davvero, che può cadere dopo. Le grigliate già esistenti ricevono come
--    giorno la data della loro scadenza: un punto di partenza plausibile,
--    il delegato lo corregge da adminModificaEvento se serve.
--
-- 2. Ticket a uso unico, uno per adesione (un'adesione è già 1 persona/camera
--    con 1 menu scelto — niente quantità, niente tabella a parte). Un
--    ticket "esiste" solo se il pagamento è confermato: lo decide la query,
--    non una colonna. Si usa dal lato RESIDENTE (bottone "Usa" sul proprio
--    schermo, non una ricerca-camera lato banco e non un QR): il numero
--    progressivo si assegna SOLO nel momento in cui si preme, mai prima —
--    uno screenshot fatto in anticipo non mostra nessun numero valido, e
--    una volta usato il bottone sparisce per sempre (lo stato vive nel
--    database, non in quel che il residente fa vedere). Il numero è
--    progressivo per menu (non per evento intero): dà al delegato un
--    conteggio in tempo reale di quante porzioni di CIASCUN menu sono già
--    uscite, non solo quante sono state pagate.
--
-- Consolidato in supabase/grigliata.sql; qui la versione da applicare a un
-- database già in produzione (dopo la 047).

alter table grigliata_evento add column if not exists giorno_evento date;
update grigliata_evento set giorno_evento = scadenza::date where giorno_evento is null;
alter table grigliata_evento alter column giorno_evento set not null;

alter table grigliata_adesione add column if not exists ticket_usato boolean not null default false;
alter table grigliata_adesione add column if not exists ticket_numero int;
alter table grigliata_adesione add column if not exists ticket_usato_at timestamptz;

-- Le quattro funzioni che cambiano firma vanno tolte prima di ricrearle
-- (CREATE OR REPLACE richiede la stessa identica lista di parametri).
drop function if exists grigliata_admin_crea(text, timestamptz, text, text, jsonb, text);
drop function if exists grigliata_admin_modifica(bigint, text, timestamptz, jsonb);

-- "Usa" il proprio ticket — percorso pubblico, camera autodichiarata come
-- grigliata_dichiara_pagamento. Tre modi di fallire, con un messaggio
-- distinto per ciascuno (lo strato JS/UI li confronta per parola, non per
-- codice: coerente con lo stile '{ok:false,error:...}' di tutta la
-- grigliata). Il blocco `pg_advisory_xact_lock` serializza solo le camere
-- che condividono lo stesso evento+menu: due persone con lo stesso menu che
-- premono "Usa" nello stesso istante non possono ricevere lo stesso numero.
create or replace function grigliata_usa_ticket(p_room text)
returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_adesione grigliata_adesione%rowtype;
  v_menu_nome text;
  v_numero int;
  v_ricontrollo boolean;
begin
  select id into v_evento_id from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  select * into v_adesione
    from grigliata_adesione where evento_id = v_evento_id and room = p_room;

  if v_adesione.id is null then
    return jsonb_build_object('ok', false, 'error', 'devi prima aderire');
  end if;

  if not v_adesione.pagamento_confermato then
    return jsonb_build_object('ok', false, 'error', 'il pagamento non è ancora confermato');
  end if;

  if v_adesione.ticket_usato then
    return jsonb_build_object('ok', false, 'error', 'ticket già usato', 'ticket_numero', v_adesione.ticket_numero);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_evento_id::text || ':' || v_adesione.menu_id::text));

  -- Si rilegge lo stato DOPO il lock: un'altra sessione potrebbe aver
  -- marcato questa stessa adesione nel frattempo (due tocchi quasi
  -- simultanei sullo stesso ticket).
  select ticket_usato into v_ricontrollo
    from grigliata_adesione where id = v_adesione.id;
  if v_ricontrollo then
    return jsonb_build_object('ok', false, 'error', 'ticket già usato');
  end if;

  select coalesce(count(*), 0) + 1 into v_numero
    from grigliata_adesione
    where evento_id = v_evento_id and menu_id = v_adesione.menu_id and ticket_usato;

  update grigliata_adesione
    set ticket_usato = true, ticket_numero = v_numero, ticket_usato_at = now(), updated_at = now()
    where id = v_adesione.id;

  select nome into v_menu_nome from grigliata_menu where id = v_adesione.menu_id;

  return jsonb_build_object('ok', true, 'ticket_numero', v_numero, 'menu_nome', v_menu_nome);
end;
$$;

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
      'ticket_usato', v_adesione.ticket_usato,
      'ticket_numero', v_adesione.ticket_numero
    ) end
  );
end;
$$;

create or replace function grigliata_admin_crea(
  p_titolo text, p_scadenza timestamptz, p_giorno_evento date, p_paypal text, p_satispay text, p_menu jsonb, p_attore text
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

  if p_giorno_evento is null then
    return jsonb_build_object('ok', false, 'error', 'indica il giorno della grigliata');
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

  insert into grigliata_evento (titolo, creato_da, scadenza, giorno_evento, paypal_link, satispay_link)
  values (
    coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
    p_attore, p_scadenza, p_giorno_evento, v_paypal, v_satispay
  )
  returning id into v_id;

  insert into grigliata_menu (evento_id, nome, posizione)
  select v_id, btrim(e.value->>'nome'), e.ordinality - 1
  from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function grigliata_admin_modifica(
  p_evento_id bigint, p_titolo text, p_scadenza timestamptz, p_giorno_evento date, p_menu jsonb
) returns jsonb language plpgsql as $$
declare
  v_errore text;
  v_nome text;
  v_quante int;
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

  return jsonb_build_object('ok', true, 'scadenza', p_scadenza);
end;
$$;

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
        'ticket_usato', a.ticket_usato, 'ticket_numero', a.ticket_numero, 'ticket_usato_at', a.ticket_usato_at
      ) order by a.room)
      from grigliata_adesione a where a.evento_id = v_evento.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function grigliata_usa_ticket(text) from public, anon, authenticated;
revoke all on function grigliata_admin_crea(text, timestamptz, date, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function grigliata_admin_modifica(bigint, text, timestamptz, date, jsonb) from public, anon, authenticated;

grant execute on function grigliata_usa_ticket(text) to service_role;
grant execute on function grigliata_admin_crea(text, timestamptz, date, text, text, jsonb, text) to service_role;
grant execute on function grigliata_admin_modifica(bigint, text, timestamptz, date, jsonb) to service_role;
