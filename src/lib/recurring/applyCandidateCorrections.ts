import type { BusinessCategory } from "./classifyRecurringCandidate";
import type { RecurringPaymentCandidateBase } from "./detectRecurringPaymentCandidates";

export type CandidateFrequency = RecurringPaymentCandidateBase["frequency"];
export type CandidateBillingModel = RecurringPaymentCandidateBase["billingModel"];

export type CandidateWithCorrections = {
  amount_cents: number;
  billing_model: CandidateBillingModel;
  business_category: BusinessCategory;
  corrected_amount_cents: number | null;
  corrected_billing_model: CandidateBillingModel | null;
  corrected_business_category: BusinessCategory | null;
  corrected_currency: string | null;
  corrected_frequency: CandidateFrequency | null;
  corrected_next_payment: string | null;
  corrected_payment_method: string | null;
  corrected_supplier: string | null;
  currency: string;
  evidence: Record<string, unknown>;
  frequency: CandidateFrequency;
  next_payment: string | null;
  payment_method: string | null;
  review_notes: string | null;
  supplier: string;
};

export type AppliedCandidateCorrections = {
  amountCents: number;
  billingModel: CandidateBillingModel;
  businessCategory: BusinessCategory;
  correctedFields: string[];
  currency: string;
  evidencePatch: Record<string, unknown>;
  frequency: CandidateFrequency;
  nextPayment: string | null;
  paymentMethod: string | null;
  supplier: string;
};

export function applyCandidateCorrections(
  candidate: CandidateWithCorrections,
): AppliedCandidateCorrections {
  const correctedFields: string[] = [];
  const supplier = applyCorrection(
    "supplier",
    candidate.supplier,
    candidate.corrected_supplier,
    correctedFields,
  );
  const frequency = applyCorrection(
    "frequency",
    candidate.frequency,
    candidate.corrected_frequency,
    correctedFields,
  );
  const amountCents = applyCorrection(
    "amount_cents",
    candidate.amount_cents,
    candidate.corrected_amount_cents,
    correctedFields,
  );
  const currency = applyCorrection(
    "currency",
    candidate.currency,
    candidate.corrected_currency,
    correctedFields,
  );
  const nextPayment = applyCorrection(
    "next_payment",
    candidate.next_payment,
    candidate.corrected_next_payment,
    correctedFields,
  );
  const paymentMethod = applyCorrection(
    "payment_method",
    candidate.payment_method,
    candidate.corrected_payment_method,
    correctedFields,
  );
  const billingModel = applyCorrection(
    "billing_model",
    candidate.billing_model,
    candidate.corrected_billing_model,
    correctedFields,
  );
  const businessCategory = applyCorrection(
    "business_category",
    candidate.business_category,
    candidate.corrected_business_category,
    correctedFields,
  );
  const reviewNotes = normalizeNullableString(candidate.review_notes);
  const evidencePatch =
    correctedFields.length > 0 || reviewNotes
      ? {
          corrected_fields: correctedFields,
          review_notes: reviewNotes,
          used_corrections: true,
        }
      : {};

  return {
    amountCents,
    billingModel,
    businessCategory,
    correctedFields,
    currency,
    evidencePatch,
    frequency,
    nextPayment,
    paymentMethod,
    supplier,
  };
}

function applyCorrection<T>(
  fieldName: string,
  detectedValue: T,
  correctedValue: T | null,
  correctedFields: string[],
): T {
  if (correctedValue === null) {
    return detectedValue;
  }

  if (correctedValue !== detectedValue) {
    correctedFields.push(fieldName);
  }

  return correctedValue;
}

function normalizeNullableString(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}
