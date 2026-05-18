do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'integrations_provider_check'
      and conrelid = 'public.integrations'::regclass
  ) then
    alter table public.integrations
      drop constraint integrations_provider_check;
  end if;
end $$;

alter table public.integrations
  add constraint integrations_provider_check check (
    provider in ('google_workspace', 'pennylane')
  );

create table public.pennylane_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  integration_id uuid null references public.integrations(id) on delete set null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  triggered_by_user_id uuid null,
  error_message text null,
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pennylane_sync_runs_status_check check (
    status in ('running', 'success', 'failed', 'partial')
  )
);

create index pennylane_sync_runs_organization_started_idx
  on public.pennylane_sync_runs(organization_id, started_at desc);

create index pennylane_sync_runs_status_idx
  on public.pennylane_sync_runs(organization_id, status);

create table public.pennylane_supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sync_run_id uuid null references public.pennylane_sync_runs(id) on delete set null,
  source_system text not null default 'pennylane',
  external_id text not null,
  supplier_external_id text null,
  supplier_name text not null,
  invoice_number text null,
  invoice_date date null,
  issue_date date null,
  due_date date null,
  deadline date null,
  amount_cents integer null,
  amount_excluding_tax_cents integer null,
  currency text not null default 'EUR',
  is_paid boolean null,
  label text null,
  raw_json jsonb not null default '{}'::jsonb,
  source_hash text not null,
  attachment_url text null,
  storage_key text null,
  extraction_error text null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pennylane_supplier_invoices_source_check check (
    source_system in ('pennylane')
  ),
  constraint pennylane_supplier_invoices_org_external_key unique (
    organization_id,
    source_system,
    external_id
  )
);

create index pennylane_supplier_invoices_source_external_idx
  on public.pennylane_supplier_invoices(source_system, external_id);

create index pennylane_supplier_invoices_organization_supplier_idx
  on public.pennylane_supplier_invoices(organization_id, supplier_name);

create index pennylane_supplier_invoices_organization_invoice_date_idx
  on public.pennylane_supplier_invoices(organization_id, invoice_date desc);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  vendor_name text not null,
  normalized_vendor_name text not null,
  product_name text null,
  plan_name text null,
  status text not null default 'needs_review',
  source_system text not null default 'pennylane',
  source_document_id uuid null references public.pennylane_supplier_invoices(id) on delete set null,
  source_external_id text null,
  billing_frequency text not null default 'unknown',
  current_period_start date null,
  current_period_end date null,
  next_renewal_date date null,
  cancellation_deadline date null,
  notice_period_days integer null,
  auto_renew boolean null,
  recurring_amount_cents integer null,
  last_invoice_amount_cents integer null,
  currency text not null default 'EUR',
  quantity integer null,
  seats integer null,
  confidence text not null default 'low',
  confidence_reason text not null,
  extracted_fields_json jsonb not null default '{}'::jsonb,
  owner_user_id uuid null,
  owner_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz null,
  constraint contracts_status_check check (
    status in ('active', 'inactive', 'needs_review', 'ignored')
  ),
  constraint contracts_source_system_check check (
    source_system in ('pennylane', 'manual', 'sso', 'other')
  ),
  constraint contracts_billing_frequency_check check (
    billing_frequency in ('monthly', 'annual', 'quarterly', 'unknown')
  ),
  constraint contracts_confidence_check check (
    confidence in ('high', 'medium', 'low')
  )
);

create unique index contracts_org_source_external_idx
  on public.contracts(organization_id, source_system, source_external_id);

create unique index contracts_org_source_document_idx
  on public.contracts(organization_id, source_document_id)
  where source_document_id is not null;

create index contracts_next_renewal_date_idx
  on public.contracts(organization_id, next_renewal_date);

create index contracts_normalized_vendor_name_idx
  on public.contracts(organization_id, normalized_vendor_name);

create index contracts_status_idx
  on public.contracts(organization_id, status);

create table public.vendor_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  canonical_name text not null,
  alias text not null,
  normalized_alias text not null,
  domain text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_aliases_org_alias_key unique (
    organization_id,
    normalized_alias
  )
);

create index vendor_aliases_domain_idx
  on public.vendor_aliases(organization_id, domain);

create table public.contract_app_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contract_id uuid null references public.contracts(id) on delete cascade,
  sso_supplier_id uuid null references public.saas_suppliers(id) on delete cascade,
  matched_app_name text null,
  matched_app_domain text null,
  match_status text not null,
  match_score numeric not null default 0,
  match_reason text not null,
  matched_by text not null default 'automatic',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_app_links_status_check check (
    match_status in (
      'matched',
      'possible_match',
      'missing_contract',
      'orphan_contract',
      'ignored'
    )
  ),
  constraint contract_app_links_matched_by_check check (
    matched_by in ('automatic', 'manual')
  )
);

create unique index contract_app_links_org_contract_supplier_idx
  on public.contract_app_links(organization_id, contract_id, sso_supplier_id)
  where contract_id is not null and sso_supplier_id is not null;

create unique index contract_app_links_org_missing_supplier_idx
  on public.contract_app_links(organization_id, sso_supplier_id, match_status)
  where contract_id is null and sso_supplier_id is not null;

create unique index contract_app_links_org_orphan_contract_idx
  on public.contract_app_links(organization_id, contract_id, match_status)
  where contract_id is not null and sso_supplier_id is null;

create index contract_app_links_sso_supplier_idx
  on public.contract_app_links(organization_id, sso_supplier_id);

create index contract_app_links_match_status_idx
  on public.contract_app_links(organization_id, match_status);

create or replace function public.set_pennylane_contracts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger pennylane_sync_runs_updated_at
  before update on public.pennylane_sync_runs
  for each row
  execute function public.set_pennylane_contracts_updated_at();

create trigger pennylane_supplier_invoices_updated_at
  before update on public.pennylane_supplier_invoices
  for each row
  execute function public.set_pennylane_contracts_updated_at();

create trigger contracts_updated_at
  before update on public.contracts
  for each row
  execute function public.set_pennylane_contracts_updated_at();

create trigger contract_app_links_updated_at
  before update on public.contract_app_links
  for each row
  execute function public.set_pennylane_contracts_updated_at();

create trigger vendor_aliases_updated_at
  before update on public.vendor_aliases
  for each row
  execute function public.set_pennylane_contracts_updated_at();
