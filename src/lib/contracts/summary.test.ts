import assert from "node:assert/strict";
import test from "node:test";
import { buildContractSummary } from "./summary.ts";

test("summarizes active, renewal, review, and spend metrics", () => {
  const summary = buildContractSummary({
    contracts: [
      contract({
        billingFrequency: "monthly",
        contractId: "aircall",
        nextRenewalDate: "2025-09-21",
        recurringAmountCents: 8400,
        status: "possibly_cancelled",
      }),
      contract({
        billingFrequency: "monthly",
        contractId: "qonto",
        nextRenewalDate: "2026-04-30",
        recurringAmountCents: 2469,
        status: "active",
      }),
      contract({
        billingFrequency: "monthly",
        contractId: "openai",
        nextRenewalDate: "2026-05-20",
        recurringAmountCents: 8583,
        status: "needs_review",
      }),
      contract({
        billingFrequency: "monthly",
        contractId: "vercel",
        nextRenewalDate: "2026-05-25",
        recurringAmountCents: 3417,
        status: "needs_review",
      }),
      contract({
        billingFrequency: "monthly",
        contractId: "inactive",
        nextRenewalDate: "2026-06-01",
        recurringAmountCents: 9999,
        status: "inactive",
      }),
    ],
    gaps: {
      missingContracts: [{ linkId: "missing-1" }, { linkId: "missing-2" }],
      orphanContracts: [],
      possibleMatches: [],
      usageReviewContracts: [
        {
          contractId: "aircall",
          contractStatus: "possibly_cancelled",
          linkId: "aircall-link",
        },
      ],
    },
    today: "2026-05-15",
  });

  assert.equal(summary.activeContracts, 4);
  assert.equal(summary.estimatedMonthlySpendCents, 22869);
  assert.equal(summary.missingContracts, 2);
  assert.equal(summary.needsReview, 0);
  assert.equal(summary.renewalsNext90Days, 9);
});

test("normalizes active annual and quarterly amounts to monthly spend", () => {
  const summary = buildContractSummary({
    contracts: [
      contract({
        billingFrequency: "annual",
        recurringAmountCents: 120000,
        status: "active",
      }),
      contract({
        billingFrequency: "quarterly",
        recurringAmountCents: 30000,
        status: "active",
      }),
    ],
    gaps: {
      missingContracts: [],
      orphanContracts: [],
      possibleMatches: [],
    },
    today: "2026-05-15",
  });

  assert.equal(summary.estimatedMonthlySpendCents, 20000);
});

function contract(
  overrides: Partial<{
    billingFrequency: string;
    contractId: string;
    nextRenewalDate: string | null;
    recurringAmountCents: number | null;
    status: string;
  }> = {},
) {
  return {
    billingFrequency: "monthly",
    contractId: "contract",
    nextRenewalDate: null,
    recurringAmountCents: 0,
    status: "active",
    ...overrides,
  };
}
