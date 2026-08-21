-- Una regola ricorrente di lavanderia accettava qualunque camera per
-- qualunque lavanderia: si poteva scegliere "Lavanderia Manica" (camere 1-99)
-- e scrivere "215" (una camera del Valentino) senza che nessun controllo se
-- ne accorgesse. La regola veniva creata ed effettivamente applicata alla
-- lavanderia scelta — ma chi guarda quella lavanderia (residenti e admin)
-- vede una camera che non è mai la sua, mentre chi controlla lo slot dal
-- lato della camera 215 guarda il Valentino e non vede né la regola né la
-- prenotazione che ne nasce: sembra che "non funzioni", ma sta solo
-- applicandosi da un'altra parte.

create or replace function recurring_add_laundry(
  p_laundry_id smallint, p_day int, p_slot int, p_machine text, p_room text, p_note text default null
) returns jsonb language plpgsql as $$
declare v_id bigint;
begin
  if not exists (select 1 from machine where laundry_id = p_laundry_id and code = p_machine and bookable) then
    return jsonb_build_object('ok', false, 'error', 'macchina non valida per questa lavanderia');
  end if;

  -- DIREZIONE non ha un numero e non appartiene a un intervallo: è l'unica
  -- eccezione, come nel resto dello schema.
  if p_room <> 'DIREZIONE' and not exists (
    select 1 from laundry
    where id = p_laundry_id
      and nullif(substring(p_room from '^[0-9]+'), '')::int between room_min and room_max
  ) then
    return jsonb_build_object('ok', false, 'error', 'quella camera non appartiene a questa lavanderia');
  end if;

  insert into recurring_booking (kind, laundry_id, day, slot, machine_code, room, note)
  values ('laundry', p_laundry_id, p_day, p_slot, p_machine, p_room, p_note)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'esiste già una regola per questo turno');
end;
$$;

revoke all on function recurring_add_laundry(smallint, int, int, text, text, text) from public, anon, authenticated;
grant execute on function recurring_add_laundry(smallint, int, int, text, text, text) to service_role;
