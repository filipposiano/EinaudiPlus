-- La pulizia non vedeva la sala polivalente, e non sapeva guardare una sala
-- sola.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La polivalente sopravviveva anche ad "Azzera tutto"
--
-- `sysadmin_purge` e' piu' vecchia della sala polivalente: cancellava
-- `laundry_booking` e `space_booking` e si fermava li'. La polivalente pero'
-- non vive in `space_booking` — le sue righe stanno in `conference_event` (la
-- regola) e `conference_eccezione` (le occorrenze annullate o spostate),
-- aggiunte dalla 007 e dalla 015 senza che nessuno tornasse su questa
-- funzione.
--
-- L'effetto era che il pannello rispondeva "Fatto", con tanto di conteggi, e
-- l'agenda della polivalente restava intatta: nessun errore, nessun segnale.
-- Il caso peggiore e' "Azzera tutto", che promette esplicitamente di ripulire
-- ogni cosa.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O tutto o niente
--
-- Svuotare la sala musica perche' e' cambiato il calendario delle prove
-- voleva dire portarsi via anche lavanderia, cinema e polivalente. Ora
-- `p_sala` restringe l'operazione a una sola: 'lavanderia', 'cinema',
-- 'musica', 'polivalente'. Assente (NULL) = tutte, cioe' il comportamento di
-- prima, che resta quello dei pulsanti gia' esistenti.
--
-- Vale solo per gli ambiti che parlano di prenotazioni ('settimana' e
-- 'prenotazioni'): segnalazioni, iscrizioni e regole ricorrenti non hanno una
-- sala, e chiederlo e' un errore del chiamante, non una richiesta da
-- interpretare — quindi si risponde no invece di ignorare il parametro.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Il drop qui sotto NON e' pro forma. Vedi la 005: `create or replace` con un
-- parametro in piu' non sostituisce niente, crea una funzione NUOVA accanto
-- alla vecchia, e da quel momento la chiamata a un solo argomento diventa
-- ambigua (PGRST203) — cioe' la pulizia smetterebbe di funzionare del tutto.
drop function if exists sysadmin_purge(text);

create or replace function sysadmin_purge(p_scope text, p_sala text default null)
returns jsonb language plpgsql as $$
declare
  v_out  jsonb := '{}'::jsonb;
  v_n    int;
  v_m    int;
  v_sala text := nullif(btrim(lower(coalesce(p_sala, ''))), '');
  -- 'musica' e' il nome che si legge; 'music' e' lo slug che sta in
  -- room_space fin dallo schema iniziale. La traduzione avviene qui, una
  -- volta, cosi' il chiamante nomina le sale come le nomina l'interfaccia.
  v_slug text;
  v_lun  date := current_week_start('Europe/Rome');
  v_dom  date := current_week_start('Europe/Rome') + 6;
