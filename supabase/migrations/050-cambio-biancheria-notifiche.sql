-- Notifica settimanale del cambio biancheria (grande/piccolo/nessuno), con
-- un interruttore on/off e un orario di invio scelti dal residente — finora
-- il cambio biancheria si vedeva solo aprendo l'app, nessun avviso partiva
-- da solo.
--
-- La preferenza è per CAMERA, autodichiarata come tutto il resto dell'app
-- (stesso modello di fiducia di bike_room in bici.sql) — il cambio
-- biancheria in sé resta globale (linen_change_anchor), qui si decide solo
-- SE e QUANDO avvisare quella camera. `enabled` di default true: non è un
-- opt-in nascosto, perché la notifica parte comunque solo se quella camera
-- ha già una subscription push o Telegram attiva (vedi notifyRoom nel
-- modulo Notifications) — chi non ha mai attivato nulla non riceve niente
-- lo stesso.
--
-- Consolidato in supabase/cambio-biancheria.sql; qui la versione da
-- applicare a un database già in produzione (dopo la 049).

create table if not exists linen_change_notify_pref (
  room                  text primary key,
  enabled               boolean not null default true,
  notify_time           time not null default '08:00:00',
  -- Dedup: una volta avvisata per un dato martedì, non si riavvisa più
  -- quella settimana anche se il tick successivo la ritrova ancora "dovuta"
  -- (vedi linen_change_claim_due_notifications).
  last_notified_tuesday date,
  updated_at            timestamptz not null default now()
);

alter table linen_change_notify_pref enable row level security;

-- Lettura pubblica della propria preferenza — un valore di default (attiva,
-- 08:00) per una camera che non ha ancora scelto nulla, stesso principio di
-- bike_get che torna "nessuna bici" invece di un errore.
create or replace function linen_change_get_notify_pref(p_room text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ok', true,
    'enabled', coalesce((select enabled from linen_change_notify_pref where room = p_room), true),
    'notify_time', coalesce((select notify_time from linen_change_notify_pref where room = p_room), '08:00:00'::time)
  );
$$;

-- Scrittura pubblica — upsert, stesso schema di upsert_push_sub/bike_set.
create or replace function linen_change_set_notify_pref(p_room text, p_enabled boolean, p_notify_time time)
returns jsonb language plpgsql as $$
begin
  if p_room is null or btrim(p_room) = '' then
    return jsonb_build_object('ok', false, 'error', 'camera mancante');
  end if;
  if p_notify_time is null then
    return jsonb_build_object('ok', false, 'error', 'orario non valido');
  end if;

  insert into linen_change_notify_pref (room, enabled, notify_time, updated_at)
  values (btrim(p_room), coalesce(p_enabled, true), p_notify_time, now())
  on conflict (room) do update
    set enabled = excluded.enabled, notify_time = excluded.notify_time, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

-- Il tick (ogni minuto, agganciato allo stesso cron dei promemoria
-- lavanderia — vedi api/cron.js): quali camere avvisare ADESSO, e le segna
-- avvisate nella stessa transazione (claim, stesso principio di
-- claim_due_reminders). Solo di martedì — negli altri giorni non c'è nulla
-- da dire. Se il cambio non è ancora stato configurato da nessun
-- amministratore (linen_change_type_for torna null) non manda nulla; se
-- invece è 'nessuno' (un martedì saltato apposta) avvisa comunque, per dire
-- che oggi non c'è cambio. `notify_time <= ora_corrente` e non `=`: tollera
-- un tick in ritardo senza perdere l'invio, `last_notified_tuesday` ferma da
-- sola i reinvii nello stesso martedì.
create or replace function linen_change_claim_due_notifications(p_tz text default 'Europe/Rome')
returns jsonb language plpgsql as $$
declare
  v_oggi date := (now() at time zone p_tz)::date;
  v_ora time := (now() at time zone p_tz)::time;
  v_tipo text;
  v_righe jsonb;
begin
  if extract(isodow from v_oggi) <> 2 then
    return jsonb_build_object('ok', true, 'tipo', null, 'righe', '[]'::jsonb);
  end if;

  v_tipo := linen_change_type_for(v_oggi);
  if v_tipo is null then
    return jsonb_build_object('ok', true, 'tipo', null, 'righe', '[]'::jsonb);
  end if;

  with dovute as (
    update linen_change_notify_pref
    set last_notified_tuesday = v_oggi
    where enabled
      and notify_time <= v_ora
      and (last_notified_tuesday is null or last_notified_tuesday <> v_oggi)
    returning room
  )
  select coalesce(jsonb_agg(room), '[]'::jsonb) into v_righe from dovute;

  return jsonb_build_object('ok', true, 'tipo', v_tipo, 'righe', v_righe);
end;
$$;

revoke all on function linen_change_get_notify_pref(text) from public, anon, authenticated;
revoke all on function linen_change_set_notify_pref(text, boolean, time) from public, anon, authenticated;
revoke all on function linen_change_claim_due_notifications(text) from public, anon, authenticated;

grant execute on function linen_change_get_notify_pref(text) to service_role;
grant execute on function linen_change_set_notify_pref(text, boolean, time) to service_role;
grant execute on function linen_change_claim_due_notifications(text) to service_role;
