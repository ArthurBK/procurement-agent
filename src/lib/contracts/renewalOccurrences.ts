export type RenewalOccurrenceInput = {
  billingFrequency: string;
  contractId: string;
  nextRenewalDate: string | null;
  status: string;
  timelineDate?: string | null;
};

export type RenewalOccurrence<T extends RenewalOccurrenceInput> = {
  item: T;
  key: string;
  renewalDate: string;
};

export function buildRenewalOccurrences<T extends RenewalOccurrenceInput>({
  renewals,
  windowEnd,
  windowStart,
}: {
  renewals: T[];
  windowEnd: string;
  windowStart: string;
}): Array<RenewalOccurrence<T>> {
  return renewals
    .flatMap((renewal) =>
      buildOccurrencesForRenewal({
        renewal,
        windowEnd,
        windowStart,
      }),
    )
    .sort((left, right) => left.renewalDate.localeCompare(right.renewalDate));
}

export function addDaysIsoDate(value: string, days: number): string {
  const date = parseIsoDateParts(value);

  if (!date) {
    return value;
  }

  const next = new Date(Date.UTC(date.year, date.month - 1, date.day));
  next.setUTCDate(next.getUTCDate() + days);

  return toIsoDate(next);
}

function buildOccurrencesForRenewal<T extends RenewalOccurrenceInput>({
  renewal,
  windowEnd,
  windowStart,
}: {
  renewal: T;
  windowEnd: string;
  windowStart: string;
}): Array<RenewalOccurrence<T>> {
  const baseDate = normalizeIsoDate(renewal.timelineDate ?? renewal.nextRenewalDate);

  if (!baseDate) {
    return [];
  }

  const frequency = shouldRepeatRenewal(renewal)
    ? renewal.billingFrequency
    : "unknown";
  const firstDate = moveToWindowStart({
    date: baseDate,
    frequency,
    windowStart,
  });

  if (!firstDate || firstDate > windowEnd) {
    return [];
  }

  const occurrences: Array<RenewalOccurrence<T>> = [];
  let current: string | null = firstDate;
  let index = 0;

  while (current && current <= windowEnd && index < 240) {
    occurrences.push({
      item: renewal,
      key: `${renewal.contractId}:${current}:${index}`,
      renewalDate: current,
    });
    current = nextOccurrenceDate(current, frequency);
    index += 1;
  }

  return occurrences;
}

function shouldRepeatRenewal(renewal: RenewalOccurrenceInput): boolean {
  return Boolean(renewal.nextRenewalDate) && renewal.status !== "possibly_cancelled";
}

function moveToWindowStart({
  date,
  frequency,
  windowStart,
}: {
  date: string;
  frequency: string;
  windowStart: string;
}): string | null {
  let current: string | null = date;
  let guard = 0;

  while (current < windowStart && guard < 240) {
    current = nextOccurrenceDate(current, frequency);
    guard += 1;

    if (!current) {
      return null;
    }
  }

  return current;
}

function nextOccurrenceDate(date: string, frequency: string): string | null {
  if (frequency === "weekly") {
    return addDaysIsoDate(date, 7);
  }

  if (frequency === "monthly") {
    return addMonthsIsoDate(date, 1);
  }

  if (frequency === "quarterly") {
    return addMonthsIsoDate(date, 3);
  }

  if (frequency === "annual") {
    return addMonthsIsoDate(date, 12);
  }

  return null;
}

function addMonthsIsoDate(value: string, months: number): string | null {
  const date = parseIsoDateParts(value);

  if (!date) {
    return null;
  }

  const firstOfTargetMonth = new Date(
    Date.UTC(date.year, date.month - 1 + months, 1),
  );
  const targetYear = firstOfTargetMonth.getUTCFullYear();
  const targetMonth = firstOfTargetMonth.getUTCMonth() + 1;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth, 0),
  ).getUTCDate();
  const targetDay = Math.min(date.day, lastDayOfTargetMonth);

  return [
    targetYear,
    String(targetMonth).padStart(2, "0"),
    String(targetDay).padStart(2, "0"),
  ].join("-");
}

function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})$/);

  return match?.[1] ?? null;
}

function parseIsoDateParts(
  value: string,
): { day: number; month: number; year: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  return {
    day: Number(match[3]),
    month: Number(match[2]),
    year: Number(match[1]),
  };
}

function toIsoDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