begin
  if p_scope not in ('prenotazioni', 'settimana', 'segnalazioni', 'notifiche', 'ricorrenti', 'tutto') then
    return jsonb_build_object('ok', false, 'error', 'ambito non riconosciuto');
  end if;

  if v_sala is not null then
    if v_sala not in ('lavanderia', 'cinema', 'musica', 'polivalente') then
      return jsonb_build_object('ok', false, 'error', 'sala non riconosciuta');
    end if;
    if p_scope not in ('settimana', 'prenotazioni') then
      return jsonb_build_object('ok', false, 'error',
        'la singola sala vale solo per "settimana" e "prenotazioni"');
    end if;
  end if;

  v_slug := case v_sala when 'cinema' then 'cinema' when 'musica' then 'music' end;

  -- Solo la settimana corrente: il caso normale, per ripartire da zero senza
  -- perdere lo storico.
  if p_scope in ('settimana', 'tutto') then
    if v_sala is null or v_sala = 'lavanderia' then
      delete from laundry_booking where week_start = v_lun;
      get diagnostics v_n = row_count;
      v_out := v_out || jsonb_build_object('prenotazioni_settimana', v_n);
    end if;

    if v_sala is null or v_slug is not null then
      delete from space_booking
       where week_start = v_lun
         and (v_slug is null or space_id = (select id from room_space where slug = v_slug));
      get diagnostics v_n = row_count;
      v_out := v_out || jsonb_build_object(coalesce(v_sala, 'sale') || '_settimana', v_n);
    end if;

    -- La polivalente non ha settimane: ha REGOLE con un periodo di validita'.
    -- "Svuota la settimana" quindi non e' una DELETE sola.
    if v_sala is null or v_sala = 'polivalente' then
      -- Le regole che vivono solo dentro questa settimana (un evento singolo,
      -- un convegno di tre giorni) spariscono davvero: fuori di qui non
      -- lasciano niente.
      delete from conference_event where dal >= v_lun and al <= v_dom;
      get diagnostics v_n = row_count;

      -- Quelle che vanno oltre restano — cancellarle si porterebbe via mesi
      -- di calendario per svuotare sette giorni. Le loro occorrenze di questa
      -- settimana si annullano una per una, con lo stesso meccanismo del
      -- pulsante "annulla questo incontro".
      --
      -- Si guarda la data EFFETTIVA (`nuova_data` se l'incontro e' stato
      -- spostato), non quella che la regola produrrebbe: un incontro portato
      -- via da questa settimana non c'entra piu' e non va toccato, uno
      -- portato dentro sta in questa settimana e va tolto. Per questo la
      -- finestra generata e' piu' larga di sette giorni. Le occorrenze gia'
      -- annullate si saltano, cosi' il conteggio dice quante ne sono sparite
      -- davvero.
      insert into conference_eccezione (event_id, data_originale, tipo, creato_da)
      select e.id, g.d::date, 'annullata', 'sistemista'
        from conference_event e
        cross join lateral generate_series(
          greatest(e.dal, v_lun - 31)::timestamp,
          least(e.al, v_dom + 31)::timestamp,
          interval '1 day'
        ) g(d)
        left join conference_eccezione x
          on x.event_id = e.id and x.data_originale = g.d::date
       where (e.giorno_settimana is null
              or extract(isodow from g.d)::int - 1 = e.giorno_settimana)
         and (x.id is null or x.tipo <> 'annullata')
         and coalesce(x.nuova_data, g.d::date) between v_lun and v_dom
      on conflict (event_id, data_originale) do update
        set tipo = 'annullata', nuova_data = null, ora_inizio = null,
            ora_fine = null, titolo = null, note = null;
      get diagnostics v_m = row_count;

      v_out := v_out || jsonb_build_object('polivalente_settimana', v_n + v_m);
    end if;
  end if;

  -- Tutto lo storico delle prenotazioni.
  if p_scope in ('prenotazioni', 'tutto') then
    if v_sala is null or v_sala = 'lavanderia' then
      delete from laundry_booking where id is not null;
      get diagnostics v_n = row_count;
      v_out := v_out || jsonb_build_object('prenotazioni', v_n);
    end if;

    if v_sala is null or v_slug is not null then
      delete from space_booking
       where id is not null
         and (v_slug is null or space_id = (select id from room_space where slug = v_slug));
      get diagnostics v_n = row_count;
      v_out := v_out || jsonb_build_object(coalesce(v_sala, 'sale'), v_n);
    end if;

    -- Le eccezioni se ne vanno da sole: `on delete cascade`.
    if v_sala is null or v_sala = 'polivalente' then
      delete from conference_event where id is not null;
      get diagnostics v_n = row_count;
      v_out := v_out || jsonb_build_object('polivalente', v_n);
    end if;
  end if;

  if p_scope in ('segnalazioni', 'tutto') then
    delete from feedback where id is not null;  get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('segnalazioni', v_n);
  end if;

  if p_scope in ('notifiche', 'tutto') then
    delete from push_sub where id is not null;      get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('push', v_n);
    delete from telegram_sub where id is not null;  get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('telegram', v_n);
  end if;

  if p_scope in ('ricorrenti', 'tutto') then
    delete from recurring_booking where id is not null;  get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('ricorrenti', v_n);
  end if;

  if p_scope = 'tutto' then
    delete from rate_limit where bucket is not null;
    -- audit_log NON si cancella: serve proprio a sapere chi ha svuotato cosa.
    update machine set is_oos = not bookable where laundry_id is not null;
    v_out := v_out || jsonb_build_object('macchine_ripristinate', true);
  end if;

  return jsonb_build_object('ok', true, 'cancellati', v_out);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Quante prenotazioni ci sono, adesso
