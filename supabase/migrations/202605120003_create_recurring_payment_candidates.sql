create table public.recurring_payment_candidates (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports(id) on delete cascade,
  candidate_key text not null,
  supplier text not null,
  supplier_key text not null,
  payment_method text null,
  frequency text not null,
  billing_model text not null default 'unknown',
  amount_cents integer not null,
  currency text not null default 'EUR',
  last_payment date null,
  next_payment date null,
  transactions_count integer not null default 0,
  recurrence_confidence numeric not null default 0,
  business_category text not null default 'unknown',
  classification_confidence numeric not null default 0,
  system_decision text not null,
  user_decision text null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_payment_candidates_frequency_check check (
    frequency in ('weekly', 'monthly', 'quarterly', 'annually', 'unknown')
  ),
  constraint recurring_payment_candidates_billing_model_check check (
    billing_model in ('fixed', 'variable', 'unknown')
  ),
  constraint recurring_payment_candidates_business_category_check check (
    business_category in (
      'software',
      'cloud',
      'ai',
      'telecom',
      'banking',
      'workspace',
      'professional_service',
      'marketing',
      'food',
      'transport',
      'travel',
      'retail',
      'income',
      'unknown'
    )
  ),
  constraint recurring_payment_candidates_system_decision_check check (
    system_decision in ('auto_subscription', 'needs_review', 'excluded')
  ),
  constraint recurring_payment_candidates_user_decision_check check (
    user_decision is null or user_decision in ('confirmed', 'ignored')
  ),
  constraint recurring_payment_candidates_import_candidate_key unique (
    import_id,
    candidate_key
  )
);

create index recurring_payment_candidates_import_id_idx
  on public.recurring_payment_candidates(import_id);

create index recurring_payment_candidates_candidate_key_idx
  on public.recurring_payment_candidates(candidate_key);

create index recurring_payment_candidates_system_decision_idx
  on public.recurring_payment_candidates(system_decision);

create index recurring_payment_candidates_user_decision_idx
  on public.recurring_payment_candidates(user_decision);

create index recurring_payment_candidates_next_payment_idx
  on public.recurring_payment_candidates(next_payment);

create or replace function public.set_recurring_payment_candidates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger recurring_payment_candidates_updated_at
  before update on public.recurring_payment_candidates
  for each row
  execute function public.set_recurring_payment_candidates_updated_at();

alter table public.subscriptions
  add column if not exists candidate_id uuid null references public.recurring_payment_candidates(id) on delete set null,
  add column if not exists billing_model text not null default 'unknown',
  add column if not exists business_category text not null default 'unknown';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_billing_model_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_billing_model_check check (
        billing_model in ('fixed', 'variable', 'unknown')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_business_category_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_business_category_check check (
        business_category in (
          'software',
          'cloud',
          'ai',
          'telecom',
          'banking',
          'workspace',
          'professional_service',
          'marketing',
          'food',
          'transport',
          'travel',
          'retail',
          'income',
          'unknown'
        )
      );
  end if;
end;
$$;
