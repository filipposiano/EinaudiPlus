-- Account amministrativi.
--
-- File consolidato dalle migrazioni 008 (impianto) e 011 (cambio password al
-- primo accesso). Le migrazioni restano la storia del perche'.
--
-- Gli account NON stanno piu' nelle variabili d'ambiente di Vercel: il
-- sistemista li crea, disattiva e reimposta dal pannello. La verifica della
-- password resta in Node (scrypt + timingSafeEqual): qui l'hash entra ed esce,
-- ma solo verso service_role, mai verso il browser.

create table if not exists admin_account (
  id             bigserial primary key,
  username       text not null unique check (username ~ '^[a-zA-Z0-9._-]{3,24}$'),
  password_hash  text not null,
  ruolo          text not null check (ruolo in ('fdo', 'staff', 'sistemista')),
  -- Disattivare invece di cancellare, come le regole ricorrenti: l'account
  -- sparisce dal login ma il nome resta leggibile nell'audit log di chi ha
  -- fatto cosa in passato. L'eliminazione vera resta disponibile ma è un
  -- passo in più, non quello di default.
  attivo         boolean not null default true,
  creato_da      text,
  created_at     timestamptz not null default now(),
  password_at    timestamptz not null default now(),
  -- Consolidata dalla migrazione 011: un account creato o reimpostato
  -- dal sistemista deve scegliere una password sua al primo accesso.
  deve_cambiare_password boolean not null default true
);

create or replace function account_by_username(p_username text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', id, 'username', username, 'password_hash', password_hash,
    'ruolo', ruolo, 'attivo', attivo, 'deve_cambiare_password', deve_cambiare_password
  )
  from admin_account
  where username = p_username
  limit 1;
$$;

create or replace function account_list()
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'username', username, 'ruolo', ruolo, 'attivo', attivo,
    'created_at', created_at, 'password_at', password_at,
    'deve_cambiare_password', deve_cambiare_password
  ) order by created_at), '[]'::jsonb))
  from admin_account;
$$;

create or replace function account_create(
  p_username text, p_password_hash text, p_ruolo text, p_attore text default null
) returns jsonb language plpgsql as $$
declare
  v_id bigint;
begin
  if p_ruolo not in ('fdo', 'staff', 'sistemista') then
    return jsonb_build_object('ok', false, 'error', 'ruolo non valido');
  end if;

  insert into admin_account (username, password_hash, ruolo, creato_da)
  values (p_username, p_password_hash, p_ruolo, p_attore)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'nome utente gia'' in uso');
  when check_violation then
    return jsonb_build_object('ok', false, 'error', 'nome utente non valido (3-24 caratteri, lettere/numeri/._-)');
end;
$$;

create or replace function account_set_password(p_id bigint, p_password_hash text)
returns jsonb language plpgsql as $$
begin
  update admin_account
  set password_hash = p_password_hash, password_at = now(), deve_cambiare_password = true
  where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account non trovato');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function account_set_own_password(p_username text, p_password_hash text)
returns jsonb language plpgsql as $$
begin
  update admin_account
  set password_hash = p_password_hash, password_at = now(), deve_cambiare_password = false
  where username = p_username;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account non trovato');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function account_set_active(p_id bigint, p_attivo boolean)
returns jsonb language plpgsql as $$
begin
  update admin_account set attivo = p_attivo where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account non trovato');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function account_delete(p_id bigint)
returns jsonb language plpgsql as $$
begin
  delete from admin_account where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Permessi: come tutto il resto, eseguibili solo dal ruolo che usa /api.
revoke all on function account_by_username(text) from public, anon, authenticated;
revoke all on function account_list() from public, anon, authenticated;
revoke all on function account_create(text, text, text, text) from public, anon, authenticated;
revoke all on function account_set_password(bigint, text) from public, anon, authenticated;
revoke all on function account_set_own_password(text, text) from public, anon, authenticated;
revoke all on function account_set_active(bigint, boolean) from public, anon, authenticated;
revoke all on function account_delete(bigint) from public, anon, authenticated;

grant execute on function account_by_username(text) to service_role;
grant execute on function account_list() to service_role;
grant execute on function account_create(text, text, text, text) to service_role;
grant execute on function account_set_password(bigint, text) to service_role;
grant execute on function account_set_own_password(text, text) to service_role;
grant execute on function account_set_active(bigint, boolean) to service_role;
grant execute on function account_delete(bigint) to service_role;

alter table admin_account enable row level security;
