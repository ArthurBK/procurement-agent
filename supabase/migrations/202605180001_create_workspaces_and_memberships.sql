create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  primary_domain text null,
  created_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_primary_domain_key unique (primary_domain)
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  email text not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_members_role_check check (role in ('owner', 'member')),
  constraint organization_members_org_user_key unique (organization_id, user_id),
  constraint organization_members_org_email_key unique (organization_id, email)
);

create index if not exists organization_members_user_id_idx
  on public.organization_members(user_id);

create index if not exists organization_members_organization_id_idx
  on public.organization_members(organization_id);

insert into public.organizations (id, name, slug, primary_domain, created_by_user_id)
values (
  '00000000-0000-4000-8000-000000000001',
  'Legacy workspace',
  'legacy-workspace',
  null,
  null
)
on conflict (id) do nothing;

create or replace function public.set_organizations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_updated_at on public.organizations;

create trigger organizations_updated_at
  before update on public.organizations
  for each row
  execute function public.set_organizations_updated_at();

drop trigger if exists organization_members_updated_at on public.organization_members;

create trigger organization_members_updated_at
  before update on public.organization_members
  for each row
  execute function public.set_organizations_updated_at();
