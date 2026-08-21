-- Le prenotazioni della DIREZIONE le cancella solo un amministratore.
--
-- Finora `clear_laundry` era permissiva con chiunque, ed era una scelta
-- ragionata: senza login la camera è autodichiarata in localStorage, quindi un
-- controllo di proprietà si aggirerebbe cambiando una stringa nel browser e
-- fermerebbe solo chi lo rispettava già.
--
-- Per la DIREZIONE il ragionamento non regge, e per un motivo semplice: la
-- Direzione, a differenza di una camera, ha un login vero. Il suo turno è
-- l'unico di cui il server sappia con certezza a chi appartiene, quindi è
-- l'unico che possa davvero difendere. E sono anche i turni che contano di
-- più — la lavanderia chiusa per manutenzione, il giro di lavaggio della
-- struttura — quelli che non devono sparire perché qualcuno ha toccato il
-- pulsante sbagliato.
--
-- Il controllo NON si basa su un parametro mandato dal client: `p_as_admin`
-- lo passa /api/admin/data solo dopo aver verificato il cookie di sessione.
-- Dal percorso pubblico (/api/laundry) quel parametro non arriva mai.

create or replace function clear_laundry(
  p_room     text,
  p_day      integer,
  p_slot     integer,
  p_machine  text,
  p_as_admin boolean default false
) returns jsonb language plpgsql as $$
declare
  v_l  laundry%rowtype;
  v_ws date;
  v_di text;
begin
  -- Il client attuale può chiamare senza camera: si ricade sulla lavanderia
  -- principale. Ricaduta innocua — se la prenotazione stava nell'altra, il
  -- laundry_id non combacia e la delete non tocca nulla.
  select * into v_l from laundry
  where id = coalesce(laundry_for_room(p_room), (select id from laundry where slug = 'valentino'));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'camera non valida');
  end if;

  v_ws := current_week_start(v_l.tz);

  -- Di chi è il turno che si sta per liberare.
  select room into v_di
  from laundry_booking
  where laundry_id = v_l.id and week_start = v_ws
    and day = p_day and slot = p_slot and machine_code = p_machine;

  if v_di = 'DIREZIONE' and not p_as_admin then
    return jsonb_build_object('ok', false, 'error', 'riservata alla direzione');
  end if;

  -- Per tutto il resto resta permissiva, come prima e per le stesse ragioni.
  delete from laundry_booking
  where laundry_id = v_l.id and week_start = v_ws
    and day = p_day and slot = p_slot and machine_code = p_machine;

  return jsonb_build_object('ok', true,
    'week', week_snapshot(v_l.id, v_ws), 'status', status_snapshot(v_l.id));
end;
$$;

-- La versione a 4 parametri va tolta, altrimenti resta un doppione ambiguo e
-- PostgREST risponde PGRST203 a ogni chiamata che non nomina `p_as_admin`.
-- (È già successo con book_laundry: vedi la migrazione 005.)
drop function if exists clear_laundry(text, integer, integer, text);

-- I permessi vanno rimessi: `create or replace` con una firma nuova crea una
-- funzione nuova, che nasce con EXECUTE concesso a PUBLIC.
revoke all on function clear_laundry(text, integer, integer, text, boolean) from public, anon, authenticated;
grant execute on function clear_laundry(text, integer, integer, text, boolean) to service_role;
