-- Il pannello mostrava le iscrizioni push aggregate per camera (solo un
-- conteggio), tutte insieme senza distinguere dal canale Telegram, e senza
-- modo di toglierne una sola. Tre cose da sistemare:
--
--  1. sysadmin_push_subs() torna ora una riga per DISPOSITIVO (con l'id),
--     non piu' un conteggio per camera: serve l'id per poterla cancellare.
--  2. sysadmin_telegram_subs() e' la stessa cosa per le chat Telegram
--     collegate (solo quelle verificate: un codice generato e mai usato non
--     e' un'iscrizione).
--  3. sysadmin_delete_push_sub / sysadmin_delete_telegram_sub tolgono una
--     riga sola, dato il suo id.

create or replace function sysadmin_push_subs()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'camere_totali', (select count(distinct room) from push_sub),
    'dispositivi_totali', (select count(*) from push_sub),
    'iscrizioni', coalesce(
      jsonb_agg(x order by x->>'room', x->>'ultimo_avvio' desc) filter (where x is not null),
      '[]'::jsonb
    )
  )
  from (
    select jsonb_build_object(
      'id', s.id,
      'laundry', l.name,
      'room', s.room,
      'creato_il', s.created_at,
      'ultimo_avvio', s.last_seen
    ) as x
    from push_sub s
    join laundry l on l.id = s.laundry_id
  ) t;
$$;

create or replace function sysadmin_delete_push_sub(p_id bigint)
returns jsonb language plpgsql as $$
begin
  delete from push_sub where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function sysadmin_telegram_subs()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'camere_totali', (select count(distinct room) from telegram_sub where verified_at is not null),
    'chat_totali', (select count(*) from telegram_sub where verified_at is not null),
    'iscrizioni', coalesce(
      jsonb_agg(x order by x->>'room', x->>'collegato_il' desc) filter (where x is not null),
      '[]'::jsonb
    )
  )
  from (
    select jsonb_build_object(
      'id', t.id,
      'laundry', l.name,
      'room', t.room,
      'collegato_il', t.verified_at
    ) as x
    from telegram_sub t
    join laundry l on l.id = t.laundry_id
    where t.verified_at is not null
  ) tt;
$$;

create or replace function sysadmin_delete_telegram_sub(p_id bigint)
returns jsonb language plpgsql as $$
begin
  delete from telegram_sub where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function sysadmin_delete_push_sub(bigint) from public, anon, authenticated;
grant execute on function sysadmin_delete_push_sub(bigint) to service_role;

revoke all on function sysadmin_telegram_subs() from public, anon, authenticated;
grant execute on function sysadmin_telegram_subs() to service_role;

revoke all on function sysadmin_delete_telegram_sub(bigint) from public, anon, authenticated;
grant execute on function sysadmin_delete_telegram_sub(bigint) to service_role;
