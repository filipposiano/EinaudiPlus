-- v1.6: separazione netta fra le DUE date della grigliata, DOPO 051.
--
--   * `scadenza`      = quando si fermano le ISCRIZIONI. Ora può essere anche
--                       già passata alla creazione/modifica (prima si
--                       rifiutava: "la scadenza deve essere nel futuro").
--   * `giorno_evento` = il giorno vero della grigliata. La scheda "Grigliata"
--                       dei residenti resta VISIBILE fino al giorno DOPO
--                       (compreso, fuso Europe/Rome), invece di sparire alla
--                       scadenza delle iscrizioni.
--
-- "Visibile" e "iscrizioni aperte" sono ora due condizioni distinte:
-- grigliata_visibile() decide quale evento conta (scheda, pagamento, ticket,
-- riapri), `now() < scadenza` decide solo se ci si può ancora iscrivere o
-- cambiare scelta (grigliata_iscrivi). Il pagamento e l'uso dei ticket
-- restano possibili finché la scheda è visibile.
--
-- Nessuna firma cambia (solo corpi, più la nuova grigliata_visibile): niente
-- `drop function`. Consolidato in supabase/grigliata.sql.

-- v1.6: DUE date, due significati distinti.
--   * `scadenza`      = quando si fermano le ISCRIZIONI (adesioni). Può essere
--                       anche già passata alla creazione: il delegato può far
--                       partire una grigliata a iscrizioni già chiuse.
--   * `giorno_evento` = il giorno VERO della grigliata. La scheda resta
--                       VISIBILE ai residenti fino al giorno DOPO (compreso),
--                       perché è lì che si usano i ticket e si vede com'è andata.
-- "Visibile" (non chiusa a mano e non oltre il giorno dopo) e "iscrizioni
-- aperte" (now() < scadenza) sono quindi due condizioni separate. Il confronto
-- sul giorno è in Europe/Rome, come il resto dell'app, non in UTC del server.
create or replace function grigliata_visibile(p_chiuso boolean, p_giorno_evento date)
returns boolean language sql stable as $$
  select not p_chiuso and (now() at time zone 'Europe/Rome')::date <= p_giorno_evento + 1;
$$;

create or replace function grigliata_attiva_bool()
returns boolean language sql stable as $$
  select exists (select 1 from grigliata_evento where grigliata_visibile(chiuso, giorno_evento));
$$;

create or replace function grigliata_stato_pubblico(p_room text)
returns jsonb language plpgsql stable as $$
declare
  v_evento grigliata_evento%rowtype;
  v_adesione grigliata_adesione%rowtype;
begin
  select * into v_evento from grigliata_evento
    where grigliata_visibile(chiuso, giorno_evento)
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
      'iscrizioni_aperte', now() < v_evento.scadenza,
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

create or replace function grigliata_iscrivi(
  p_room text, p_menu_id bigint, p_dieta text, p_senza_glutine boolean, p_note text
) returns jsonb language plpgsql as $$
declare
  v_evento grigliata_evento%rowtype;
  v_evento_id bigint;
  v_dieta text;
  v_note text;
begin
  select * into v_evento from grigliata_evento
    where grigliata_visibile(chiuso, giorno_evento)
    order by created_at desc limit 1;

  if v_evento.id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;
  v_evento_id := v_evento.id;

  -- La scheda può restare visibile a iscrizioni chiuse: solo QUESTA azione
  -- (iscriversi o cambiare scelta) si ferma alla scadenza.
  if now() >= v_evento.scadenza then
    return jsonb_build_object('ok', false, 'error', 'le iscrizioni sono chiuse');
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

create or replace function grigliata_dichiara_pagamento(p_room text)
returns jsonb language plpgsql as $$
declare
  v_evento grigliata_evento%rowtype;
  v_id bigint;
begin
  select * into v_evento from grigliata_evento
    where grigliata_visibile(chiuso, giorno_evento)
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
    where grigliata_visibile(chiuso, giorno_evento)
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
  -- La scadenza delle iscrizioni può anche essere già passata (v1.6): serve
  -- solo che ci sia. La visibilità della scheda dipende dal giorno della
  -- grigliata, non da questa.
  if p_scadenza is null then
    return jsonb_build_object('ok', false, 'error', 'indica la scadenza delle iscrizioni');
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

create or replace function grigliata_admin_modifica(
  p_evento_id bigint, p_titolo text, p_scadenza timestamptz, p_giorno_evento date, p_menu jsonb
) returns jsonb language plpgsql as $$
declare
  v_errore text;
  v_nome text;
  v_quante int;
  v_voce record;
begin
  -- La scadenza delle iscrizioni può anche essere già passata (v1.6): serve
  -- solo che ci sia. La visibilità della scheda dipende dal giorno della
  -- grigliata, non da questa.
  if p_scadenza is null then
    return jsonb_build_object('ok', false, 'error', 'indica la scadenza delle iscrizioni');
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
      'chiuso', v_evento.chiuso, 'attiva', grigliata_visibile(v_evento.chiuso, v_evento.giorno_evento),
      'iscrizioni_aperte', now() < v_evento.scadenza,
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

create or replace function grigliata_admin_riapri(p_evento_id bigint)
returns jsonb language plpgsql as $$
begin
  update grigliata_evento set chiuso = true
    where id <> p_evento_id and grigliata_visibile(chiuso, giorno_evento);

  update grigliata_evento set chiuso = false where id = p_evento_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function grigliata_visibile(boolean, date) from public, anon, authenticated;
grant execute on function grigliata_visibile(boolean, date) to service_role;
