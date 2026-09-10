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
-- Sezione bici.
--
-- Un residente può dichiarare, dalle sue Impostazioni, se ha una bici in
-- camera. Non è una prenotazione né una quota: è una semplice dichiarazione,
-- una riga per camera. La riga stessa È la dichiarazione — "ho una bici" è
-- "la mia camera compare in questa tabella", non un booleano da leggere.
-- Toglierla vuol dire cancellare la riga, non scrivere false.
--
-- Il pannello di portineria (FDO) e quello del sistemista vedono quante sono
-- e quali camere le hanno dichiarate — la stessa domanda che oggi si segna a
-- mano su un foglio all'ingresso. Solo il sistemista può cancellarle tutte,
-- per il reset che si fa una volta l'anno quando le camere cambiano
-- occupante.

create table if not exists bike (
  room       text primary key check (room ~ '^[0-9]{1,4}(-?[abAB])?$'),
  created_at timestamptz not null default now(),
  -- Chi ha creato la dichiarazione: il residente stesso (default) o il
  -- sistemista dal pannello, per conto della reception. Serve a due cose:
  -- ricordare alla reception di averla gia' assegnata lei, e decidere se
  -- avvisare il residente (solo quando la mette la reception — se se la
  -- dichiara da solo lo sa gia').
  creato_da  text not null default 'residente' check (creato_da in ('residente', 'sistemista'))
);

alter table bike enable row level security;

-- ─── Residenti ────────────────────────────────────────────────────────────

-- Idempotente in entrambe le direzioni: dichiararla due volte non duplica
-- niente (la chiave è la camera), toglierla quando già non c'è non fallisce.
-- creato_da prende il default 'residente': questa e' l'unica funzione che il
-- residente puo' chiamare su se stesso.
create or replace function bike_set(p_room text, p_has_bike boolean)
returns jsonb language plpgsql as $$
begin
  if p_has_bike then
    insert into bike (room) values (p_room)
    on conflict (room) do nothing;
  else
    delete from bike where room = p_room;
  end if;
  return jsonb_build_object('ok', true, 'has_bike', p_has_bike);
end;
$$;

-- Letta dalla sezione Bici all'apertura, per mostrare l'interruttore nello
-- stato giusto invece di partire sempre da "no". Porta anche `creato_da`:
-- una camera assegnata dalla reception (migrazione 029) deve poter leggere
-- che non e' stata lei a dichiararla, non solo che "ha" una bici.
create or replace function bike_get(p_room text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'has_bike', exists(select 1 from bike where room = p_room),
    'creato_da', (select creato_da from bike where room = p_room)
  );
$$;

-- ─── Portineria e sistemista ────────────────────────────────────────────────

-- Ogni camera porta anche `creato_da`: il pannello lo usa per segnare quali
-- bici le ha assegnate la reception stessa, invece di mostrare un elenco
-- indistinguibile da quello autodichiarato.
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

-- Assegna una bici a una camera dal pannello — l'altra faccia di
-- bike_delete_room, riservata allo stesso ruolo. A differenza di bike_set,
-- marca la riga come creato_da='sistemista' e dice al chiamante se ha
-- davvero inserito qualcosa di nuovo (`inserted`): su una camera che
-- l'aveva gia' (dichiarata da lei o gia' assegnata prima) non cambia niente,
-- e il chiamante lo usa per decidere se vale la pena avvisare il residente.
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

-- Riservata al sistemista (il controllo vero sta in /api/admin/data, come per
-- sysadmin_purge). Non è dentro sysadmin_purge stessa: quella pulisce ciò che
-- si accumula durante l'anno scolastico e si resetta a inizio d'anno insieme
-- a tutto il resto; le bici si dichiarano una volta e restano valide finché
-- non cambia l'occupante della camera — un ciclo suo, non quello delle
-- prenotazioni.
create or replace function bike_purge()
returns jsonb language plpgsql as $$
declare v_n int;
begin
  delete from bike where room is not null;   -- vedi sysadmin_purge sul perché di "where room is not null"
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'cancellate', v_n);
end;
$$;

-- Come sysadmin_delete_push_sub / sysadmin_delete_telegram_sub: la
-- cancellazione di UNA riga sola, per quando il caso non è il reset annuale
-- ma una singola camera da correggere (chi se n'è andato a metà anno, un
-- tocco sbagliato).
create or replace function bike_delete_room(p_room text)
returns jsonb language plpgsql as $$
declare v_n int;
begin
  delete from bike where room = p_room;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n > 0);
end;
$$;

-- A chi avvisare quando la reception assegna una bici: stessa forma di
-- sysadmin_all_push_subs / sysadmin_all_telegram_subs, ma per una camera
-- sola invece che per tutte — non e' un broadcast, e' un avviso mirato.
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

revoke all on function bike_set(text, boolean) from public, anon, authenticated;
revoke all on function bike_get(text) from public, anon, authenticated;
revoke all on function bike_admin_list() from public, anon, authenticated;
revoke all on function bike_admin_set(text) from public, anon, authenticated;
revoke all on function bike_purge() from public, anon, authenticated;
revoke all on function bike_delete_room(text) from public, anon, authenticated;
revoke all on function bike_notify_targets(text) from public, anon, authenticated;

grant execute on function bike_set(text, boolean) to service_role;
grant execute on function bike_get(text) to service_role;
grant execute on function bike_admin_list() to service_role;
grant execute on function bike_admin_set(text) to service_role;
grant execute on function bike_purge() to service_role;
grant execute on function bike_delete_room(text) to service_role;
grant execute on function bike_notify_targets(text) to service_role;
