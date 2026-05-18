alter table public.recurring_payment_candidates
  add column if not exists review_bucket text not null default 'needs_review',
  add column if not exists decision_source text null,
  add column if not exists decision_reason text null,
  add column if not exists auto_decided_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_payment_candidates_review_bucket_check'
      and conrelid = 'public.recurring_payment_candidates'::regclass
  ) then
    alter table public.recurring_payment_candidates
      add constraint recurring_payment_candidates_review_bucket_check check (
        review_bucket in ('auto_accepted', 'needs_review', 'auto_ignored')
      );
  end if;
end;
$$;

create index if not exists recurring_payment_candidates_review_bucket_idx
  on public.recurring_payment_candidates(review_bucket);

create index if not exists recurring_payment_candidates_decision_source_idx
  on public.recurring_payment_candidates(decision_source);
