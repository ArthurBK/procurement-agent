import type { BusinessCategory } from "./classifyRecurringCandidate";
import type { RecurringPaymentCandidateBase } from "./detectRecurringPaymentCandidates";

type Frequency = RecurringPaymentCandidateBase["frequency"];
type BillingModel = RecurringPaymentCandidateBase["billingModel"];
type UserDecision = "confirmed" | "ignored" | null;

export type RecurringCandidatePatchUpdate = Partial<{
  corrected_amount_cents: number | null;
  corrected_billing_model: BillingModel | null;
  corrected_business_category: BusinessCategory | null;
  corrected_currency: string | null;
  corrected_frequency: Frequency | null;
  corrected_next_payment: string | null;
  corrected_payment_method: string | null;
  corrected_supplier: string | null;
  review_notes: string | null;
  reviewed_at: string;
  user_decision: UserDecision;
}>;

export type ParsedRecurringCandidatePatch =
  | {
      hasCorrections: boolean;
      hasUserDecision: boolean;
      ok: true;
      update: RecurringCandidatePatchUpdate;
    }
  | { errors: string[]; ok: false };

const FREQUENCIES = [
  "weekly",
  "monthly",
  "quarterly",
  "annually",
  "unknown",
] as const satisfies readonly Frequency[];

const BILLING_MODELS = [
  "fixed",
  "variable",
  "unknown",
] as const satisfies readonly BillingModel[];

const BUSINESS_CATEGORIES = [
  "software",
  "cloud",
  "ai",
  "telecom",
  "banking",
  "workspace",
  "professional_service",
  "marketing",
  "food",
  "transport",
  "travel",
  "retail",
  "income",
  "unknown",
] as const satisfies readonly BusinessCategory[];

export function parseRecurringCandidatePatchBody(
  body: unknown,
): ParsedRecurringCandidatePatch {
  if (!isRecord(body)) {
    return { errors: ["Request body must be a JSON object."], ok: false };
  }

  const errors: string[] = [];
  const update: RecurringCandidatePatchUpdate = {};
  const hasUserDecision = hasOwn(body, "userDecision");
  let hasCorrections = false;

  if (hasUserDecision) {
    const userDecision = body.userDecision;

    if (
      userDecision !== "confirmed" &&
      userDecision !== "ignored" &&
      userDecision !== null
    ) {
      errors.push("userDecision must be one of: confirmed, ignored, or null.");
    } else {
      update.user_decision = userDecision;
    }
  }

  if (hasOwn(body, "correctedSupplier")) {
    const supplier = parseNullableStringField(
      body.correctedSupplier,
      "correctedSupplier",
      errors,
    );

    if (supplier.valid) {
      update.corrected_supplier = supplier.value;
    }

    hasCorrections = true;
  }

  if (hasOwn(body, "correctedFrequency")) {
    const frequency = parseNullableEnum(
      body.correctedFrequency,
      FREQUENCIES,
      "correctedFrequency",
      errors,
    );

    if (frequency.valid) {
      update.corrected_frequency = frequency.value;
    }

    hasCorrections = true;
  }

  if (hasOwn(body, "correctedAmountCents")) {
    const amountCents = body.correctedAmountCents;

    if (amountCents === null) {
      update.corrected_amount_cents = null;
    } else if (
      typeof amountCents !== "number" ||
      !Number.isInteger(amountCents) ||
      amountCents <= 0
    ) {
      errors.push("correctedAmountCents must be a positive integer.");
    } else {
      update.corrected_amount_cents = amountCents;
    }

    hasCorrections = true;
  }

  if (hasOwn(body, "correctedCurrency")) {
    const currencyField = parseNullableStringField(
      body.correctedCurrency,
      "correctedCurrency",
      errors,
    );
    const currency = currencyField.valid
      ? currencyField.value?.toUpperCase() ?? null
      : null;

    if (currencyField.valid && currency !== null && !/^[A-Z]{3}$/.test(currency)) {
      errors.push("correctedCurrency must be a 3-letter currency code.");
    } else if (currencyField.valid) {
      update.corrected_currency = currency;
    }

    hasCorrections = true;
  }

  if (hasOwn(body, "correctedNextPayment")) {
    const nextPaymentField = parseNullableStringField(
      body.correctedNextPayment,
      "correctedNextPayment",
      errors,
    );
    const nextPayment = nextPaymentField.valid ? nextPaymentField.value : null;

    if (
      nextPaymentField.valid &&
      nextPayment !== null &&
      !isIsoDate(nextPayment)
    ) {
      errors.push("correctedNextPayment must be a YYYY-MM-DD date or null.");
    } else if (nextPaymentField.valid) {
      update.corrected_next_payment = nextPayment;
    }

    hasCorrections = true;
  }

  if (hasOwn(body, "correctedPaymentMethod")) {
    const paymentMethod = parseNullableStringField(
      body.correctedPaymentMethod,
      "correctedPaymentMethod",
      errors,
    );

    if (paymentMethod.valid) {
      update.corrected_payment_method = paymentMethod.value;
    }

    hasCorrections = true;
  }

  if (hasOwn(body, "correctedBillingModel")) {
    const billingModel = parseNullableEnum(
      body.correctedBillingModel,
      BILLING_MODELS,
      "correctedBillingModel",
      errors,
    );

    if (billingModel.valid) {
      update.corrected_billing_model = billingModel.value;
    }

    hasCorrections = true;
  }

  if (hasOwn(body, "correctedBusinessCategory")) {
    const businessCategory = parseNullableEnum(
      body.correctedBusinessCategory,
      BUSINESS_CATEGORIES,
      "correctedBusinessCategory",
      errors,
    );

    if (businessCategory.valid) {
      update.corrected_business_category = businessCategory.value;
    }

    hasCorrections = true;
  }

  if (hasOwn(body, "reviewNotes")) {
    const reviewNotes = parseNullableStringField(
      body.reviewNotes,
      "reviewNotes",
      errors,
    );

    if (reviewNotes.valid) {
      update.review_notes = reviewNotes.value;
    }

    hasCorrections = true;
  }

  if (!hasUserDecision && !hasCorrections) {
    errors.push("No candidate updates were provided.");
  }

  if (errors.length > 0) {
    return { errors, ok: false };
  }

  if (hasCorrections) {
    update.reviewed_at = new Date().toISOString();
  }

  return { hasCorrections, hasUserDecision, ok: true, update };
}

function parseNullableStringField(
  value: unknown,
  fieldName: string,
  errors: string[],
): { valid: true; value: string | null } | { valid: false } {
  if (value === null) {
    return { valid: true, value: null };
  }

  if (typeof value !== "string") {
    errors.push(`${fieldName} must be a string or null.`);
    return { valid: false };
  }

  const trimmedValue = value.trim();

  return { valid: true, value: trimmedValue.length > 0 ? trimmedValue : null };
}

function parseNullableEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string,
  errors: string[],
): { valid: true; value: T | null } | { valid: false } {
  const normalizedField = parseNullableStringField(value, fieldName, errors);

  if (!normalizedField.valid) {
    return { valid: false };
  }

  const normalizedValue = normalizedField.value;

  if (normalizedValue === null) {
    return { valid: true, value: null };
  }

  if (allowedValues.includes(normalizedValue as T)) {
    return { valid: true, value: normalizedValue as T };
  }

  errors.push(`${fieldName} has an unsupported value.`);

  return { valid: false };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
