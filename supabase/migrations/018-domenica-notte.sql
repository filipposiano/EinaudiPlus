-- La notte fra domenica e lunedì.
--
-- La 004 ha spezzato le prenotazioni che scavalcano la mezzanotte in DUE righe
-- su due giorni consecutivi, così che il vincolo anti-sovrapposizione — che
-- lavora dentro un singolo `day` — le veda entrambe. Il giorno della coda si
-- calcolava come `(p_day + 1) % 7`, restando SEMPRE dentro la stessa settimana.
--
-- Da lunedì a sabato è giusto. Per la domenica no: (6 + 1) % 7 = 0, cioè il
-- LUNEDÌ DI QUELLA STESSA SETTIMANA — sei giorni PRIMA, non il giorno dopo. Le
-- conseguenze, tutte e tre reali:
--
--   • la coda finiva su un giorno già passato. Chi prenotava domenica 21:00 →
--     lunedì 02:00 si vedeva la fascia sparire alle 00:00, quando il database
--     passa alla settimana nuova: la coda era rimasta nella settimana vecchia,
--     e space_bookings legge solo quella corrente. La sala risultava libera
--     proprio durante le ore in cui era occupata.
--   • la coda si scontrava col vincolo del lunedì SBAGLIATO: se quel lunedì
--     mattina qualcuno aveva già prenotato, l'inserimento andava in
--     exclusion_violation e la serata di domenica veniva rifiutata per intero
--     ("overlap") senza motivo visibile.
--   • per lo stesso motivo la notte fra domenica e lunedì non era protetta:
--     due persone potevano prendere le stesse ore.
--
-- La coda della domenica va sul lunedì DELLA SETTIMANA DOPO: week_start + 7,
-- day 0. Il vincolo continua a funzionare (week_start fa parte della chiave) e
-- la riga diventa visibile da sola quando la settimana gira — cioè esattamente
-- quando quelle ore arrivano.
--
-- prune_old_weeks cancella solo le settimane più VECCHIE della corrente, quindi
-- una riga nel futuro non viene potata prima del tempo.

create or replace function book_space(
  p_slug  text,
  p_day   integer,
  p_start integer,
  p_end   integer,
  p_name  text,
  p_type  text default null
) returns jsonb language plpgsql as $$
declare
  v_s     room_space%rowtype;
  v_ws    date;
  v_end   int := p_end;
  v_cnt   int;
  v_name  text;
  v_type  text;
  v_gid   uuid;
  v_day2  int;
  v_ws2   date;
  v_coda  int;
begin
  select * into v_s from room_space where slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'sala non valida'); end if;

  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'nome mancante');
  end if;
  if p_day not between 0 and 6 then
    return jsonb_build_object('ok', false, 'error', 'giorno non valido');
  end if;
  if p_start is null or p_start < 0 or p_start > 1439 then
    return jsonb_build_object('ok', false, 'error', 'orario non valido');
  end if;

  -- Semantica di parseRange_: una fascia che scavalca la mezzanotte arriva con
  -- end <= start e si riporta a end + 1440.
  if v_end <= p_start then v_end := v_end + 1440; end if;
  if v_end - p_start > 1440 then
    return jsonb_build_object('ok', false, 'error', 'durata non valida');
  end if;

  v_ws   := current_week_start('Europe/Rome');
  v_name := left(btrim(p_name), 40);
  v_type := case when v_s.has_type then p_type else null end;

  -- Il giorno dopo. Dopo la domenica non c'è un "giorno 7" nella griglia
  -- settimanale: c'è il lunedì della settimana SEGUENTE, che è una riga con un
  -- altro week_start. È l'unico posto in cui quelle ore esistono davvero.
  v_day2 := (p_day + 1) % 7;
  v_ws2  := case when p_day = 6 then v_ws + 7 else v_ws end;
  v_coda := v_end - 1440;   -- > 0 solo se si scavalca

  -- Il tetto giornaliero va verificato su TUTTI i giorni che la prenotazione
  -- tocca, non solo su quello di partenza — e ogni giorno con la SUA settimana,
  -- perché per la domenica i due non stanno più nella stessa.
  select max(n) into v_cnt from (
    select count(*) as n
    from space_booking
    where space_id = v_s.id and week_start = v_ws and day = p_day
    union all
    select count(*)
    from space_booking
    where v_coda > 0
      and space_id = v_s.id and week_start = v_ws2 and day = v_day2
  ) t;

  if coalesce(v_cnt, 0) >= v_s.max_per_day then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  begin
    if v_coda > 0 then
      v_gid := gen_random_uuid();

      -- Testa: dall'inizio fino a mezzanotte.
      insert into space_booking (space_id, week_start, day, start_min, end_min, name, btype, group_id)
      values (v_s.id, v_ws, p_day, p_start, 1440, v_name, v_type, v_gid);

      -- Coda: da mezzanotte alla fine, sul giorno successivo. È questa riga a
      -- rendere la notte visibile al vincolo anti-sovrapposizione del giorno
      -- dopo — il motivo per cui esiste la divisione.
      insert into space_booking (space_id, week_start, day, start_min, end_min, name, btype, group_id)
      values (v_s.id, v_ws2, v_day2, 0, v_coda, v_name, v_type, v_gid);
    else
      insert into space_booking (space_id, week_start, day, start_min, end_min, name, btype)
      values (v_s.id, v_ws, p_day, p_start, v_end, v_name, v_type);
    end if;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'error', 'overlap');
  end;

  return space_bookings(p_slug);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Le righe già salvate storte.
