import assert from "node:assert/strict";
import test from "node:test";
import {
  detectRecurringPaymentCandidates,
  type RawTransactionForRecurringDetection,
} from "./detectRecurringPaymentCandidates.ts";

test("detects a monthly recurring payment candidate", () => {
  const candidates = detectRecurringPaymentCandidates([
    transaction({
      amount_cents: -1200,
      id: "txn_1",
      raw_supplier: "CB DROPBOX INTERNATIONAL LTD",
      row_number: 1,
      transaction_date: "2024-01-01",
    }),
    transaction({
      amount_cents: -1200,
      id: "txn_2",
      raw_supplier: "DROPBOX INTERNATIONAL LTD",
      row_number: 2,
      transaction_date: "2024-01-31",
    }),
    transaction({
      amount_cents: -1200,
      id: "txn_3",
      raw_supplier: "DROPBOX INTERNATIONAL LTD",
      row_number: 3,
      transaction_date: "2024-03-01",
    }),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].frequency, "monthly");
  assert.equal(candidates[0].billingModel, "fixed");
  assert.equal(candidates[0].amountCents, 1200);
  assert.equal(candidates[0].supplierKey, "dropbox international");
});

test("detects a weekly recurring payment candidate", () => {
  const candidates = detectRecurringPaymentCandidates([
    transaction({
      amount_cents: -2400,
      id: "txn_1",
      raw_supplier: "Canva",
      row_number: 1,
      transaction_date: "2024-01-01",
    }),
    transaction({
      amount_cents: -2400,
      id: "txn_2",
      raw_supplier: "Canva",
      row_number: 2,
      transaction_date: "2024-01-08",
    }),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].frequency, "weekly");
});

test("detects a single annual keyword transaction", () => {
  const candidates = detectRecurringPaymentCandidates([
    transaction({
      amount_cents: -14900,
      description: "Zoom annual plan",
      id: "txn_1",
      raw_supplier: "Zoom",
      row_number: 1,
      transaction_date: "2024-01-01",
    }),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].frequency, "annually");
  assert.equal(candidates[0].recurrenceConfidence, 0.45);
});

test("ignores a one-off transaction without annual keywords", () => {
  const candidates = detectRecurringPaymentCandidates([
    transaction({
      amount_cents: -5400,
      id: "txn_1",
      raw_supplier: "Random vendor",
      row_number: 1,
      transaction_date: "2024-01-01",
    }),
  ]);

  assert.deepEqual(candidates, []);
});

test("marks variable monthly billing as variable", () => {
  const candidates = detectRecurringPaymentCandidates([
    transaction({
      amount_cents: -2000,
      id: "txn_1",
      raw_supplier: "OPEN AI",
      row_number: 1,
      transaction_date: "2024-01-01",
    }),
    transaction({
      amount_cents: -3000,
      id: "txn_2",
      raw_supplier: "OPEN AI",
      row_number: 2,
      transaction_date: "2024-02-01",
    }),
    transaction({
      amount_cents: -5000,
      id: "txn_3",
      raw_supplier: "OPEN AI",
      row_number: 3,
      transaction_date: "2024-03-01",
    }),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].frequency, "monthly");
  assert.equal(candidates[0].billingModel, "variable");
  assert.equal(candidates[0].amountCents, 5000);
  assert.equal(candidates[0].evidence.amount_stable, false);
});

test("keeps majority positive transaction groups as recurring candidates", () => {
  const candidates = detectRecurringPaymentCandidates([
    transaction({
      amount_cents: 100000,
      id: "txn_1",
      raw_supplier: "Stripe payout",
      row_number: 1,
      transaction_date: "2024-01-01",
    }),
    transaction({
      amount_cents: 100000,
      id: "txn_2",
      raw_supplier: "Stripe payout",
      row_number: 2,
      transaction_date: "2024-02-01",
    }),
    transaction({
      amount_cents: 100000,
      id: "txn_3",
      raw_supplier: "Stripe payout",
      row_number: 3,
      transaction_date: "2024-03-01",
    }),
  ]);

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].evidence.signs_summary, {
    negative_count: 0,
    positive_count: 3,
  });
});

function transaction(
  overrides: Partial<RawTransactionForRecurringDetection>,
): RawTransactionForRecurringDetection {
  return {
    amount_cents: -1000,
    bank_account: "Main account",
    currency: "EUR",
    description: null,
    id: "txn",
    raw_supplier: "Supplier",
    row_number: 1,
    source_row: {},
    transaction_date: "2024-01-01",
    ...overrides,
  };
}
