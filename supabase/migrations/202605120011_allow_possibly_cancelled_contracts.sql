do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'contracts_status_check'
      and conrelid = 'public.contracts'::regclass
  ) then
    alter table public.contracts
      drop constraint contracts_status_check;
  end if;
end $$;

alter table public.contracts
  add constraint contracts_status_check check (
    status in (
      'active',
      'inactive',
      'needs_review',
      'ignored',
      'possibly_cancelled'
    )
  );