--
-- La pulizia riportava solo quante righe AVEVA cancellato. Con la polivalente
-- muta (punto 1) quel numero non diceva niente su cosa fosse rimasto: "Fatto —
-- sale: 0" si legge uguale se la pulizia ha funzionato e se non ha guardato
-- nella tabella giusta.
--
-- Un conteggio letto dal database e mostrato accanto ai pulsanti chiude il
-- cerchio: prima dice cosa si sta per cancellare, dopo va a zero da solo.
create or replace function sysadmin_conteggi()
returns jsonb language plpgsql stable as $$
declare
  v_lun date := current_week_start('Europe/Rome');
  v_dom date := current_week_start('Europe/Rome') + 6;
  v_tot jsonb;
  v_set jsonb;
begin
  select jsonb_build_object(
    'lavanderia',  (select count(*) from laundry_booking),
    'cinema',      (select count(*) from space_booking b
                      join room_space s on s.id = b.space_id where s.slug = 'cinema'),
    'musica',      (select count(*) from space_booking b
                      join room_space s on s.id = b.space_id where s.slug = 'music'),
    -- Per la polivalente si contano le REGOLE, che sono le righe che la
    -- pulizia cancella: una regola ricorrente e' un incontro solo per chi la
    -- scrive, anche se produce trenta occorrenze.
    'polivalente', (select count(*) from conference_event)
  ) into v_tot;

  select jsonb_build_object(
    'lavanderia',  (select count(*) from laundry_booking where week_start = v_lun),
    'cinema',      (select count(*) from space_booking b
                      join room_space s on s.id = b.space_id
                     where s.slug = 'cinema' and b.week_start = v_lun),
    'musica',      (select count(*) from space_booking b
                      join room_space s on s.id = b.space_id
                     where s.slug = 'music' and b.week_start = v_lun),
    -- Qui invece contano le OCCORRENZE: quello che si vede in agenda da
    -- lunedi' a domenica, annullate escluse. La finestra generata e' piu'
    -- larga della settimana perche' un incontro puo' essere stato spostato
    -- dentro o fuori: si guarda la data che ha davvero, non quella che la
    -- regola avrebbe prodotto.
    'polivalente', (
      select count(*)
        from conference_event e
        cross join lateral generate_series(
          greatest(e.dal, v_lun - 31)::timestamp,
          least(e.al, v_dom + 31)::timestamp,
          interval '1 day'
        ) g(d)
        left join conference_eccezione x
          on x.event_id = e.id and x.data_originale = g.d::date
       where (e.giorno_settimana is null
              or extract(isodow from g.d)::int - 1 = e.giorno_settimana)
         and (x.id is null or x.tipo <> 'annullata')
         and coalesce(x.nuova_data, g.d::date) between v_lun and v_dom
    )
  ) into v_set;

  return jsonb_build_object(
    'ok', true,
    'settimana_dal', v_lun,
    'totale', v_tot,
    'settimana', v_set
  );
end;
$$;

-- I permessi valgono per funzione, e queste due sono nuove (la prima e' stata
-- ricreata da zero dal drop). Senza, tornerebbero invocabili da `anon` con la
-- sola chiave pubblicabile — vedi la 005. Le default privileges impostate li'
-- coprono gia' il caso, ma ripeterlo qui costa due righe e non dipende da
-- quale ruolo esegue questa migrazione.
revoke all on function sysadmin_purge(text, text) from public, anon, authenticated;
revoke all on function sysadmin_conteggi() from public, anon, authenticated;
grant execute on function sysadmin_purge(text, text) to service_role;
grant execute on function sysadmin_conteggi() to service_role;
