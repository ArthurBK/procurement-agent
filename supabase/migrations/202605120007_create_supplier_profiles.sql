create table public.supplier_profiles (
  id uuid primary key default gen_random_uuid(),
  supplier_key text not null unique,
  display_name text not null,
  domain text null,
  logo_url text null,
  logo_source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_profiles_logo_source_check check (
    logo_source in ('manual', 'logo_dev', 'uploaded', 'none')
  )
);

create index supplier_profiles_supplier_key_idx
  on public.supplier_profiles(supplier_key);

create index supplier_profiles_domain_idx
  on public.supplier_profiles(domain);

create or replace function public.set_supplier_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger supplier_profiles_updated_at
  before update on public.supplier_profiles
  for each row
  execute function public.set_supplier_profiles_updated_at();
