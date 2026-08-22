-- Cambio password obbligato al primo accesso.
--
-- Finora chi creava un account (o gli reimpostava la password) doveva anche
-- comunicare la password nuova alla persona giusta fuori dall'app, e quella
-- persona restava con la password scelta dal sistemista finché non se la
-- cambiava da sola a mano — cosa che nessuno fa mai spontaneamente. Ora un
-- account appena creato, o con la password appena reimpostata, DEVE
-- cambiarla al primo accesso: la sceglie il titolare, il sistemista smette
-- di conoscerla.

alter table admin_account add column if not exists deve_cambiare_password boolean not null default true;

-- Gli account già in uso prima di questa colonna non devono cambiare nulla a
-- sorpresa al prossimo accesso: solo le creazioni e le reimpostazioni da qui
-- in avanti lo richiedono.
update admin_account set deve_cambiare_password = false;

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

-- Una password reimpostata dal sistemista e' per definizione scelta da
-- qualcun altro: va cambiata al primo accesso, come alla creazione.
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

-- Cambio password fatto dal titolare dell'account. Si individua per
-- username (quello della sessione), non per id passato dal client: cosi'
-- nessuno puo' cambiare la password di un account che non e' il proprio
-- chiamando questa funzione con un id diverso — a differenza di
-- account_set_password, riservata al sistemista, questa la puo' chiamare
-- qualunque admin autenticato per sé stesso.
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

revoke all on function account_by_username(text) from public, anon, authenticated;
revoke all on function account_list() from public, anon, authenticated;
revoke all on function account_set_password(bigint, text) from public, anon, authenticated;
revoke all on function account_set_own_password(text, text) from public, anon, authenticated;

grant execute on function account_by_username(text) to service_role;
grant execute on function account_list() to service_role;
grant execute on function account_set_password(bigint, text) to service_role;
grant execute on function account_set_own_password(text, text) to service_role;
