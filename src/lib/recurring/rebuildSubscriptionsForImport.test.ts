import assert from "node:assert/strict";
import test from "node:test";
import {
  mapAcceptedCandidatesToSubscriptionInserts,
  type RecurringPaymentCandidateForSubscription,
} from "./rebuildSubscriptionsForImport.ts";

test("maps only accepted candidates into subscription inserts", () => {
  const inserts = mapAcceptedCandidatesToSubscriptionInserts([
    candidate({
      id: "auto",
      review_bucket: "auto_accepted",
      system_decision: "auto_subscription",
      user_decision: "confirmed",
    }),
    candidate({
      id: "confirmed",
      system_decision: "needs_review",
      user_decision: "confirmed",
    }),
    candidate({
      id: "ignored_auto",
      system_decision: "auto_subscription",
      user_decision: "ignored",
    }),
    candidate({
      id: "needs_review",
      review_bucket: "needs_review",
      system_decision: "auto_subscription",
      user_decision: null,
    }),
    candidate({
      id: "classifier_auto_unaccepted",
      review_bucket: "needs_review",
      system_decision: "auto_subscription",
      user_decision: null,
    }),
    candidate({
      id: "needs_review_classification",
      system_decision: "needs_review",
      user_decision: null,
    }),
    candidate({
      id: "excluded",
      system_decision: "excluded",
      user_decision: null,
    }),
  ]);

  assert.deepEqual(
    inserts.map((insert) => insert.candidate_id),
    ["auto", "confirmed"],
  );
  assert.equal(inserts[0].confidence, 0.8);
});

test("maps accepted candidate without corrections using detected fields", () => {
  const [insert] = mapAcceptedCandidatesToSubscriptionInserts([
    candidate({
      amount_cents: 5000,
      frequency: "monthly",
      supplier: "Detected Supplier",
      user_decision: "confirmed",
    }),
  ]);

  assert.equal(insert.amount_cents, 5000);
  assert.equal(insert.frequency, "monthly");
  assert.equal(insert.supplier, "Detected Supplier");
  assert.equal(insert.evidence.review_bucket, "auto_accepted");
});

test("maps accepted candidate with corrected amount and frequency", () => {
  const [insert] = mapAcceptedCandidatesToSubscriptionInserts([
    candidate({
      corrected_amount_cents: 6400,
      corrected_frequency: "quarterly",
      user_decision: "confirmed",
    }),
  ]);

  assert.equal(insert.amount_cents, 6400);
  assert.equal(insert.frequency, "quarterly");
});

test("maps accepted candidate with corrected supplier", () => {
  const [insert] = mapAcceptedCandidatesToSubscriptionInserts([
    candidate({
      corrected_supplier: "Corrected Supplier",
      supplier: "Detected Supplier",
      user_decision: "confirmed",
    }),
  ]);

  assert.equal(insert.supplier, "Corrected Supplier");
});

test("adds correction metadata to subscription evidence", () => {
  const [insert] = mapAcceptedCandidatesToSubscriptionInserts([
    candidate({
      corrected_amount_cents: 6400,
      corrected_frequency: "quarterly",
      evidence: { existing: true },
      review_notes: "Adjusted after review",
      user_decision: "confirmed",
    }),
  ]);

  assert.equal(insert.evidence.existing, true);
  assert.equal(insert.evidence.used_corrections, true);
  assert.deepEqual(insert.evidence.corrected_fields, [
    "frequency",
    "amount_cents",
  ]);
  assert.equal(insert.evidence.review_notes, "Adjusted after review");
});

function candidate(
  overrides: Partial<RecurringPaymentCandidateForSubscription>,
): RecurringPaymentCandidateForSubscription {
  return {
    amount_cents: 2500,
    billing_model: "fixed",
    business_category: "software",
    classification_confidence: 0.9,
    currency: "EUR",
    corrected_amount_cents: null,
    corrected_billing_model: null,
    corrected_business_category: null,
    corrected_currency: null,
    corrected_frequency: null,
    corrected_next_payment: null,
    corrected_payment_method: null,
    corrected_supplier: null,
    evidence: {},
    frequency: "monthly",
    id: "candidate",
    import_id: "import_1",
    last_payment: "2024-03-01",
    next_payment: "2024-04-01",
    payment_method: "Main account",
    recurrence_confidence: 0.8,
    decision_reason: "High-confidence recurring subscription pattern",
    decision_source: "high_confidence",
    review_notes: null,
    review_bucket: "auto_accepted",
    supplier: "Supplier",
    supplier_key: "supplier",
    system_decision: "auto_subscription",
    transactions_count: 3,
    user_decision: null,
    ...overrides,
  };
}
