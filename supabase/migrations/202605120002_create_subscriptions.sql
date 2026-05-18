create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports(id) on delete cascade,
  supplier text not null,
  supplier_key text not null,
  next_payment date null,
  last_payment date null,
  payment_method text null,
  frequency text not null,
  amount_cents integer not null,
  currency text not null default 'EUR',
  transactions_count integer not null default 0,
  confidence numeric not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint subscriptions_frequency_check check (
    frequency in ('weekly', 'monthly', 'quarterly', 'annually', 'unknown')
  ),
  constraint subscriptions_import_supplier_payment_frequency_key unique (
    import_id,
    supplier_key,
    payment_method,
    frequency
  )
);

create index subscriptions_import_id_idx
  on public.subscriptions(import_id);

create index subscriptions_next_payment_idx
  on public.subscriptions(next_payment);

create index subscriptions_supplier_key_idx
  on public.subscriptions(supplier_key);
