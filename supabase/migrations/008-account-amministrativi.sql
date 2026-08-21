-- Account amministrativi gestiti dal pannello, non da Vercel.
--
-- Finora fdo, staff e sistemista erano tre righe fisse nelle variabili
-- d'ambiente (FDO_USER/PASSWORD_HASH, STAFF_..., SYSADMIN_...): un account per
-- ruolo, e per cambiare una password o aggiungerne uno nuovo bisognava
-- rigenerare l'hash con scripts/hash-password.cjs e chiedere a chi ha accesso
-- a Vercel di aggiornare la variabile e rifare il deploy. Lento, e un collo di
-- bottiglia su una sola persona.
--
-- Da qui in poi il sistemista crea, disattiva e reimposta gli account dal
-- pannello (scheda "Account"), senza toccare Vercel: gli account vivono in
-- questa tabella.
--
-- Le tre variabili d'ambiente NON si tolgono: restano come rete di sicurezza,
-- verificate da api/_lib/auth.js dopo questa tabella. Se il database non
-- risponde, o se questa tabella e' ancora vuota appena dopo la migrazione,
-- si continua a entrare con l'account storico invece di restare tutti fuori.
-- Nota per chi migra un account gia' esistente (es. "fdo"): finche' la
-- variabile d'ambiente resta su Vercel, la VECCHIA password continua a
-- funzionare insieme alla nuova finche' non si toglie la variabile.

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
  password_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Login: un account per volta, per nome utente.
--
-- L'hash esce da questa funzione, ma solo verso service_role (mai verso il
-- browser): la verifica della password resta in Node, con scrypt e
-- timingSafeEqual, esattamente come per gli account storici.

create or replace function account_by_username(p_username text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', id, 'username', username, 'password_hash', password_hash,
    'ruolo', ruolo, 'attivo', attivo
  )
  from admin_account
  where username = p_username
  limit 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pannello: elenco (mai l'hash) e gestione.

create or replace function account_list()
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'username', username, 'ruolo', ruolo, 'attivo', attivo,
    'created_at', created_at, 'password_at', password_at
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
  update admin_account set password_hash = p_password_hash, password_at = now()
  where id = p_id;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Permessi: come tutto il resto, eseguibili solo dal ruolo che usa /api.
-- Senza queste righe le funzioni nascono con EXECUTE concesso a PUBLIC — vedi
-- la migrazione 005.

revoke all on function account_by_username(text) from public, anon, authenticated;
revoke all on function account_list() from public, anon, authenticated;
revoke all on function account_create(text, text, text, text) from public, anon, authenticated;
revoke all on function account_set_password(bigint, text) from public, anon, authenticated;
revoke all on function account_set_active(bigint, boolean) from public, anon, authenticated;
revoke all on function account_delete(bigint) from public, anon, authenticated;

grant execute on function account_by_username(text) to service_role;
grant execute on function account_list() to service_role;
grant execute on function account_create(text, text, text, text) to service_role;
grant execute on function account_set_password(bigint, text) to service_role;
grant execute on function account_set_active(bigint, boolean) to service_role;
grant execute on function account_delete(bigint) to service_role;

alter table admin_account enable row level security;