--
-- Ogni coda di una domenica finita sul lunedì della stessa settimana: la si
-- riconosce perché è day = 0, ha un group_id, e la testa dello stesso gruppo
-- sta di domenica. Spostarla di una settimana è esattamente ciò che la nuova
-- book_space avrebbe fatto.
--
-- Due paletti, perché una migrazione che va in errore a metà è peggio del
-- difetto che sistema:
--   • solo dalla settimana corrente in poi. Le code delle domeniche passate
--     riguardano ore già trascorse: spostarle in avanti creerebbe occupazioni
--     finte in una settimana che deve restare com'è.
--   • solo se il lunedì di destinazione è libero in quelle ore. Se non lo è
--     (una regola ricorrente già applicata alla settimana dopo, per esempio)
--     la riga resta dov'è: sbagliata ma innocua, mentre l'alternativa sarebbe
--     un exclusion_violation che ferma tutto il resto della migrazione.

update space_booking coda
set week_start = coda.week_start + 7
from space_booking testa
where testa.group_id = coda.group_id
  and testa.id <> coda.id
  and coda.day = 0
  and testa.day = 6
  and coda.week_start = testa.week_start
  and coda.week_start >= current_week_start('Europe/Rome')
  and not exists (
    select 1 from space_booking altra
    where altra.space_id   = coda.space_id
      and altra.week_start = coda.week_start + 7
      and altra.day        = 0
      and int4range(altra.start_min, altra.end_min) && int4range(coda.start_min, coda.end_min)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Cancellare dal pannello mezza notte lasciava l'altra metà orfana.
--
-- delete_space_booking (lato utente) segue già il group_id dalla 004; la
-- gemella amministrativa no, cancellava per id secco. Con la coda della
-- domenica ora in un'altra settimana l'orfana sarebbe pure invisibile in
-- admin_spaces, che guarda solo la settimana corrente: impossibile da togliere
-- dal pannello, e la sala resterebbe occupata a vuoto.

create or replace function admin_delete_space_booking(p_id bigint)
returns jsonb language plpgsql as $$
declare
  v_n   int;
  v_gid uuid;
begin
  select group_id into v_gid from space_booking where id = p_id;

  if v_gid is not null then
    delete from space_booking where group_id = v_gid;
  else
    delete from space_booking where id = p_id;
  end if;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- La sala musica non apre più alle 9.
--
-- Il limite lo imponeva soltanto ROOM_CFG in Rooms.tsx: il database ha sempre
-- accettato qualunque fascia dentro le 24 ore, e open_min/close_min di
-- room_space sono colonne descrittive che nessuna funzione legge. Toltolo di
-- là, questi due numeri erano rimasti a raccontare un orario che non esiste
-- più — l'unico danno che possono fare è confondere chi legge lo schema per
-- capire come sono pensate le sale, ed è esattamente a quello che servono.
--
-- Resta diverso ciò che è davvero diverso: gli strumenti non in cuffia solo
-- fra le 16 e le 20. Quello non è un orario di apertura ma una regola sul
-- rumore, sta nel regolamento e nell'avviso del modulo, e non è mai passato
-- da qui.

update room_space set open_min = 0, close_min = 1440 where slug = 'music';
