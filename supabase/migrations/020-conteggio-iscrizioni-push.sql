-- Il sistemista poteva vedere le iscrizioni push solo interrogando il
-- database a mano — la query di verifica lasciata in commento nella 017.
-- Questa la trasforma in una RPC, cosi' il pannello mostra quante camere
-- hanno le notifiche attive e quante ne ha ciascuna, senza uscire dall'app.
--
-- Sola lettura: nessuna tabella nuova, nessuna modifica a upsert_push_sub.
create or replace function sysadmin_push_subs()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'camere_totali', (select count(distinct room) from push_sub),
    'dispositivi_totali', (select count(*) from push_sub),
    'camere', coalesce(
      jsonb_agg(x order by (x->>'dispositivi')::int desc, x->>'room') filter (where x is not null),
      '[]'::jsonb
    )
  )
  from (
    select jsonb_build_object(
      'laundry', l.name,
      'room', s.room,
      'dispositivi', count(*),
      'ultimo_avvio', max(s.last_seen)
    ) as x
    from push_sub s
    join laundry l on l.id = s.laundry_id
    group by l.name, s.room
  ) t;
$$;

revoke all on function sysadmin_push_subs() from public, anon, authenticated;
grant execute on function sysadmin_push_subs() to service_role;
