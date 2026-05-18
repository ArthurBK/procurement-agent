import assert from "node:assert/strict";
import test from "node:test";
import { parseRecurringCandidatePatchBody } from "./validateRecurringCandidatePatch.ts";

test("parses valid correction fields", () => {
  const parsed = parseRecurringCandidatePatchBody({
    correctedAmountCents: 2400,
    correctedCurrency: "eur",
    correctedFrequency: "monthly",
    correctedNextPayment: "2024-05-01",
    correctedSupplier: "  Vercel Inc.  ",
    reviewNotes: "  Reviewed  ",
  });

  assert.equal(parsed.ok, true);

  if (!parsed.ok) {
    return;
  }

  assert.equal(parsed.hasCorrections, true);
  assert.equal(parsed.update.corrected_amount_cents, 2400);
  assert.equal(parsed.update.corrected_currency, "EUR");
  assert.equal(parsed.update.corrected_frequency, "monthly");
  assert.equal(parsed.update.corrected_next_payment, "2024-05-01");
  assert.equal(parsed.update.corrected_supplier, "Vercel Inc.");
  assert.equal(parsed.update.review_notes, "Reviewed");
  assert.equal(typeof parsed.update.reviewed_at, "string");
});

test("allows existing decision patches", () => {
  const parsed = parseRecurringCandidatePatchBody({
    userDecision: "confirmed",
  });

  assert.equal(parsed.ok, true);

  if (!parsed.ok) {
    return;
  }

  assert.equal(parsed.hasUserDecision, true);
  assert.equal(parsed.update.user_decision, "confirmed");
});

test("rejects invalid correction values", () => {
  const parsed = parseRecurringCandidatePatchBody({
    correctedAmountCents: -1,
    correctedCurrency: "EURO",
    correctedFrequency: "daily",
    correctedNextPayment: "2024-02-31",
  });

  assert.equal(parsed.ok, false);

  if (parsed.ok) {
    return;
  }

  assert(parsed.errors.some((error) => error.includes("positive integer")));
  assert(parsed.errors.some((error) => error.includes("3-letter")));
  assert(parsed.errors.some((error) => error.includes("correctedFrequency")));
  assert(parsed.errors.some((error) => error.includes("YYYY-MM-DD")));
});
