import type { BillingFrequency, InferredContract } from "./extraction.ts";

export type ContractLifecycleStatus =
  | "active"
  | "inactive"
  | "needs_review"
  | "ignored"
  | "possibly_cancelled";

export type ContractCancellationReview = {
  daysOverdue: number;
  expectedRenewalDate: string;
  graceDays: number;
  lastInvoiceDate: string | null;
  reason: string;
};

type ContractCancellationReviewInput = {
  billingFrequency: BillingFrequency;
  extractedFields: Record<string, unknown>;
  nextRenewalDate: string | null;
  status: ContractLifecycleStatus;
  vendorName: string;
};

export function applyContractLifecycleStatus({
  contract,
  today = new Date(),
}: {
  contract: InferredContract;
  today?: Date;
}): InferredContract {
  const cancellationReview = getPossibleCancellationReview({
    contract,
    today,
  });

  if (!cancellationReview) {
    return contract;
  }

  return {
    ...contract,
    confidenceReason: cancellationReview.reason,
    extractedFields: {
      ...contract.extractedFields,
      lifecycle_review: {
        days_overdue: cancellationReview.daysOverdue,
        expected_renewal_date: cancellationReview.expectedRenewalDate,
        grace_days: cancellationReview.graceDays,
        last_invoice_date: cancellationReview.lastInvoiceDate,
        reason: cancellationReview.reason,
        status: "possibly_cancelled",
      },
    },
    status: "possibly_cancelled",
  };
}

export function getPossibleCancellationReview({
  contract,
  today = new Date(),
}: {
  contract: ContractCancellationReviewInput;
  today?: Date;
}): ContractCancellationReview | null {
  if (contract.status === "inactive" || contract.status === "ignored") {
    return null;
  }

  const graceDays = getCancellationGraceDays(contract.billingFrequency);

  if (graceDays === null) {
    return null;
  }

  const lastInvoiceDate = getLatestInvoiceDate(contract.extractedFields);
  const expectedRenewalDate =
    contract.nextRenewalDate ??
    (lastInvoiceDate
      ? addFrequencyIsoDate(lastInvoiceDate, contract.billingFrequency)
      : null);

  if (!expectedRenewalDate) {
    return null;
  }

  const todayIso = toIsoDate(today);
  const staleAfter = addDaysIso(expectedRenewalDate, graceDays);

  if (todayIso <= staleAfter) {
    return null;
  }

  const daysOverdue = differenceInDays(todayIso, expectedRenewalDate);
  const frequencyLabel = formatFrequency(contract.billingFrequency);
  const lastInvoiceText = lastInvoiceDate
    ? ` Last invoice was ${lastInvoiceDate}.`
    : "";

  return {
    daysOverdue,
    expectedRenewalDate,
    graceDays,
    lastInvoiceDate,
    reason: `Possible cancellation: expected next ${frequencyLabel} invoice around ${expectedRenewalDate}, but no newer Pennylane invoice was found.${lastInvoiceText}`,
  };
}

export function getCancellationGraceDays(
  frequency: BillingFrequency,
): number | null {
  if (frequency === "monthly") {
    return 45;
  }

  if (frequency === "quarterly") {
    return 120;
  }

  if (frequency === "annual") {
    return 400;
  }

  return null;
}

function getLatestInvoiceDate(fields: Record<string, unknown>): string | null {
  const dates = fields.invoice_dates;

  if (!Array.isArray(dates)) {
    return null;
  }

  return dates
    .filter((date): date is string => /^\d{4}-\d{2}-\d{2}$/.test(String(date)))
    .sort()
    .at(-1) ?? null;
}

function addFrequencyIsoDate(
  value: string,
  frequency: BillingFrequency,
): string | null {
  if (frequency === "monthly") {
    return addMonthsIsoDate(value, 1);
  }

  if (frequency === "quarterly") {
    return addMonthsIsoDate(value, 3);
  }

  if (frequency === "annual") {
    return addMonthsIsoDate(value, 12);
  }

  return null;
}

function addMonthsIsoDate(value: string, months: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const lastDayOfTargetMonth = new Date(year, month - 1 + months + 1, 0).getDate();
  const date = new Date(
    Date.UTC(year, month - 1 + months, Math.min(day, lastDayOfTargetMonth)),
  );

  return date.toISOString().slice(0, 10);
}

function addDaysIso(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function differenceInDays(left: string, right: string): number {
  const leftTime = new Date(`${left}T00:00:00.000Z`).getTime();
  const rightTime = new Date(`${right}T00:00:00.000Z`).getTime();

  return Math.max(0, Math.floor((leftTime - rightTime) / 86_400_000));
}

function formatFrequency(frequency: BillingFrequency): string {
  if (frequency === "annual") {
    return "annual";
  }

  return frequency;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
