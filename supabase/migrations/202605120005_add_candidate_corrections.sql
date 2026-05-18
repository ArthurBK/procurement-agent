alter table public.recurring_payment_candidates
  add column if not exists corrected_supplier text null,
  add column if not exists corrected_frequency text null,
  add column if not exists corrected_amount_cents integer null,
  add column if not exists corrected_currency text null,
  add column if not exists corrected_next_payment date null,
  add column if not exists corrected_payment_method text null,
  add column if not exists corrected_billing_model text null,
  add column if not exists corrected_business_category text null,
  add column if not exists review_notes text null,
  add column if not exists reviewed_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_payment_candidates_corrected_frequency_check'
      and conrelid = 'public.recurring_payment_candidates'::regclass
  ) then
    alter table public.recurring_payment_candidates
      add constraint recurring_payment_candidates_corrected_frequency_check check (
        corrected_frequency is null
        or corrected_frequency in ('weekly', 'monthly', 'quarterly', 'annually', 'unknown')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_payment_candidates_corrected_amount_cents_check'
      and conrelid = 'public.recurring_payment_candidates'::regclass
  ) then
    alter table public.recurring_payment_candidates
      add constraint recurring_payment_candidates_corrected_amount_cents_check check (
        corrected_amount_cents is null
        or corrected_amount_cents > 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_payment_candidates_corrected_currency_check'
      and conrelid = 'public.recurring_payment_candidates'::regclass
  ) then
    alter table public.recurring_payment_candidates
      add constraint recurring_payment_candidates_corrected_currency_check check (
        corrected_currency is null
        or corrected_currency ~ '^[A-Z]{3}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_payment_candidates_corrected_billing_model_check'
      and conrelid = 'public.recurring_payment_candidates'::regclass
  ) then
    alter table public.recurring_payment_candidates
      add constraint recurring_payment_candidates_corrected_billing_model_check check (
        corrected_billing_model is null
        or corrected_billing_model in ('fixed', 'variable', 'unknown')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_payment_candidates_corrected_business_category_check'
      and conrelid = 'public.recurring_payment_candidates'::regclass
  ) then
    alter table public.recurring_payment_candidates
      add constraint recurring_payment_candidates_corrected_business_category_check check (
        corrected_business_category is null
        or corrected_business_category in (
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
