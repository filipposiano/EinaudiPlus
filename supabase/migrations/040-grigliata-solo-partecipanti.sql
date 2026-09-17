-- v1.1: toglie la possibilità di rispondere "non parteciperò" a una
-- grigliata — l'app tiene il conto solo di chi manifesta un interesse
-- attivo. Un'adesione (grigliata_adesione) diventa quindi, per definizione,
-- una camera che partecipa: non serve più un booleano per dirlo, e non ha
-- senso una riga con un menu vuoto (chi non partecipa non ha un menu da
-- ricordare — prima quella riga esisteva comunque, ora non esiste affatto).
-- Consolidato in supabase/grigliata.sql; qui la versione da applicare a un
-- database già in produzione (dopo la 039).
--
-- Le righe con partecipa=false erano già invisibili ovunque nell'app (il
-- pannello del delegato le ignora dalla scorsa modifica) — qui si tolgono
-- anche dalla tabella, non solo dalla vista, così la colonna può sparire
-- senza lasciare dati orfani sotto.

delete from grigliata_adesione where not partecipa;

alter table grigliata_adesione alter column menu set not null;
alter table grigliata_adesione drop column partecipa;

-- grigliata_iscrivi(text, boolean, text) diventa grigliata_iscrivi(text,
-- text): perde p_partecipa, non solo lo ignora — la firma cambia, quindi
-- va tolta esplicitamente prima di ricrearla (CREATE OR REPLACE richiede la
-- stessa identica lista di parametri, stesso principio della 039).
drop function if exists grigliata_iscrivi(text, boolean, text);

create or replace function grigliata_iscrivi(p_room text, p_menu text)
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
  if v_menu is null or v_menu not in ('classico', 'vegano') then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;

  insert into grigliata_adesione (evento_id, room, menu, updated_at)
  values (v_evento_id, p_room, v_menu, now())
  on conflict (evento_id, room) do update
    set menu = excluded.menu,
        updated_at = now();

  return jsonb_build_object('ok', true);
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
      'paypal_link', v_evento.paypal_link,
      'satispay_link', v_evento.satispay_link
    ),
    'mia_adesione', case when v_adesione.id is null then null else jsonb_build_object(
      'menu', v_adesione.menu,
      'pagamento_dichiarato', v_adesione.pagamento_dichiarato,
      'pagamento_confermato', v_adesione.pagamento_confermato
    ) end
  );
end;
$$;

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
        'id', a.id, 'room', a.room, 'menu', a.menu,
        'pagamento_dichiarato', a.pagamento_dichiarato, 'pagamento_confermato', a.pagamento_confermato,
        'confermato_da', a.confermato_da, 'confermato_at', a.confermato_at
      ) order by a.room)
      from grigliata_adesione a where a.evento_id = v_evento.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function grigliata_admin_aggiungi_adesione(p_evento_id bigint, p_room text, p_menu text)
returns jsonb language plpgsql as $$
begin
  if not exists (select 1 from grigliata_evento where id = p_evento_id) then
    return jsonb_build_object('ok', false, 'error', 'evento non trovato');
  end if;
  if p_room is null or btrim(p_room) = '' then
    return jsonb_build_object('ok', false, 'error', 'camera mancante');
  end if;
  if p_menu is null or p_menu not in ('classico', 'vegano') then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;

  insert into grigliata_adesione (evento_id, room, menu, updated_at)
  values (p_evento_id, btrim(p_room), p_menu, now())
  on conflict (evento_id, room) do update
    set menu = excluded.menu, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function grigliata_iscrivi(text, text) from public, anon, authenticated;
grant execute on function grigliata_iscrivi(text, text) to service_role;
