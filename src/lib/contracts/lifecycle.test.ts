import assert from "node:assert/strict";
import test from "node:test";
import {
  applyContractLifecycleStatus,
  getPossibleCancellationReview,
} from "./lifecycle.ts";
import type { InferredContract } from "./extraction.ts";

test("marks monthly contracts as possibly cancelled when invoices are overdue", () => {
  const reviewed = applyContractLifecycleStatus({
    contract: contract({
      billingFrequency: "monthly",
      extractedFields: {
        invoice_dates: ["2025-09-21"],
      },
      nextRenewalDate: "2025-10-21",
      vendorName: "Aircall",
    }),
    today: new Date("2026-05-15T00:00:00.000Z"),
  });

  assert.equal(reviewed.status, "possibly_cancelled");
  assert.match(reviewed.confidenceReason, /expected next monthly invoice around 2025-10-21/);
  assert.match(reviewed.confidenceReason, /Last invoice was 2025-09-21/);
  assert.deepEqual(
    (reviewed.extractedFields.lifecycle_review as Record<string, unknown>).status,
    "possibly_cancelled",
  );
});

test("does not mark monthly contracts stale inside the grace period", () => {
  const review = getPossibleCancellationReview({
    contract: contract({
      billingFrequency: "monthly",
      nextRenewalDate: "2026-04-15",
    }),
    today: new Date("2026-05-15T00:00:00.000Z"),
  });

  assert.equal(review, null);
});

test("uses latest invoice date as fallback when next renewal date is missing", () => {
  const review = getPossibleCancellationReview({
    contract: contract({
      billingFrequency: "quarterly",
      extractedFields: {
        invoice_dates: ["2025-01-10", "2025-04-10"],
      },
      nextRenewalDate: null,
    }),
    today: new Date("2026-05-15T00:00:00.000Z"),
  });

  assert.equal(review?.expectedRenewalDate, "2025-07-10");
});

test("does not infer cancellation for unknown frequencies", () => {
  const review = getPossibleCancellationReview({
    contract: contract({
      billingFrequency: "unknown",
      nextRenewalDate: "2025-01-01",
    }),
    today: new Date("2026-05-15T00:00:00.000Z"),
  });

  assert.equal(review, null);
});

function contract(overrides: Partial<InferredContract> = {}): InferredContract {
  return {
    billingFrequency: "monthly",
    confidence: "high",
    confidenceReason: "Service period found on Pennylane invoice.",
    currency: "EUR",
    currentPeriodEnd: "2026-02-01",
    currentPeriodStart: "2026-01-01",
    extractedFields: {
      invoice_dates: ["2026-01-01"],
    },
    lastInvoiceAmountCents: 2400,
    nextRenewalDate: "2026-02-01",
    normalizedVendorName: "aircall",
    planName: null,
    productName: null,
    quantity: null,
    recurringAmountCents: 2400,
    seats: null,
    sourceDocumentExternalId: "invoice-1",
    sourceExternalId: "pennylane:aircall:EUR:monthly",
    sourceSystem: "pennylane",
    status: "active",
    vendorName: "Aircall",
    ...overrides,
  };
}
