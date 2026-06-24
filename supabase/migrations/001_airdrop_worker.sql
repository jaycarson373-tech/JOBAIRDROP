create table if not exists epochs (
  epoch_id text primary key,
  status text not null check (status in ('running', 'completed', 'failed', 'skipped')),
  eligible_count integer not null default 0,
  mcdx_bought numeric not null default 0,
  mcdx_distributed numeric not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);

create table if not exists snapshots (
  epoch_id text not null references epochs(epoch_id) on delete cascade,
  wallet text not null,
  mcjob_balance numeric not null,
  primary key (epoch_id, wallet)
);

create table if not exists payouts (
  epoch_id text not null references epochs(epoch_id) on delete cascade,
  wallet text not null,
  mcdx_amount numeric not null,
  idempotency_key text not null unique,
  status text not null check (status in ('planned', 'settled', 'failed', 'dry_run')),
  tx_sig text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (epoch_id, wallet)
);

create table if not exists buys (
  epoch_id text primary key references epochs(epoch_id) on delete cascade,
  base_spent numeric not null,
  mcdx_received numeric not null,
  tx_sig text,
  created_at timestamptz not null default now()
);
