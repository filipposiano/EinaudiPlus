-- v1.5: due aggiunte alla Grigliata, DOPO che le migrazioni 048
-- (pagamenti attivabili) e 049 (quota a persona) sono già applicate.
--
-- 1. `giorno_evento`: finora l'unica data sull'evento era `scadenza` (quando
--    chiudono le adesioni/i pagamenti) — non il giorno in cui si mangia
--    davvero, che può cadere dopo.
--
-- 2. Ticket a uso unico, COMPOSTI: ogni menu si scompone in una o più voci
--    (es. menu "Carne" = ticket "Salsiccia" + "Patatine" + "Bibita"), decise
--    dal delegato insieme al menu stesso. Un'adesione riceve, alla conferma
--    del pagamento, UN ticket vero per OGNI voce del suo menu — uno
--    "snapshot" di quel momento: cambiare poi l'elenco ticket del menu non
--    tocca le adesioni già confermate. Si usa dal lato RESIDENTE (bottone
--    "Usa" sul proprio schermo, non una ricerca-camera lato banco e non un
--    QR): il numero progressivo si assegna SOLO nel momento in cui si preme.
--
-- Questa migrazione è anche quella che RICONCILIA un incidente di sviluppo:
-- una versione precedente e più semplice di questo stesso file (un ticket
-- piatto per adesione, senza voci-ticket, senza consapevolezza di
-- pagamenti_attivi/quota) è stata applicata per errore a produzione PRIMA
-- che 048/049 fossero scritte altrove e mergiate — vedi la cronologia nel
-- repository. I `drop function` qui sotto ripuliscono gli overload lasciati
-- da quel momento, oltre a quelli attesi da una sequenza pulita 048→049→051.
--
-- Consolidato in supabase/grigliata.sql; qui la versione da applicare a un
-- database già in produzione.

alter table grigliata_evento add column if not exists giorno_evento date;
update grigliata_evento set giorno_evento = scadenza::date where giorno_evento is null;
alter table grigliata_evento alter column giorno_evento set not null;

create table if not exists grigliata_menu_ticket (
  id        bigserial primary key,
  menu_id   bigint not null references grigliata_menu(id) on delete cascade,
  nome      text not null check (char_length(btrim(nome)) between 1 and 40),
  posizione int not null default 0
);
create unique index if not exists grigliata_menu_ticket_nome_unico on grigliata_menu_ticket (menu_id, lower(nome));

create table if not exists grigliata_ticket (
  id             bigserial primary key,
  adesione_id    bigint not null references grigliata_adesione(id) on delete cascade,
  menu_ticket_id bigint not null references grigliata_menu_ticket(id),
  usato          boolean not null default false,
  numero         int,
  usato_at       timestamptz,
  unique (adesione_id, menu_ticket_id)
);

alter table grigliata_menu_ticket enable row level security;
alter table grigliata_ticket enable row level security;

-- Un ticket piatto (uno per adesione, niente voci) può essere sopravvissuto
-- all'incidente descritto sopra: non è mai stato un modello rilasciato
-- davvero, si toglie senza migrare dati.
alter table grigliata_adesione drop column if exists ticket_usato;
alter table grigliata_adesione drop column if exists ticket_numero;
alter table grigliata_adesione drop column if exists ticket_usato_at;

-- Le funzioni che cambiano firma vanno tolte prima di ricrearle (CREATE OR
-- REPLACE richiede la stessa identica lista di parametri). Elencate sia le
-- firme attese da una sequenza pulita 048→049, sia quelle lasciate
-- dall'incidente (il `if exists` rende innocuo ogni drop che non trova nulla).
drop function if exists grigliata_admin_crea(text, timestamptz, text, text, jsonb, text, boolean, numeric);
drop function if exists grigliata_admin_crea(text, timestamptz, date, text, text, jsonb, text);
drop function if exists grigliata_admin_modifica(bigint, text, timestamptz, jsonb);
drop function if exists grigliata_usa_ticket(text);

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

-- L'elenco dei menu è valido? Come prima, PIÙ: ogni menu porta anche le sue
-- voci-ticket, validate da grigliata_ticket_errore — un menu senza una lista
-- ticket valida è un menu non valido, stessa severità di un nome mancante.
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
-- e admin_overview restituiscono entrambi.
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

create or replace function grigliata_admin_crea(
  p_titolo text, p_scadenza timestamptz, p_giorno_evento date, p_paypal text, p_satispay text, p_menu jsonb, p_attore text,
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

  if exists (
    select 1 from jsonb_array_elements(p_menu) e
    where e.value->>'id' is not null
      and not exists (select 1 from grigliata_menu m where m.id = (e.value->>'id')::bigint and m.evento_id = p_evento_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'menu non valido');
  end if;

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

  update grigliata_menu set nome = '#' || id where evento_id = p_evento_id;

  update grigliata_menu m
    set nome = btrim(e.value->>'nome'), posizione = e.ordinality - 1
  from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality)
  where e.value->>'id' is not null and m.id = (e.value->>'id')::bigint;

  insert into grigliata_menu (evento_id, nome, posizione)
  select p_evento_id, btrim(e.value->>'nome'), e.ordinality - 1
  from jsonb_array_elements(p_menu) with ordinality as e(value, ordinality)
  where e.value->>'id' is null;

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

revoke all on function grigliata_ticket_errore(jsonb) from public, anon, authenticated;
revoke all on function grigliata_usa_ticket(text, bigint) from public, anon, authenticated;
revoke all on function grigliata_admin_crea(text, timestamptz, date, text, text, jsonb, text, boolean, numeric) from public, anon, authenticated;
revoke all on function grigliata_admin_modifica(bigint, text, timestamptz, date, jsonb) from public, anon, authenticated;

grant execute on function grigliata_ticket_errore(jsonb) to service_role;
grant execute on function grigliata_usa_ticket(text, bigint) to service_role;
grant execute on function grigliata_admin_crea(text, timestamptz, date, text, text, jsonb, text, boolean, numeric) to service_role;
grant execute on function grigliata_admin_modifica(bigint, text, timestamptz, date, jsonb) to service_role;
