import assert from "node:assert/strict";
import test from "node:test";
import {
  computeUtilization,
  formatRelativeLastUsed,
  getLoginFrequency,
  getRecommendedNextAction,
  getUtilizationStatus,
} from "./usageMetrics.ts";

test("formats relative last used dates", () => {
  const now = new Date("2026-05-12T12:00:00.000Z");

  assert.equal(formatRelativeLastUsed(null, now), "-");
  assert.equal(formatRelativeLastUsed("2026-05-11T10:00:00.000Z", now), "Yesterday");
  assert.equal(formatRelativeLastUsed("2026-05-05T10:00:00.000Z", now), "A week ago");
  assert.equal(formatRelativeLastUsed("2026-04-28T10:00:00.000Z", now), "2 weeks ago");
});

test("computes utilization when paid seats are known", () => {
  assert.deepEqual(computeUtilization(8, 10), {
    paidSeats: 10,
    percentage: 80,
    utilization: 0.8,
    wastedSeats: 2,
  });
  assert.equal(computeUtilization(4, null).utilization, null);
});

test("classifies utilization status", () => {
  assert.equal(getUtilizationStatus(null), "needs_seat_data");
  assert.equal(getUtilizationStatus(1.2), "overutilized");
  assert.equal(getUtilizationStatus(0.9), "healthy");
  assert.equal(getUtilizationStatus(0.6), "moderate");
  assert.equal(getUtilizationStatus(0.3), "underutilized");
  assert.equal(getUtilizationStatus(0.1), "severe_underutilized");
});

test("computes login frequency from recent active users", () => {
  assert.equal(getLoginFrequency(8, 10, 12), "high");
  assert.equal(getLoginFrequency(4, 10, 12), "average");
  assert.equal(getLoginFrequency(2, 10, 12), "low");
  assert.equal(getLoginFrequency(0, 0, 12), "low");
});

test("returns procurement-oriented next actions", () => {
  assert.equal(
    getRecommendedNextAction({
      currentNextAction: "Fetch vendor users",
      identityMode: "unknown",
      paidSeats: null,
      usersWithSignal90d: 0,
      visibleViaGoogle: false,
    }),
    "Connect app or fetch usage",
  );
  assert.equal(
    getRecommendedNextAction({
      currentNextAction: "Fetch vendor users",
      identityMode: "oauth",
      paidSeats: 10,
      usersWithSignal90d: 3,
      visibleViaGoogle: true,
    }),
    "Fetch vendor users",
  );
  assert.equal(
    getRecommendedNextAction({
      currentNextAction: "Fetch vendor users",
      identityMode: "saml",
      paidSeats: 10,
      usersWithSignal90d: 3,
      visibleViaGoogle: true,
    }),
    "Review unused seats",
  );
});
