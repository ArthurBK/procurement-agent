create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  provider text not null,
  status text not null default 'not_connected',
  connected_by_user_id uuid null,
  connected_admin_email text null,
  granted_scopes jsonb not null default '[]'::jsonb,
  encrypted_access_token text null,
  encrypted_refresh_token text null,
  access_token_expires_at timestamptz null,
  last_sync_started_at timestamptz null,
  last_sync_completed_at timestamptz null,
  last_error text null,
  data_retention_days integer not null default 180,
  delete_synced_data_on_disconnect boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integrations_provider_check check (
    provider in ('google_workspace')
  ),
  constraint integrations_status_check check (
    status in (
      'not_connected',
      'connected',
      'syncing',
      'error',
      'disconnected',
      'connected_but_insufficient_permissions',
      'failed_permissions',
      'permission_error',
      'revoked'
    )
  ),
  constraint integrations_provider_organization_key unique (
    organization_id,
    provider
  )
);

create index integrations_organization_provider_idx
  on public.integrations(organization_id, provider);

create table public.google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  organization_id uuid not null,
  user_id uuid null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null
);

create index google_oauth_states_state_idx
  on public.google_oauth_states(state);

create table public.google_workspace_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  google_user_id text not null,
  primary_email text not null,
  full_name text null,
  suspended boolean not null default false,
  archived boolean not null default false,
  org_unit_path text null,
  aliases_json jsonb not null default '[]'::jsonb,
  creation_time timestamptz null,
  last_login_time timestamptz null,
  is_admin boolean null,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  constraint google_workspace_users_org_google_user_key unique (
    organization_id,
    google_user_id
  )
);

create index google_workspace_users_organization_id_idx
  on public.google_workspace_users(organization_id);

create index google_workspace_users_primary_email_idx
  on public.google_workspace_users(organization_id, primary_email);

create table public.google_oauth_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  google_event_id text not null,
  user_email text null,
  app_name text null,
  oauth_client_id text null,
  event_name text not null,
  event_time timestamptz not null,
  scopes_json jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  constraint google_oauth_events_org_event_key unique (
    organization_id,
    google_event_id
  )
);

create index google_oauth_events_organization_time_idx
  on public.google_oauth_events(organization_id, event_time desc);

create index google_oauth_events_app_idx
  on public.google_oauth_events(organization_id, app_name);

create table public.google_saml_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  google_event_id text not null,
  user_email text null,
  saml_app_name text null,
  event_name text not null,
  event_time timestamptz not null,
  success boolean null,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  constraint google_saml_events_org_event_key unique (
    organization_id,
    google_event_id
  )
);

create index google_saml_events_organization_time_idx
  on public.google_saml_events(organization_id, event_time desc);

create index google_saml_events_app_idx
  on public.google_saml_events(organization_id, saml_app_name);

create table public.google_login_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  google_event_id text not null,
  user_email text null,
  event_name text not null,
  event_time timestamptz not null,
  login_type text null,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  constraint google_login_events_org_event_key unique (
    organization_id,
    google_event_id
  )
);

create index google_login_events_organization_time_idx
  on public.google_login_events(organization_id, event_time desc);

create table public.google_authorized_apps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  app_name text not null,
  users_count integer not null default 0,
  report_date date not null,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  constraint google_authorized_apps_org_app_date_key unique (
    organization_id,
    app_name,
    report_date
  )
);

create index google_authorized_apps_organization_date_idx
  on public.google_authorized_apps(organization_id, report_date desc);

create table public.saas_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  supplier_name text not null,
  supplier_domain text null,
  monthly_spend integer null,
  category text null,
  source text not null default 'finance',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saas_suppliers_org_name_domain_key unique (
    organization_id,
    supplier_name,
    supplier_domain
  )
);

create index saas_suppliers_organization_id_idx
  on public.saas_suppliers(organization_id);

create index saas_suppliers_domain_idx
  on public.saas_suppliers(organization_id, supplier_domain);

create table public.supplier_identity_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  supplier_id uuid not null references public.saas_suppliers(id) on delete cascade,
  matched_app_name text null,
  matched_app_domain text null,
  match_source text not null,
  match_confidence numeric not null default 0,
  users_with_signal_30d integer not null default 0,
  users_with_signal_90d integer not null default 0,
  users_with_signal_180d integer not null default 0,
  last_signal_at timestamptz null,
  identity_mode text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_identity_matches_identity_mode_check check (
    identity_mode in ('saml', 'oauth', 'authorized_app', 'token', 'login_only', 'unknown')
  ),
  constraint supplier_identity_matches_source_check check (
    match_source in ('domain', 'normalized_name', 'known_alias', 'fuzzy', 'none')
  ),
  constraint supplier_identity_matches_org_supplier_source_key unique (
    organization_id,
    supplier_id,
    match_source,
    matched_app_name
  )
);

create index supplier_identity_matches_organization_id_idx
  on public.supplier_identity_matches(organization_id);

create table public.integration_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  integration_id uuid null references public.integrations(id) on delete set null,
  provider text not null,
  action text not null,
  actor_user_id uuid null,
  message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index integration_audit_logs_organization_created_idx
  on public.integration_audit_logs(organization_id, created_at desc);

create or replace function public.set_integrations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger integrations_updated_at
  before update on public.integrations
  for each row
  execute function public.set_integrations_updated_at();

create trigger saas_suppliers_updated_at
  before update on public.saas_suppliers
  for each row
  execute function public.set_integrations_updated_at();

create trigger supplier_identity_matches_updated_at
  before update on public.supplier_identity_matches
  for each row
  execute function public.set_integrations_updated_at();
