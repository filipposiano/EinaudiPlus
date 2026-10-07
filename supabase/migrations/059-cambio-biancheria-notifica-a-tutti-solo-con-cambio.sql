-- v1.9: notifica del cambio biancheria.
--
-- 1. Arriva anche a chi non ha mai salvato una preferenza: la notifica è
--    attiva di default (così la mostrano le Impostazioni), ma prima il claim
--    guardava solo le camere con una riga in linen_change_notify_pref, e chi
--    non aveva mai toccato l'impostazione non riceveva niente. Ora ogni
--    camera con push o Telegram attivo riceve la riga di default (attiva,
--    alle 8:00) prima del claim.
-- 2. Solo quando il cambio c'è ('grande' o 'piccolo'): niente più "questa
--    settimana non c'è cambio".
--
-- Nessuna firma cambia. Consolidato in supabase/cambio-biancheria.sql.

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
  if v_tipo is null or v_tipo not in ('grande', 'piccolo') then
    return jsonb_build_object('ok', true, 'tipo', v_tipo, 'righe', '[]'::jsonb);
  end if;

  insert into linen_change_notify_pref (room)
  select distinct btrim(room) from push_sub where btrim(room) <> ''
  union
  select distinct btrim(room) from telegram_sub
    where room is not null and btrim(room) <> '' and verified_at is not null
  on conflict (room) do nothing;

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
