import type { CandidateClassification } from "./classifyRecurringCandidate.ts";
import type { RecurringPaymentCandidateBase } from "./detectRecurringPaymentCandidates.ts";
import type { SupplierRule } from "../supplierRules/types.ts";

export type ReviewBucket = "auto_accepted" | "needs_review" | "auto_ignored";

export type RecurringCandidateTriage = {
  reviewBucket: ReviewBucket;
  decisionSource: "supplier_rule" | "high_confidence" | "low_confidence" | "classifier";
  decisionReason: string;
  shouldAutoAccept: boolean;
  shouldAutoIgnore: boolean;
};

export function triageRecurringCandidate({
  candidate,
  classification,
  supplierRule,
}: {
  candidate: RecurringPaymentCandidateBase;
  classification: CandidateClassification;
  supplierRule?: SupplierRule | null;
}): RecurringCandidateTriage {
  if (supplierRule?.active && supplierRule.match_type === "exact_supplier_key") {
    if (supplierRule.default_decision === "auto_subscription") {
      return {
        decisionReason: "Matched active supplier rule: accept",
        decisionSource: "supplier_rule",
        reviewBucket: "auto_accepted",
        shouldAutoAccept: true,
        shouldAutoIgnore: false,
      };
    }

    if (supplierRule.default_decision === "excluded") {
      return {
        decisionReason: "Matched active supplier rule: ignore",
        decisionSource: "supplier_rule",
        reviewBucket: "auto_ignored",
        shouldAutoAccept: false,
        shouldAutoIgnore: true,
      };
    }
  }

  if (hasMajorityPositiveTransactions(candidate.evidence)) {
    return {
      decisionReason: "Majority positive transactions look like income or payouts",
      decisionSource: "classifier",
      reviewBucket: "auto_ignored",
      shouldAutoAccept: false,
      shouldAutoIgnore: true,
    };
  }

  if (isClearNonSubscription(classification)) {
    return {
      decisionReason: `Clear non-subscription classification: ${formatReason(
        classification.reason,
      )}`,
      decisionSource: "classifier",
      reviewBucket: "auto_ignored",
      shouldAutoAccept: false,
      shouldAutoIgnore: true,
    };
  }

  if (isHighConfidenceSubscription(candidate, classification)) {
    const amountStable = candidate.evidence.amount_stable;

    return {
      decisionReason:
        amountStable === false
          ? "High-confidence recurring pattern with variable amount"
          : "High-confidence recurring subscription pattern",
      decisionSource: "high_confidence",
      reviewBucket: "auto_accepted",
      shouldAutoAccept: true,
      shouldAutoIgnore: false,
    };
  }

  if (isStrongBusinessSignalSubscription(candidate, classification)) {
    return {
      decisionReason:
        candidate.evidence.amount_stable === false
          ? "Strong business subscription signal with variable recurring amount"
          : "Strong business subscription signal with recurring pattern",
      decisionSource: "high_confidence",
      reviewBucket: "auto_accepted",
      shouldAutoAccept: true,
      shouldAutoIgnore: false,
    };
  }

  if (isWeakUnknownCandidate(candidate, classification)) {
    return {
      decisionReason:
        "Weak unknown recurrence without business subscription signals",
      decisionSource: "classifier",
      reviewBucket: "auto_ignored",
      shouldAutoAccept: false,
      shouldAutoIgnore: true,
    };
  }

  return {
    decisionReason: getNeedsReviewReason(candidate, classification),
    decisionSource:
      candidate.recurrenceConfidence < 0.85 ? "low_confidence" : "classifier",
    reviewBucket: "needs_review",
    shouldAutoAccept: false,
    shouldAutoIgnore: false,
  };
}

function isHighConfidenceSubscription(
  candidate: RecurringPaymentCandidateBase,
  classification: CandidateClassification,
): boolean {
  if (
    classification.systemDecision !== "auto_subscription" ||
    classification.classificationConfidence < 0.85 ||
    candidate.recurrenceConfidence < 0.85 ||
    hasStrongWarningFlags(candidate, classification)
  ) {
    return false;
  }

  if (
    !["weekly", "monthly", "quarterly", "annually"].includes(
      candidate.frequency,
    )
  ) {
    return false;
  }

  if (candidate.frequency === "annually") {
    return candidate.transactionsCount >= 2;
  }

  return candidate.transactionsCount >= 3;
}

