-- Nuovo ruolo amministrativo: 'delegato', per il modulo Grigliata
-- (migrations/038). Consolidato in supabase/account.sql; qui la versione da
-- applicare a un database già in produzione.
--
-- Non è un quarto livello generico di fiducia operativa come fdo/staff/
-- sistemista: è stretto a un'unica funzione (organizzare una grigliata) —
-- vedi src/modules/identity/domain/roles.js e la policy di ogni altro
-- modulo, che ora esclude esplicitamente il delegato dalle proprie azioni
-- (prima di questa migrazione un `return true` finale lo avrebbe concesso
-- per default, essendo un ruolo che quei moduli non conoscevano ancora).
--
-- Il vincolo sul ruolo non ha un nome esplicito nella create table
-- originale: Postgres gli dà il nome di default <tabella>_<colonna>_check,
-- che è quello che si toglie qui per rimetterlo con l'elenco aggiornato.

alter table admin_account drop constraint if exists admin_account_ruolo_check;
alter table admin_account add constraint admin_account_ruolo_check
  check (ruolo in ('fdo', 'staff', 'sistemista', 'delegato'));

create or replace function account_create(
  p_username text, p_password_hash text, p_ruolo text, p_attore text default null
) returns jsonb language plpgsql as $$
declare
  v_id bigint;
begin
  if p_ruolo not in ('fdo', 'staff', 'sistemista', 'delegato') then
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
