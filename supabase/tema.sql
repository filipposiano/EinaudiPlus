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
-- Tema stagionale decorativo (Halloween, Natale con la neve, ecc.),
-- attivabile e disattivabile dal pannello sistemista in qualsiasi momento.
--
-- Non e' una preferenza per residente come tema.ts lato client (chiaro/scuro,
-- salvato in localStorage): e' UNA sola scelta per tutta l'app, quindi vive
-- nel database e non nel browser. Riga singola: il "check (id)" sull'unica
-- chiave possibile impedisce che ne nasca mai una seconda.

create table if not exists app_theme (
  id         boolean primary key default true check (id),
  tema       text not null default 'nessuno' check (tema in ('nessuno', 'halloween', 'natale')),
  updated_at timestamptz not null default now()
);

insert into app_theme (id) values (true) on conflict (id) do nothing;

alter table app_theme enable row level security;

-- Letto a ogni caricamento dell'app dentro laundry_snapshot (functions.sql):
-- un tema acceso dal sistemista compare al prossimo avvio/ricarica, senza
-- bisogno di un canale di aggiornamento dedicato — la stessa logica del
-- refresh automatico che l'app gia' fa dopo 5 minuti in background.
create or replace function app_theme_get()
returns text language sql stable as $$
  select tema from app_theme where id = true;
$$;

create or replace function sysadmin_set_theme(p_tema text)
returns jsonb language plpgsql as $$
begin
  if p_tema not in ('nessuno', 'halloween', 'natale') then
    return jsonb_build_object('ok', false, 'error', 'tema non valido');
  end if;
  update app_theme set tema = p_tema, updated_at = now() where id = true;
  return jsonb_build_object('ok', true, 'tema', p_tema);
end;
$$;

revoke all on function app_theme_get() from public, anon, authenticated;
grant execute on function app_theme_get() to service_role;

revoke all on function sysadmin_set_theme(text) from public, anon, authenticated;
grant execute on function sysadmin_set_theme(text) to service_role;