function isStrongBusinessSignalSubscription(
  candidate: RecurringPaymentCandidateBase,
  classification: CandidateClassification,
): boolean {
  if (
    classification.systemDecision !== "auto_subscription" ||
    classification.classificationConfidence < 0.85 ||
    candidate.recurrenceConfidence < 0.75 ||
    hasStrongWarningFlags(candidate, classification) ||
    !hasBusinessSubscriptionSignal(classification)
  ) {
    return false;
  }

  if (candidate.frequency === "monthly") {
    return candidate.transactionsCount >= 3;
  }

  if (candidate.frequency === "quarterly" || candidate.frequency === "annually") {
    return candidate.transactionsCount >= 2;
  }

  return false;
}

function hasStrongWarningFlags(
  candidate: RecurringPaymentCandidateBase,
  classification: CandidateClassification,
): boolean {
  if (classification.businessCategory === "income") {
    return true;
  }

  if (hasMajorityPositiveTransactions(candidate.evidence)) {
    return true;
  }

  const warningFlags = candidate.evidence.warning_flags;

  return Array.isArray(warningFlags) && warningFlags.length > 0;
}

function hasBusinessSubscriptionSignal(
  classification: CandidateClassification,
): boolean {
  if (classification.reason.startsWith("supplier_rule:")) {
    return true;
  }

  return (
    classification.signals.signal === "merchant_rule" ||
    classification.signals.signal === "accounting_category"
  );
}

function isClearNonSubscription(
  classification: CandidateClassification,
): boolean {
  if (classification.systemDecision !== "excluded") {
    return false;
  }

  if (
    classification.businessCategory === "income" &&
    classification.classificationConfidence >= 0.9
  ) {
    return true;
  }

  if (
    ["food", "transport", "travel", "retail"].includes(
      classification.businessCategory,
    ) &&
    classification.classificationConfidence >= 0.85
  ) {
    return true;
  }

  return (
    classification.classificationConfidence >= 0.9 &&
    /(payout|income|transfer|tax|payroll|non[-_ ]?subscription)/i.test(
      classification.reason,
    )
  );
}

function isWeakUnknownCandidate(
  candidate: RecurringPaymentCandidateBase,
  classification: CandidateClassification,
): boolean {
  if (
    classification.systemDecision !== "needs_review" ||
    classification.businessCategory !== "unknown"
  ) {
    return false;
  }

  if (candidate.amountCents < 5_000) {
    return true;
  }

  if (candidate.transactionsCount < 3 && candidate.amountCents < 10_000) {
    return true;
  }

  return (
    candidate.billingModel === "variable" &&
    candidate.recurrenceConfidence < 0.85 &&
    candidate.amountCents < 10_000
  );
}

function hasMajorityPositiveTransactions(
  evidence: Record<string, unknown>,
): boolean {
  const signsSummary = evidence.signs_summary;

  if (
    typeof signsSummary !== "object" ||
    signsSummary === null ||
    Array.isArray(signsSummary)
  ) {
    return false;
  }

  const positiveCount = (signsSummary as Record<string, unknown>).positive_count;
  const negativeCount = (signsSummary as Record<string, unknown>).negative_count;

  return (
    typeof positiveCount === "number" &&
    typeof negativeCount === "number" &&
    positiveCount > negativeCount
  );
}

function getNeedsReviewReason(
  candidate: RecurringPaymentCandidateBase,
  classification: CandidateClassification,
): string {
  if (candidate.frequency === "annually" && candidate.transactionsCount < 2) {
    return "Annual pattern has too little transaction history";
  }

  if (candidate.transactionsCount < 3) {
    return "Only two recurring transactions found";
  }

  if (candidate.recurrenceConfidence < 0.85) {
    return "Recurring pattern needs human review";
  }

  return `Classification needs review: ${formatReason(classification.reason)}`;
}

function formatReason(reason: string): string {
  return reason.replaceAll("_", " ");
}
