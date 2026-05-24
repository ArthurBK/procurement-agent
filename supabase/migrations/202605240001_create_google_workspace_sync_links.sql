create table public.google_workspace_sync_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by_user_id uuid null,
  oauth_state text null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  sync_started_at timestamptz null,
  sync_completed_at timestamptz null,
  last_error text null
);

create index google_workspace_sync_links_token_hash_idx
  on public.google_workspace_sync_links(token_hash);

create index google_workspace_sync_links_organization_created_idx
  on public.google_workspace_sync_links(organization_id, created_at desc);

create index google_workspace_sync_links_oauth_state_idx
  on public.google_workspace_sync_links(oauth_state)
  where oauth_state is not null;
