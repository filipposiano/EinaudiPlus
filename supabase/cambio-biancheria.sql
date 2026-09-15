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
-- Cambio biancheria del martedì mattina (grande o piccolo), impostabile da
-- FDO e sistemista — non riservato al sistemista come il tema stagionale
-- (tema.sql): è una decisione operativa di portineria, come lo stato delle
-- macchine, non una scelta estetica che cambia cosa vede ogni residente.
--
-- Si alternano da soli, settimana per settimana: un'ancora (un martedì +
-- il suo tipo) basta a calcolare ogni altro martedì, passato o futuro, per
-- parità di settimane trascorse da quel punto. Quando la sequenza va rotta
-- (es. il collegio chiude e si riparte dal grande dopo la riapertura) si
-- sposta semplicemente l'ancora al martedì di ripartenza: tutto ciò che
-- viene dopo si ricalcola da lì, senza dover toccare nient'altro.
--
-- Riga singola, stesso principio di app_theme (vedi tema.sql): non esiste
-- "il cambio biancheria di quella camera", è una decisione sola per tutto
-- il collegio. A differenza di app_theme, NESSUNA riga di default: finché
-- nessun amministratore l'ha impostata, linen_change_current() torna null e
-- la dashboard non mostra nulla, invece di indovinare un'ancora arbitraria
-- che quasi certamente sarebbe sbagliata.
--
-- Un martedì puo' anche essere saltato del tutto (nessun cambio quella
-- settimana): e' un'eccezione puntuale, in linen_change_skip, che non
-- sposta l'ancora e non disturba l'alternanza delle settimane successive.

create table if not exists linen_change_anchor (
  id           boolean primary key default true check (id),
  anchor_date  date not null,
  anchor_type  text not null check (anchor_type in ('grande', 'piccolo')),
  updated_at   timestamptz not null default now()
);

alter table linen_change_anchor enable row level security;

-- Martedì specifici in cui non c'è cambio (es. una settimana di chiusura
-- parziale), SENZA disturbare l'alternanza: un martedì saltato non consuma
-- un turno della sequenza, il martedì dopo torna al tipo che avrebbe avuto
-- comunque. Stesso principio di conference_eccezione in polivalente.sql —
-- un'eccezione puntuale su una regola che resta invariata, non una modifica
-- alla regola stessa.
create table if not exists linen_change_skip (
  skip_date date primary key
);

alter table linen_change_skip enable row level security;

-- Il martedì della settimana corrente (Europe/Rome), qualunque giorno sia
-- oggi: passato se oggi è dopo martedì, futuro se è prima, oggi stesso se
-- oggi è martedì. date_trunc('week', ...) di Postgres usa già settimane ISO
-- (lunedì-domenica, la stessa base di current_week_start in functions.sql),
-- quindi basta sommare un giorno.
create or replace function linen_change_current_tuesday(p_tz text default 'Europe/Rome')
returns date language sql stable as $$
  select (date_trunc('week', now() at time zone p_tz) + interval '1 day')::date;
$$;

