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
  created_at timestamptz not null default now()
);

alter table bike enable row level security;

-- ─── Residenti ────────────────────────────────────────────────────────────

-- Idempotente in entrambe le direzioni: dichiararla due volte non duplica
-- niente (la chiave è la camera), toglierla quando già non c'è non fallisce.
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

-- Letta dalle Impostazioni all'apertura, per mostrare l'interruttore nello
-- stato giusto invece di partire sempre da "no".
create or replace function bike_get(p_room text)
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'has_bike', exists(select 1 from bike where room = p_room));
$$;

-- ─── Portineria e sistemista ────────────────────────────────────────────────

create or replace function bike_admin_list()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'totale', (select count(*) from bike),
    'camere', coalesce((select jsonb_agg(room order by room) from bike), '[]'::jsonb)
  );
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

revoke all on function bike_set(text, boolean) from public, anon, authenticated;
revoke all on function bike_get(text) from public, anon, authenticated;
revoke all on function bike_admin_list() from public, anon, authenticated;
revoke all on function bike_purge() from public, anon, authenticated;

grant execute on function bike_set(text, boolean) to service_role;
grant execute on function bike_get(text) to service_role;
grant execute on function bike_admin_list() to service_role;
grant execute on function bike_purge() to service_role;
