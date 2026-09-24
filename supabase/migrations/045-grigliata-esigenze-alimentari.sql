-- v1.3: esigenze alimentari nella grigliata. Il menu passa da due scelte a
-- tre (mangio tutto / vegetariano / vegano — 'classico' resta il valore di
-- "mangio tutto", già salvato nelle adesioni esistenti), più "senza glutine"
-- (indipendente dal menu) e una nota libera per allergie/intolleranze.
-- Consolidato in supabase/grigliata.sql; qui la versione da applicare a un
-- database già in produzione (dopo la 040).

-- Il vincolo sul menu non ha un nome esplicito nella create table
-- originale (038): Postgres gli ha dato quello di default.
alter table grigliata_adesione drop constraint if exists grigliata_adesione_menu_check;
alter table grigliata_adesione add constraint grigliata_adesione_menu_check
  check (menu in ('classico', 'vegetariano', 'vegano'));

alter table grigliata_adesione add column if not exists senza_glutine boolean not null default false;
alter table grigliata_adesione add column if not exists note text;
alter table grigliata_adesione drop constraint if exists grigliata_adesione_note_check;
alter table grigliata_adesione add constraint grigliata_adesione_note_check
  check (note is null or char_length(note) <= 300);

-- grigliata_iscrivi(text, text) guadagna due parametri: firma diversa,
-- quindi va tolta prima di ricrearla (CREATE OR REPLACE richiede la stessa
-- identica lista di parametri — stesso principio della 039 e della 040).
drop function if exists grigliata_iscrivi(text, text);

create or replace function grigliata_iscrivi(p_room text, p_menu text, p_senza_glutine boolean, p_note text)
returns jsonb language plpgsql as $$
declare
  v_evento_id bigint;
  v_menu text;
  v_note text;
begin
  select id into v_evento_id from grigliata_evento
    where not chiuso and now() < scadenza
    order by created_at desc limit 1;

  if v_evento_id is null then
    return jsonb_build_object('ok', false, 'error', 'nessuna grigliata attiva');
  end if;

  v_menu := nullif(btrim(coalesce(p_menu, '')), '');
  if v_menu is null or v_menu not in ('classico', 'vegetariano', 'vegano') then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('ok', false, 'error', 'nota troppo lunga (massimo 300 caratteri)');
  end if;

  insert into grigliata_adesione (evento_id, room, menu, senza_glutine, note, updated_at)
  values (v_evento_id, p_room, v_menu, coalesce(p_senza_glutine, false), v_note, now())
  on conflict (evento_id, room) do update
    set menu = excluded.menu,
        senza_glutine = excluded.senza_glutine,
        note = excluded.note,
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
      'senza_glutine', v_adesione.senza_glutine,
      'note', v_adesione.note,
      'pagamento_dichiarato', v_adesione.pagamento_dichiarato,
      'pagamento_confermato', v_adesione.pagamento_confermato
    ) end
  );
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
        'senza_glutine', a.senza_glutine, 'note', a.note,
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
  if p_menu is null or p_menu not in ('classico', 'vegetariano', 'vegano') then
    return jsonb_build_object('ok', false, 'error', 'scegli un menu');
  end if;

  insert into grigliata_adesione (evento_id, room, menu, updated_at)
  values (p_evento_id, btrim(p_room), p_menu, now())
  on conflict (evento_id, room) do update
    set menu = excluded.menu, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function grigliata_iscrivi(text, text, boolean, text) from public, anon, authenticated;
grant execute on function grigliata_iscrivi(text, text, boolean, text) to service_role;
