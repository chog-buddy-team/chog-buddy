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

-- Gemini diary calls per wallet per day (a count only, never diary text). Pruned after 7 days.
create table if not exists diary_usage (
  address text not null,
  day date not null,
  count int not null,
  primary key (address, day)
);

create index if not exists nonces_created_at on nonces (created_at);
create index if not exists sessions_created_at on sessions (created_at);

-- Chat messages per caller per day ("wallet:<addr>", "ip:<hmac>", or "global"). Counts only, never chat text.
create table if not exists chat_usage (
  key text not null,
  day date not null,
  count int not null,
  primary key (key, day)
);

-- Focus Bets: latest focus minutes the Pet reported per bet (bet details live onchain).
create table if not exists focus_progress (
  bet_id bigint primary key,
  minutes int not null,
  reported_at timestamptz not null default now()
);

-- Daily sweep cursor: lowest bet id that was still open last run.
create table if not exists focus_cursor (
  id int primary key default 1,
  next_open bigint not null
);
