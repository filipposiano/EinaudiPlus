-- Estende il broadcast del pannello sistemista (migrations/026, solo push)
-- anche alle chat Telegram collegate. Stessa idea di sysadmin_all_push_subs:
-- qui serve il chat_id per spedire davvero, non room/laundry per mostrarlo
-- in lista come fa sysadmin_telegram_subs.
--
-- Solo le chat verificate (verified_at not null): un codice generato e mai
-- incollato al bot non e' un'iscrizione, e' un tentativo scaduto.

create or replace function sysadmin_all_telegram_subs()
returns jsonb language sql stable as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('chat_id', chat_id)),
    '[]'::jsonb
  )
  from telegram_sub
  where verified_at is not null;
$$;

revoke all on function sysadmin_all_telegram_subs() from public, anon, authenticated;
grant execute on function sysadmin_all_telegram_subs() to service_role;
