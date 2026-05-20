export type ContractReviewAction = "confirm_cancellation" | "keep_active";

export type ContractReviewUpdateInput = {
  action: ContractReviewAction;
  currentReason: string;
  currentStatus: string;
  existingFields: Record<string, unknown>;
  reviewedAt: string;
};

export type ContractReviewUpdate = {
  confidenceReason: string;
  extractedFields: Record<string, unknown>;
  status: "active" | "inactive";
};

export type ExistingManualContractReview = {
  confidenceReason: string;
  extractedFields: Record<string, unknown>;
  status: string;
};

export function buildContractReviewUpdate({
  action,
  currentReason,
  currentStatus,
  existingFields,
  reviewedAt,
}: ContractReviewUpdateInput): ContractReviewUpdate {
  const manualReview = {
    action,
    previous_confidence_reason: currentReason,
    previous_status: currentStatus,
    reviewed_at: reviewedAt,
  };

  if (action === "confirm_cancellation") {
    return {
      confidenceReason: `Cancellation confirmed manually on ${reviewedAt.slice(0, 10)}.`,
      extractedFields: {
        ...existingFields,
        manual_review: manualReview,
      },
      status: "inactive",
    };
  }

  return {
    confidenceReason: `Marked active manually on ${reviewedAt.slice(0, 10)}. Update Pennylane or the billing source if a newer invoice exists.`,
    extractedFields: {
      ...existingFields,
      manual_review: manualReview,
    },
    status: "active",
  };
}

export function isContractReviewAction(
  value: unknown,
): value is ContractReviewAction {
  return value === "confirm_cancellation" || value === "keep_active";
}

export function applyManualContractReviewOverride({
  existingReview,
  nextFields,
  nextReason,
  nextStatus,
}: {
  existingReview: ExistingManualContractReview | null;
  nextFields: Record<string, unknown>;
  nextReason: string;
  nextStatus: string;
}): {
  confidenceReason: string;
  extractedFields: Record<string, unknown>;
  status: string;
} {
  const manualReview = getManualReview(existingReview?.extractedFields);

  if (!existingReview || !manualReview) {
    return {
      confidenceReason: nextReason,
      extractedFields: nextFields,
      status: nextStatus,
    };
  }

  const reviewedAtDate = parseIsoDate(manualReview.reviewed_at);
  const latestInvoiceDate = getLatestInvoiceDate(nextFields);

  if (reviewedAtDate && latestInvoiceDate && latestInvoiceDate > reviewedAtDate) {
    return {
      confidenceReason: nextReason,
      extractedFields: removeManualReview(nextFields),
      status: nextStatus,
    };
  }

  return {
    confidenceReason: existingReview.confidenceReason,
    extractedFields: {
      ...nextFields,
      manual_review: manualReview,
    },
    status: existingReview.status,
  };
}

function getManualReview(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const value = fields?.manual_review;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const action = (value as Record<string, unknown>).action;

  return isContractReviewAction(action) ? (value as Record<string, unknown>) : null;
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

function parseIsoDate(value: unknown): string | null {
  return typeof value === "string" ? value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null : null;
}

function removeManualReview(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const rest = { ...fields };
  delete rest.manual_review;

  return rest;
}
