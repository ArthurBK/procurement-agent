import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateClassification } from "./classifyRecurringCandidate.ts";
import type { RecurringPaymentCandidateBase } from "./detectRecurringPaymentCandidates.ts";
import { triageRecurringCandidate } from "./triageRecurringCandidate.ts";
import type { SupplierRule } from "../supplierRules/types.ts";

test("auto-accepts supplier rule accept matches", () => {
  const triage = triageRecurringCandidate({
    candidate: candidate({ recurrenceConfidence: 0.6 }),
    classification: classification({ systemDecision: "needs_review" }),
    supplierRule: supplierRule({ default_decision: "auto_subscription" }),
  });

  assert.equal(triage.reviewBucket, "auto_accepted");
  assert.equal(triage.shouldAutoAccept, true);
  assert.equal(triage.decisionSource, "supplier_rule");
});

test("auto-ignores supplier rule ignore matches", () => {
  const triage = triageRecurringCandidate({
    candidate: candidate({ recurrenceConfidence: 0.6 }),
    classification: classification({ systemDecision: "needs_review" }),
    supplierRule: supplierRule({ default_decision: "excluded" }),
  });

  assert.equal(triage.reviewBucket, "auto_ignored");
  assert.equal(triage.shouldAutoIgnore, true);
  assert.equal(triage.decisionSource, "supplier_rule");
});

test("auto-accepts high-confidence monthly subscriptions", () => {
  const triage = triageRecurringCandidate({
    candidate: candidate({
      frequency: "monthly",
      recurrenceConfidence: 0.9,
      transactionsCount: 3,
    }),
    classification: classification({
      classificationConfidence: 0.9,
      systemDecision: "auto_subscription",
    }),
  });

  assert.equal(triage.reviewBucket, "auto_accepted");
  assert.equal(triage.shouldAutoAccept, true);
});

test("auto-accepts strong business signals with medium recurrence confidence", () => {
  const triage = triageRecurringCandidate({
    candidate: candidate({
      billingModel: "variable",
      evidence: evidence({ amount_stable: false }),
      frequency: "monthly",
      recurrenceConfidence: 0.8,
      transactionsCount: 4,
    }),
    classification: classification({
      classificationConfidence: 0.9,
      reason: "merchant_software",
      signals: { signal: "merchant_rule" },
      systemDecision: "auto_subscription",
    }),
  });

  assert.equal(triage.reviewBucket, "auto_accepted");
  assert.equal(triage.shouldAutoAccept, true);
  assert.equal(triage.decisionSource, "high_confidence");
});

test("keeps weak weekly business signals in review", () => {
  const triage = triageRecurringCandidate({
    candidate: candidate({
      frequency: "weekly",
      recurrenceConfidence: 0.8,
      transactionsCount: 4,
    }),
    classification: classification({
      classificationConfidence: 0.9,
      reason: "merchant_software",
      signals: { signal: "merchant_rule" },
      systemDecision: "auto_subscription",
    }),
  });

  assert.equal(triage.reviewBucket, "needs_review");
  assert.equal(triage.shouldAutoAccept, false);
});

test("keeps single annual keyword candidates in review", () => {
  const triage = triageRecurringCandidate({
    candidate: candidate({
      evidence: evidence({ reason: "annual keyword" }),
      frequency: "annually",
      recurrenceConfidence: 0.55,
      transactionsCount: 1,
    }),
    classification: classification({
      classificationConfidence: 0.9,
      systemDecision: "auto_subscription",
    }),
  });

  assert.equal(triage.reviewBucket, "needs_review");
  assert.equal(triage.shouldAutoAccept, false);
  assert.equal(triage.shouldAutoIgnore, false);
});

test("keeps medium-confidence candidates in review", () => {
  const triage = triageRecurringCandidate({
    candidate: candidate({
      frequency: "monthly",
      recurrenceConfidence: 0.7,
      transactionsCount: 2,
    }),
    classification: classification({
      classificationConfidence: 0.9,
      systemDecision: "auto_subscription",
    }),
  });

  assert.equal(triage.reviewBucket, "needs_review");
});

test("auto-ignores low-value unknown recurring candidates", () => {
  const triage = triageRecurringCandidate({
    candidate: candidate({
      amountCents: 2500,
      frequency: "monthly",
      recurrenceConfidence: 0.8,
      transactionsCount: 3,
    }),
    classification: classification({
      businessCategory: "unknown",
      classificationConfidence: 0.6,
      reason: "high_recurrence_unknown_business_relevance",
      systemDecision: "needs_review",
    }),
  });

  assert.equal(triage.reviewBucket, "auto_ignored");
  assert.equal(triage.shouldAutoIgnore, true);
});

test("keeps high-value unknown recurring candidates in review", () => {
  const triage = triageRecurringCandidate({
    candidate: candidate({
      amountCents: 12_000,
      frequency: "monthly",
      recurrenceConfidence: 0.8,
      transactionsCount: 2,
    }),
    classification: classification({
      businessCategory: "unknown",
      classificationConfidence: 0.6,
      reason: "high_recurrence_unknown_business_relevance",
      systemDecision: "needs_review",
    }),
  });

  assert.equal(triage.reviewBucket, "needs_review");
});

test("auto-ignores clear income classifications", () => {
  const triage = triageRecurringCandidate({
    candidate: candidate({
      evidence: evidence({
        signs_summary: { negative_count: 0, positive_count: 3 },
      }),
    }),
    classification: classification({
      businessCategory: "income",
      classificationConfidence: 0.95,
      reason: "majority_positive_transactions",
      systemDecision: "excluded",
    }),
  });

  assert.equal(triage.reviewBucket, "auto_ignored");
  assert.equal(triage.shouldAutoIgnore, true);
});

function candidate(
  overrides: Partial<RecurringPaymentCandidateBase>,
): RecurringPaymentCandidateBase {
  return {
    amountCents: 2500,
    billingModel: "fixed",
    candidateKey: "supplier|EUR|Main account|monthly",
    currency: "EUR",
    evidence: evidence({}),
    frequency: "monthly",
    lastPayment: "2024-03-01",
    nextPayment: "2024-04-01",
    paymentMethod: "Main account",
    recurrenceConfidence: 0.9,
    supplier: "Supplier",
    supplierKey: "supplier",
    transactionsCount: 3,
    ...overrides,
  };
}

function classification(
  overrides: Partial<CandidateClassification>,
): CandidateClassification {
  return {
    businessCategory: "software",
    classificationConfidence: 0.9,
    reason: "merchant_software",
    signals: {},
    systemDecision: "auto_subscription",
    ...overrides,
  };
}

function evidence(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    amount_stable: true,
    signs_summary: { negative_count: 3, positive_count: 0 },
    ...overrides,
  };
}

function supplierRule(overrides: Partial<SupplierRule>): SupplierRule {
  return {
    active: true,
    business_category: "software",
    canonical_supplier: "Supplier",
    default_decision: "needs_review",
    id: "rule_1",
    match_type: "exact_supplier_key",
    notes: null,
    source: "user",
    supplier_key: "supplier",
    ...overrides,
  };
}
