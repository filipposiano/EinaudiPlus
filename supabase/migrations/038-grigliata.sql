-- Grigliata: il delegato fa partire un evento, i residenti aderiscono e
-- dichiarano il pagamento, il delegato lo conferma. Consolidato in
-- supabase/grigliata.sql; qui la versione da applicare a un database già in
-- produzione (dopo migrations/037, che introduce il ruolo 'delegato').
--
-- Percorso pubblico per i residenti (camera autodichiarata, stesso modello
-- di fiducia di tutto il resto dell'app) e amministrativo per creare/
-- chiudere l'evento e confermare i pagamenti — riservato a delegato e
-- sistemista (src/modules/grigliata/domain/policy.js), non a FDO/staff.
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
  chiuso        boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists grigliata_adesione (
  id                   bigserial primary key,
  evento_id            bigint not null references grigliata_evento(id) on delete cascade,
  room                 text not null,
  partecipa            boolean not null,
  menu                 text check (menu in ('classico', 'vegano')),
  pagamento_dichiarato boolean not null default false,
  pagamento_confermato boolean not null default false,
  confermato_da        text,
  confermato_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (evento_id, room)
);

alter table grigliata_evento enable row level security;
alter table grigliata_adesione enable row level security;

create or replace function grigliata_attiva_bool()
returns boolean language sql stable as $$
  select exists (select 1 from grigliata_evento where not chiuso and now() < scadenza);
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
      'paypal_link', v_evento.paypal_link,
      'satispay_link', v_evento.satispay_link
    ),
    'mia_adesione', case when v_adesione.id is null then null else jsonb_build_object(
      'partecipa', v_adesione.partecipa,
      'menu', v_adesione.menu,
      'pagamento_dichiarato', v_adesione.pagamento_dichiarato,
      'pagamento_confermato', v_adesione.pagamento_confermato
    ) end
  );
end;
$$;

create or replace function grigliata_iscrivi(p_room text, p_partecipa boolean, p_menu text)
returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_menu text;
begin
  select id into v_evento_id from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  v_menu := nullif(btrim(coalesce(p_menu, '')), '');
  if p_partecipa and (v_menu is null or v_menu not in ('classico', 'vegano')) then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;
  if not p_partecipa then
    v_menu := null;
  end if;

  insert into grigliata_adesione (evento_id, room, partecipa, menu, updated_at)
  values (v_evento_id, p_room, p_partecipa, v_menu, now())
  on conflict (evento_id, room) do update
    set partecipa = excluded.partecipa,
        menu = excluded.menu,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function grigliata_dichiara_pagamento(p_room text)
returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_id bigint;
  v_partecipa boolean;
begin
  select id into v_evento_id from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  select id, partecipa into v_id, v_partecipa
    from grigliata_adesione where evento_id = v_evento_id and room = p_room;

  if v_id is null or not v_partecipa then
    return jsonb_build_object('ok', false, 'error', 'devi prima aderire');
  end if;

  update grigliata_adesione set pagamento_dichiarato = true, updated_at = now() where id = v_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Un link "paypal.me/mario", senza schema, è un URL RELATIVO per un <a href>:
-- il browser lo risolve contro la pagina corrente invece che aprire PayPal.
-- Qui si aggiunge https:// se manca.
create or replace function grigliata_normalizza_link(p_link text)
returns text language sql immutable as $$
  select case
    when p_link is null or btrim(p_link) = '' then null
    when btrim(p_link) ~* '^https?://' then btrim(p_link)
    else 'https://' || btrim(p_link)
  end;
$$;

