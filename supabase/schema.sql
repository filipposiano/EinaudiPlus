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
-- EinaudiPlus — schema Postgres (Supabase)
-- Sostituisce i 4 deployment Google Apps Script e i relativi fogli.
--
-- Principi:
--  1. Le differenze fra le due lavanderie sono DATI (tabella `laundry`), non codice.
--     Aggiungere una terza lavanderia = una INSERT, non un nuovo file .gs.
--  2. I vincoli di integrità stanno nel database, non negli if.
--     `unique` uccide la race sulle prenotazioni, `exclude` quella sulle sovrapposizioni.
--  3. `week_start` sostituisce il reset distruttivo del lunedì: la settimana corrente
--     si svuota da sola allo scoccare della mezzanotte e lo storico resta.
--  4. RLS attiva ovunque, zero policy: si passa solo da service_role lato server.

create extension if not exists btree_gist;

-- ─────────────────────────────────────────────────────────────────────────────
-- Configurazione lavanderie
-- ─────────────────────────────────────────────────────────────────────────────

create table laundry (
  id            smallserial primary key,
  slug          text not null unique,
  name          text not null,
  n_slots       smallint not null default 19,
  slot0_min     smallint not null default 420,   -- 07:00 in minuti da mezzanotte
  slot_len_min  smallint not null default 75,
  weekly_quota  smallint not null default 2,
  reminder_mode text not null default 'single' check (reminder_mode in ('single','triple')),
  tz            text not null default 'Europe/Rome',
  room_min      smallint not null,
  room_max      smallint not null,
  check (room_min <= room_max)
);

-- Tutte e due 'triple'. Valentino era 'single' per eredita' del vecchio
-- laundry-Code.gs, che mandava un solo avviso: ma anche li' l'asciugatrice del
-- turno successivo e' riservata in automatico, quindi "sposta i vestiti" e
-- "ritira i vestiti" servono esattamente come alla Manica. Chi lavava al
-- Valentino non li riceveva, e sembrava un guasto delle notifiche.
insert into laundry (slug, name, reminder_mode, room_min, room_max) values
  ('valentino', 'Lavanderia Valentino', 'triple', 100, 9999),
  ('manica',    'Lavanderia Manica',    'triple',   1,   99);

-- ─────────────────────────────────────────────────────────────────────────────
-- Macchine
--
-- Manica ha fisicamente una lavatrice e un'asciugatrice (W-A e D-A), ma il
-- client indicizza sempre tutte e sei le sigle (deriveMachines e AdminSheet
-- usano liste fisse). Le creiamo tutte: quelle inesistenti hanno
-- bookable=false, così lo snapshot resta uniforme e l'admin non può
-- riattivare per sbaglio una macchina che non c'è.
-- ─────────────────────────────────────────────────────────────────────────────

create table machine (
  laundry_id smallint not null references laundry(id) on delete cascade,
  code       text     not null check (code ~ '^[WD]-[ABC]$'),
  kind       text     not null check (kind in ('washer','dryer')),
  is_oos     boolean  not null default false,
  bookable   boolean  not null default true,
  sort_order smallint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (laundry_id, code)
);

insert into machine (laundry_id, code, kind, bookable, is_oos, sort_order)
select l.id, m.code, m.kind,
       case when l.slug = 'manica' and m.code not in ('W-A','D-A') then false else true end,
       case when l.slug = 'manica' and m.code not in ('W-A','D-A') then true  else false end,
       m.ord
from laundry l
cross join (values
  ('W-A','washer',1), ('W-B','washer',2), ('W-C','washer',3),
  ('D-A','dryer', 4), ('D-B','dryer', 5), ('D-C','dryer', 6)
) as m(code, kind, ord);

-- ─────────────────────────────────────────────────────────────────────────────
-- Prenotazioni lavanderia
--
-- Le asciugatrici NON si salvano: restano derivate lato client
-- (lavatrice X slot N -> asciugatrice X slot N+1), esattamente come oggi.
-- ─────────────────────────────────────────────────────────────────────────────

create table laundry_booking (
  id           bigserial primary key,
  laundry_id   smallint not null,
  week_start   date     not null,
  day          smallint not null check (day between 0 and 6),   -- 0 = lunedì
  slot         smallint not null check (slot between 0 and 18),
  machine_code text     not null,
  -- 'DIREZIONE' e' l'unica eccezione al formato camera: serve all'admin per
  -- riservare turni che non appartengono a nessuno (manutenzione, lavaggi di
  -- servizio). In maiuscolo, cosi' non collide con un numero di camera.
  room         text     not null check (room = 'DIREZIONE' or room ~ '^[0-9]{1,4}(-?[abAB])?$'),
  created_at   timestamptz not null default now(),
  created_by   text not null default 'user' check (created_by in ('user','admin')),
  foreign key (laundry_id, machine_code) references machine(laundry_id, code),
  -- Il vincolo che sostituisce LockService.waitLock(15000):
  unique (laundry_id, week_start, day, slot, machine_code)
);

create index laundry_booking_week_idx on laundry_booking (laundry_id, week_start);
create index laundry_booking_quota_idx on laundry_booking (laundry_id, week_start, room);

-- ─────────────────────────────────────────────────────────────────────────────
-- Sale cinema e musica
-- ─────────────────────────────────────────────────────────────────────────────

