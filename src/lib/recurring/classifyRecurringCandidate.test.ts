import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRecurringCandidate,
  type BusinessCategory,
  type SystemDecision,
} from "./classifyRecurringCandidate.ts";
import type { RecurringPaymentCandidateBase } from "./detectRecurringPaymentCandidates.ts";
import type { SupplierRule } from "../supplierRules/types.ts";

test("classifies software accounting categories as auto subscriptions", () => {
  assertClassification(
    candidate({ evidence: evidence({ source_categories: ["Logiciels"] }) }),
    "software",
    "auto_subscription",
  );
});

test("classifies telecom accounting categories as auto subscriptions", () => {
  assertClassification(
    candidate({ evidence: evidence({ source_categories: ["Internet"] }) }),
    "telecom",
    "auto_subscription",
  );
});

test("classifies banking accounting categories as auto subscriptions", () => {
  assertClassification(
    candidate({ evidence: evidence({ source_categories: ["Frais bancaires"] }) }),
    "banking",
    "auto_subscription",
  );
});

test("classifies food accounting categories as excluded", () => {
  assertClassification(
    candidate({ evidence: evidence({ source_categories: ["Restaurant"] }) }),
    "food",
    "excluded",
  );
});

test("classifies transport accounting categories as excluded", () => {
  assertClassification(
    candidate({ evidence: evidence({ source_categories: ["Transport"] }) }),
    "transport",
    "excluded",
  );
});

test("classifies majority positive candidates as income and excluded", () => {
  const classification = classifyRecurringCandidate(
    candidate({
      evidence: evidence({
        signs_summary: { negative_count: 0, positive_count: 3 },
      }),
      supplier: "Customer transfer",
    }),
  );

  assert.equal(classification.businessCategory, "income");
  assert.equal(classification.systemDecision, "excluded");
  assert.equal(classification.reason, "majority_positive_transactions");
});

test("classifies weekly unknown recurrence as excluded", () => {
  const classification = classifyRecurringCandidate(
    candidate({
      amountCents: 2500,
      frequency: "weekly",
      recurrenceConfidence: 0.8,
      supplier: "Unknown merchant",
    }),
  );

  assert.equal(classification.businessCategory, "unknown");
  assert.equal(classification.systemDecision, "excluded");
  assert.equal(classification.reason, "weekly_without_business_signal");
});

test("classifies high-value unknown monthly recurrence as needs review", () => {
  const classification = classifyRecurringCandidate(
    candidate({
      amountCents: 2500,
      frequency: "monthly",
      recurrenceConfidence: 0.8,
      supplier: "Unknown merchant",
    }),
  );

  assert.equal(classification.businessCategory, "unknown");
  assert.equal(classification.systemDecision, "needs_review");
});

test("classifies Vercel, OpenAI, and Google Workspace-like merchants as software subscriptions", () => {
  for (const supplier of ["Vercel", "OPEN AI", "Google Workspace"]) {
    assertClassification(
      candidate({
        supplier,
        supplierKey: supplier.toLowerCase(),
      }),
      "software",
      "auto_subscription",
    );
  }
});

test("classifies plain Stripe positive payouts as income and excluded", () => {
  const classification = classifyRecurringCandidate(
    candidate({
      evidence: evidence({
        signs_summary: { negative_count: 0, positive_count: 3 },
      }),
      supplier: "Stripe payout",
      supplierKey: "stripe payout",
    }),
  );

  assert.equal(classification.businessCategory, "income");
  assert.equal(classification.systemDecision, "excluded");
});

test("classifies supplier rule auto_subscription matches", () => {
  const classification = classifyRecurringCandidate(
    candidate({
      supplier: "VERCEL INC.",
      supplierKey: "vercel",
    }),
    {
      supplierRules: [
        supplierRule({
          business_category: "cloud",
          default_decision: "auto_subscription",
          supplier_key: "vercel",
        }),
      ],
    },
  );

  assert.equal(classification.systemDecision, "auto_subscription");
  assert.equal(classification.businessCategory, "cloud");
  assert.equal(classification.classificationConfidence, 0.99);
  assert.match(classification.reason, /^supplier_rule:/);
});

test("classifies supplier rule excluded matches", () => {
  const classification = classifyRecurringCandidate(
    candidate({
      supplier: "TSUBAME",
      supplierKey: "tsubame",
    }),
    {
      supplierRules: [
        supplierRule({
          business_category: "food",
          default_decision: "excluded",
          supplier_key: "tsubame",
        }),
      ],
    },
  );

  assert.equal(classification.systemDecision, "excluded");
  assert.equal(classification.businessCategory, "food");
  assert.equal(classification.classificationConfidence, 0.99);
});

test("keeps majority positive transactions ahead of supplier rules", () => {
  const classification = classifyRecurringCandidate(
    candidate({
      evidence: evidence({
        signs_summary: { negative_count: 0, positive_count: 3 },
      }),
      supplier: "Stripe payout",
      supplierKey: "stripe",
    }),
    {
      supplierRules: [
        supplierRule({
          business_category: "software",
          default_decision: "auto_subscription",
          supplier_key: "stripe",
        }),
      ],
    },
  );

  assert.equal(classification.systemDecision, "excluded");
  assert.equal(classification.businessCategory, "income");
  assert.equal(classification.reason, "majority_positive_transactions");
});

test("keeps deterministic classification when no supplier rule exists", () => {
  assertClassification(
    candidate({
      supplier: "OpenAI",
      supplierKey: "openai",
    }),
    "software",
    "auto_subscription",
  );
});

function assertClassification(
  input: RecurringPaymentCandidateBase,
  category: BusinessCategory,
  decision: SystemDecision,
) {
  const classification = classifyRecurringCandidate(input);

  assert.equal(classification.businessCategory, category);
  assert.equal(classification.systemDecision, decision);
}

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
    recurrenceConfidence: 0.8,
    supplier: "Supplier",
    supplierKey: "supplier",
    transactionsCount: 3,
    ...overrides,
  };
}

function evidence(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    amounts_cents: [-2500, -2500, -2500],
    signs_summary: { negative_count: 3, positive_count: 0 },
    source_categories: [],
    ...overrides,
  };
}

function supplierRule(overrides: Partial<SupplierRule>): SupplierRule {
  return {
    active: true,
    business_category: "unknown",
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
