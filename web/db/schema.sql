create table if not exists nonces (
  nonce text primary key,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  address text not null,
  created_at timestamptz not null default now()
);

-- One row per Chog per Owner-local day. Only Category minutes (ADR 0001).
create table if not exists activity (
  token_id int not null,
  day date not null,
  owner text not null,
  totals jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (token_id, day)
);

-- Mirror of the onchain Soul plus bookkeeping for the daily job.
create table if not exists souls (
  token_id int primary key,
  night_owl int not null,
  grinder int not null,
  social int not null,
  creator int not null,
  level int not null,
  owner_count int not null,
  last_owner text not null,
  last_day date not null
);