create or replace function grigliata_admin_crea(
  p_titolo text, p_scadenza timestamptz, p_paypal text, p_satispay text, p_attore text
) returns jsonb language plpgsql as $$
declare
  v_id bigint;
  v_paypal text;
  v_satispay text;
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
  end if;

  v_paypal := grigliata_normalizza_link(p_paypal);
  v_satispay := grigliata_normalizza_link(p_satispay);

  if v_paypal is null and v_satispay is null then
    return jsonb_build_object('ok', false, 'error', 'inserisci almeno un link per il pagamento (PayPal o Satispay)');
  end if;

  update grigliata_evento set chiuso = true where not chiuso;

  insert into grigliata_evento (titolo, creato_da, scadenza, paypal_link, satispay_link)
  values (
    coalesce(nullif(btrim(coalesce(p_titolo, '')), ''), 'Grigliata'),
    p_attore, p_scadenza, v_paypal, v_satispay
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Cambia SOLO la scadenza di un evento esistente — non tocca chiuso.
create or replace function grigliata_admin_modifica_scadenza(p_evento_id bigint, p_scadenza timestamptz)
returns jsonb language plpgsql as $$
begin
  if p_scadenza is null or p_scadenza <= now() then
    return jsonb_build_object('ok', false, 'error', 'la scadenza deve essere nel futuro');
  end if;

  update grigliata_evento set scadenza = p_scadenza where id = p_evento_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;

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
      'paypal_link', v_evento.paypal_link, 'satispay_link', v_evento.satispay_link,
      'chiuso', v_evento.chiuso, 'attiva', (not v_evento.chiuso and now() < v_evento.scadenza)
    ),
    'adesioni', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'room', a.room, 'partecipa', a.partecipa, 'menu', a.menu,
        'pagamento_dichiarato', a.pagamento_dichiarato, 'pagamento_confermato', a.pagamento_confermato,
        'confermato_da', a.confermato_da, 'confermato_at', a.confermato_at
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

-- Aggiunge il booleano alla foto che l'app legge a ogni avvio (stessa
-- funzione toccata dalle migrations/035 e 036 per tema e cambio biancheria).
create or replace function laundry_snapshot(p_room text default null)
returns jsonb language plpgsql stable as $$
declare
  v_id smallint;
  v_l  laundry%rowtype;
begin
  v_id := coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));
  select * into v_l from laundry where id = v_id;

  return jsonb_build_object(
    'ok',     true,
    'week',   week_snapshot_mixed(v_id),
    'status', status_snapshot(v_id),
    'slots',  v_l.n_slots,
    'tema',   app_theme_get(),
    'cambio_biancheria', linen_change_current(),
    'grigliata_attiva', grigliata_attiva_bool()
  );
end;
$$;

revoke all on function grigliata_attiva_bool() from public, anon, authenticated;
revoke all on function grigliata_stato_pubblico(text) from public, anon, authenticated;
revoke all on function grigliata_iscrivi(text, boolean, text) from public, anon, authenticated;
revoke all on function grigliata_dichiara_pagamento(text) from public, anon, authenticated;
revoke all on function grigliata_normalizza_link(text) from public, anon, authenticated;
revoke all on function grigliata_admin_crea(text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function grigliata_admin_modifica_scadenza(bigint, timestamptz) from public, anon, authenticated;
revoke all on function grigliata_admin_overview() from public, anon, authenticated;
revoke all on function grigliata_admin_conferma_pagamento(bigint, text) from public, anon, authenticated;
revoke all on function grigliata_admin_chiudi(bigint) from public, anon, authenticated;

grant execute on function grigliata_attiva_bool() to service_role;
grant execute on function grigliata_stato_pubblico(text) to service_role;
grant execute on function grigliata_iscrivi(text, boolean, text) to service_role;
grant execute on function grigliata_dichiara_pagamento(text) to service_role;
grant execute on function grigliata_normalizza_link(text) to service_role;
grant execute on function grigliata_admin_crea(text, timestamptz, text, text, text) to service_role;
grant execute on function grigliata_admin_modifica_scadenza(bigint, timestamptz) to service_role;
grant execute on function grigliata_admin_overview() to service_role;
grant execute on function grigliata_admin_conferma_pagamento(bigint, text) to service_role;
grant execute on function grigliata_admin_chiudi(bigint) to service_role;
