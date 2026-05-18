import assert from "node:assert/strict";
import test from "node:test";
import { formatAmountCents } from "./formatAmount.ts";

test("formats positive and negative cent amounts as EUR", () => {
  assert.equal(formatAmountCents(-3472), "-€34.72");
  assert.equal(formatAmountCents(700000), "€7,000.00");
});

test("formats null amounts as a placeholder", () => {
  assert.equal(formatAmountCents(null), "-");
});
