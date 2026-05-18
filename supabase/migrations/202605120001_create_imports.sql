create extension if not exists pgcrypto;

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  file_name text not null,
  status text not null default 'completed',
  rows_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  raw_columns jsonb not null default '[]'::jsonb
);

create table public.raw_transactions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports(id) on delete cascade,
  row_number integer not null,
  transaction_date date null,
  raw_supplier text not null,
  amount_cents integer null,
  currency text not null default 'EUR',
  bank_account text null,
  description text null,
  source_row jsonb not null,
  created_at timestamptz not null default now(),
  unique(import_id, row_number)
);

create index raw_transactions_import_id_idx
  on public.raw_transactions(import_id);

create index imports_created_at_idx
  on public.imports(created_at desc);
