create table public.supplier_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  supplier_key text not null,
  canonical_supplier text not null,
  business_category text not null,
  default_decision text not null,
  match_type text not null default 'exact_supplier_key',
  source text not null default 'user',
  notes text null,
  last_seen_at timestamptz null,
  examples jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  constraint supplier_rules_business_category_check check (
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
  constraint supplier_rules_default_decision_check check (
    default_decision in ('auto_subscription', 'needs_review', 'excluded')
  ),
  constraint supplier_rules_match_type_check check (
    match_type in ('exact_supplier_key')
  ),
  constraint supplier_rules_source_check check (
    source in ('user', 'system')
  ),
  constraint supplier_rules_supplier_key_match_type_key unique (
    supplier_key,
    match_type
  )
);

create index supplier_rules_supplier_key_idx
  on public.supplier_rules(supplier_key);

create index supplier_rules_active_idx
  on public.supplier_rules(active);

create index supplier_rules_default_decision_idx
  on public.supplier_rules(default_decision);

create index supplier_rules_business_category_idx
  on public.supplier_rules(business_category);

create or replace function public.set_supplier_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger supplier_rules_updated_at
  before update on public.supplier_rules
  for each row
  execute function public.set_supplier_rules_updated_at();
