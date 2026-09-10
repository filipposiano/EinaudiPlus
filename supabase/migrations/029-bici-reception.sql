-- Bici assegnate dalla reception: da segnare, non solo da fare.
--
-- biciAddRoom (migrazione precedente, non ancora consolidata in un file suo)
-- riusava bike_set() cosi' com'era: la riga finiva in `bike` senza dire chi
-- l'avesse messa, indistinguibile da una dichiarata dal residente stesso.
-- Due conseguenze mancavano:
--
--  1. Alla reception non restava traccia di AVERLA segnata lei — la prossima
--     persona di turno vedeva solo "camera 214: bici", non "gliel'ho segnata
--     io ieri", ed era facile ri-chiederla al residente o ri-assegnarla.
--  2. Al residente non arrivava nessun avviso: scopriva di avere una bici
--     registrata solo aprendo l'app per caso.

-- ─── Chi l'ha dichiarata ─────────────────────────────────────────────────────

alter table bike add column if not exists creato_da text not null default 'residente'
  check (creato_da in ('residente', 'sistemista'));

-- bike_set() (il residente, dalle sue Impostazioni) non cambia: l'insert
-- senza specificare creato_da prende gia' il default 'residente'.

-- Assegnazione dal pannello: sostituisce l'uso diretto di bike_set() in
-- biciAddRoom. Stessa idempotenza (on conflict do nothing, una dichiarazione
-- gia' presente — di chiunque — non si tocca: la reception non deve poter
-- "rubare" l'attribuzione a una che il residente aveva gia' fatto da solo),
-- ma restituisce anche `inserted`: il chiamante lo usa per decidere se
-- avvisare il residente — un secondo click su una camera che l'aveva gia'
-- non deve reinviargli una notifica.
create or replace function bike_admin_set(p_room text)
returns jsonb language plpgsql as $$
declare v_n int;
begin
  insert into bike (room, creato_da) values (p_room, 'sistemista')
  on conflict (room) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'inserted', v_n > 0);
end;
$$;

-- L'elenco per il pannello ora porta anche la provenienza: prima erano
-- stringhe nude ("214"), adesso oggetti {room, creato_da} — il client li usa
-- per mostrare un segno su chi ha assegnato la reception invece che aspettare
-- che lo faccia il residente.
create or replace function bike_admin_list()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'totale', (select count(*) from bike),
    'camere', coalesce((
      select jsonb_agg(jsonb_build_object('room', room, 'creato_da', creato_da) order by room)
      from bike
    ), '[]'::jsonb)
  );
$$;

-- ─── A chi avvisare ──────────────────────────────────────────────────────────
--
-- Stessa forma di sysadmin_all_push_subs / sysadmin_all_telegram_subs (dalle
-- migrazioni 026 e 027), ma filtrate per una camera sola invece che per
-- tutte: qui non e' un broadcast, e' un avviso mirato a chi la reception ha
-- appena segnato. Un'unica funzione per i due canali invece di due, perche'
-- il chiamante li usa sempre insieme (prova prima push, poi Telegram, per la
-- stessa camera).
create or replace function bike_notify_targets(p_room text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'push', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
      from push_sub where room = p_room
    ), '[]'::jsonb),
    'telegram', coalesce((
      select jsonb_agg(jsonb_build_object('chat_id', chat_id))
      from telegram_sub where room = p_room and verified_at is not null
    ), '[]'::jsonb)
  );
$$;

revoke all on function bike_admin_set(text) from public, anon, authenticated;
revoke all on function bike_notify_targets(text) from public, anon, authenticated;

grant execute on function bike_admin_set(text) to service_role;
grant execute on function bike_notify_targets(text) to service_role;