create table room_space (
  id          smallserial primary key,
  slug        text not null unique,
  name        text not null,
  max_per_day smallint not null default 6,
  has_type    boolean  not null default false,
  -- Descrittive, non applicate: nessuna funzione le legge, e book_space
  -- accetta qualunque fascia dentro le 24 ore. L'orario di apertura lo
  -- impone il client (ROOM_CFG in Rooms.tsx), che e' anche l'unico posto da
  -- cambiare se un giorno una sala apre prima. Restano qui perche' dicono a
  -- chi legge lo schema come sono pensate le due sale.
  open_min    smallint not null default 0,
  close_min   smallint not null default 1440
);

insert into room_space (slug, name, has_type, open_min, close_min) values
  ('cinema', 'Sala Cinema', true,  0, 1440),
  ('music',  'Sala Musica', false, 0, 1440);

create table space_booking (
  id         bigserial primary key,
  space_id   smallint not null references room_space(id) on delete cascade,
  week_start date     not null,
  day        smallint not null check (day between 0 and 6),
  -- end_min arriva fino a 2880 per conservare gli orari che scavalcano mezzanotte
  -- (Code.gs: se end <= start allora end += 1440)
  start_min  int      not null check (start_min between 0 and 1439),
  end_min    int      not null check (end_min > start_min and end_min <= 2880),
  name       text     not null check (length(name) between 1 and 40),
  btype      text     check (btype in ('private','open')),
  created_at timestamptz not null default now(),
  created_by text not null default 'user' check (created_by in ('user','admin')),
  -- Consolidato dalla migrazione 004. Una prenotazione che scavalca la
  -- mezzanotte diventa DUE righe (giovedì 21:00→24:00 e venerdì 00:00→01:00)
  -- legate da questo group_id: il vincolo qui sotto lavora dentro un singolo
  -- giorno, quindi due righe con `day` diverso non venivano mai confrontate e
  -- la stessa ora della stessa notte era prenotabile due volte. Spezzandola,
  -- il vincolo che esiste già fa il lavoro giusto su entrambi i giorni.
  group_id   uuid,
  -- Sovrapposizioni impossibili per costruzione: sostituisce sia il controllo
  -- read-then-write di Code.gs sia il doppione client-side in roomsApi.hasOverlap
  exclude using gist (
    space_id   with =,
    week_start with =,
    day        with =,
    int4range(start_min, end_min) with &&
  )
);

create index space_booking_week_idx  on space_booking (space_id, week_start);
create index space_booking_group_idx on space_booking (group_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Notifiche
-- ─────────────────────────────────────────────────────────────────────────────

create table push_sub (
  id         bigserial primary key,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  room       text not null,
  laundry_id smallint not null references laundry(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  fail_count smallint not null default 0
);

create index push_sub_target_idx on push_sub (laundry_id, room);

create table telegram_sub (
  id          bigserial primary key,
  chat_id     text not null unique,
  room        text,
  laundry_id  smallint references laundry(id) on delete cascade,
  link_code   text unique,
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

create index telegram_sub_target_idx on telegram_sub (laundry_id, room) where verified_at is not null;

-- Sostituisce le chiavi PropertiesService `sent_yyyyMMddHHmm_kind`.
--
-- Due miglioramenti che vengono gratis dalla primary key:
--  - il doppio invio è IMPOSSIBILE, non solo improbabile (claim-before-send)
--  - cancella-e-riprenota riarma il promemoria, perché la chiave è booking_id
--    e non un timestamp da orologio (col vecchio schema il promemoria saltava)
create table reminder_log (
  booking_id bigint not null references laundry_booking(id) on delete cascade,
  kind       text   not null check (kind in ('pre','washerend','dryerend')),
  fire_at    timestamptz not null,
  claimed_at timestamptz not null default now(),
  sent_ok    smallint not null default 0,
  sent_fail  smallint not null default 0,
  primary key (booking_id, kind)
);

create index reminder_log_recent_idx on reminder_log (claimed_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Segnalazioni, rate limit, audit
-- ─────────────────────────────────────────────────────────────────────────────

-- Niente escaping anti formula-injection: era un problema solo dei fogli.
-- `safeCell_` non viene portato — è una fonte di bug, non una protezione.
create table feedback (
  id         bigserial primary key,
  laundry_id smallint references laundry(id) on delete set null,
  room       text,
  body       text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create index feedback_open_idx on feedback (created_at desc) where handled_at is null;

create table rate_limit (
  bucket       text primary key,
  hits         int not null default 0,
  window_start timestamptz not null default now()
);

create table audit_log (
  id     bigserial primary key,
  actor  text not null,
  action text not null,
  detail jsonb,
  at     timestamptz not null default now()
);

create index audit_log_recent_idx on audit_log (at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: attiva ovunque, nessuna policy.
--
-- service_role (usato solo lato server dalle funzioni Vercel) bypassa RLS.
-- La anon key è pubblica per definizione in un'app senza login: così anche se
-- trapela non espone nulla.
-- ─────────────────────────────────────────────────────────────────────────────

alter table laundry         enable row level security;
alter table machine         enable row level security;
alter table laundry_booking enable row level security;
alter table room_space      enable row level security;
alter table space_booking   enable row level security;
alter table push_sub        enable row level security;
alter table telegram_sub    enable row level security;
alter table reminder_log    enable row level security;
alter table feedback        enable row level security;
alter table rate_limit      enable row level security;
alter table audit_log       enable row level security;