-- Il tipo per un martedì qualunque, data l'ancora configurata — 'grande',
-- 'piccolo', 'nessuno' (saltato) o null (non ancora configurato: si
-- distingue da 'nessuno', che è una scelta esplicita di un amministratore,
-- non l'assenza di configurazione).
--
-- Il salto si controlla PRIMA dell'alternanza e la scavalca senza toccarla:
-- non è un terzo valore nella sequenza grande/piccolo, è un'eccezione che
-- lascia la sequenza esattamente dov'era — il martedì successivo torna al
-- tipo che avrebbe avuto comunque, come se quel salto non fosse mai esistito
-- ai fini del conteggio (stesso principio con cui conference_eccezione salta
-- un'occorrenza senza spostare le altre).
--
-- Richiede che p_tuesday sia davvero un martedì quanto lo è l'ancora stessa:
-- l'unico chiamante pubblico (linen_change_current) passa sempre
-- linen_change_current_tuesday(), e linen_change_set_anchor() rifiuta in
-- scrittura una data che non lo sia — quindi la differenza in giorni fra i
-- due è sempre un multiplo esatto di 7, e mod(settimane, 2) basta a decidere
-- la parità indipendentemente dal segno (un'ancora nel futuro rispetto a
-- p_tuesday è un caso legittimo: un sistemista può anticipare la
-- ripartenza prima che arrivi).
create or replace function linen_change_type_for(p_tuesday date)
returns text language plpgsql stable as $$
declare
  v_ancora_data date;
  v_ancora_tipo text;
  v_settimane   int;
begin
  if exists (select 1 from linen_change_skip where skip_date = p_tuesday) then
    return 'nessuno';
  end if;

  select anchor_date, anchor_type into v_ancora_data, v_ancora_tipo
  from linen_change_anchor where id = true;

  if v_ancora_data is null then
    return null;   -- non ancora configurato da nessun amministratore
  end if;

  v_settimane := (p_tuesday - v_ancora_data) / 7;
  if mod(v_settimane, 2) = 0 then
    return v_ancora_tipo;
  end if;
  return case v_ancora_tipo when 'grande' then 'piccolo' else 'grande' end;
end;
$$;

-- Il valore che laundry_snapshot incorpora: il tipo per IL MARTEDÌ DI QUESTA
-- SETTIMANA, o null se non configurato. È l'unica risoluzione che serve alla
-- dashboard residenti — quale martedì mostrare lo decide già questa
-- funzione, lato server, non il client leggendo l'ancora grezza.
create or replace function linen_change_current()
returns text language sql stable as $$
  select linen_change_type_for(linen_change_current_tuesday());
$$;

-- Lettura per il pannello amministrativo: l'ancora GREZZA (non il tipo già
-- risolto), perché il form deve ripartire da cosa è stato salvato l'ultima
-- volta, non da un valore ricalcolato per oggi — più i martedì saltati, per
-- poterli mostrare e disfare. Il filtro sugli ultimi 7 giorni è solo per non
-- allungare la lista con salti ormai passati e irrilevanti: la riga resta
-- comunque nella tabella, non è una pulizia.
create or replace function linen_change_admin_get()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ancora_data', (select anchor_date from linen_change_anchor where id = true),
    'ancora_tipo', (select anchor_type from linen_change_anchor where id = true),
    'salta', coalesce((
      select jsonb_agg(skip_date order by skip_date)
      from linen_change_skip
      where skip_date >= current_date - interval '7 days'
    ), '[]'::jsonb)
  );
$$;

-- Sposta l'ancora. Un'unica azione copre sia la correzione occasionale sia
-- la ripartenza dopo una chiusura: in entrambi i casi si sceglie QUALE
-- martedì è di che tipo, e tutto ciò che segue si ricalcola da lì.
create or replace function linen_change_set_anchor(p_anchor_date date, p_anchor_type text)
returns jsonb language plpgsql as $$
begin
  if p_anchor_type not in ('grande', 'piccolo') then
    return jsonb_build_object('ok', false, 'error', 'tipo non valido');
  end if;
  if extract(isodow from p_anchor_date) <> 2 then
    return jsonb_build_object('ok', false, 'error', 'la data deve essere un martedì');
  end if;

  insert into linen_change_anchor (id, anchor_date, anchor_type, updated_at)
  values (true, p_anchor_date, p_anchor_type, now())
  on conflict (id) do update
    set anchor_date = excluded.anchor_date,
        anchor_type = excluded.anchor_type,
        updated_at  = now();

  return jsonb_build_object('ok', true, 'ancora_data', p_anchor_date, 'ancora_tipo', p_anchor_type);
end;
$$;

-- Segna o toglie il salto di un martedì. Un solo verbo con un booleano,
-- invece di due funzioni separate (aggiungi/togli): rispecchia che nel form
-- amministrativo è lo stesso pulsante, prima "salta questo" e poi "annulla".
create or replace function linen_change_set_skip(p_date date, p_skip boolean)
returns jsonb language plpgsql as $$
begin
  if extract(isodow from p_date) <> 2 then
    return jsonb_build_object('ok', false, 'error', 'la data deve essere un martedì');
  end if;

  if p_skip then
    insert into linen_change_skip (skip_date) values (p_date) on conflict (skip_date) do nothing;
  else
    delete from linen_change_skip where skip_date = p_date;
  end if;

  return jsonb_build_object('ok', true, 'data', p_date, 'salta', p_skip);
end;
$$;

revoke all on function linen_change_current_tuesday(text) from public, anon, authenticated;
revoke all on function linen_change_type_for(date) from public, anon, authenticated;
revoke all on function linen_change_current() from public, anon, authenticated;
revoke all on function linen_change_admin_get() from public, anon, authenticated;
revoke all on function linen_change_set_anchor(date, text) from public, anon, authenticated;
revoke all on function linen_change_set_skip(date, boolean) from public, anon, authenticated;

grant execute on function linen_change_current_tuesday(text) to service_role;
grant execute on function linen_change_type_for(date) to service_role;
grant execute on function linen_change_current() to service_role;
grant execute on function linen_change_admin_get() to service_role;
grant execute on function linen_change_set_anchor(date, text) to service_role;
grant execute on function linen_change_set_skip(date, boolean) to service_role;
