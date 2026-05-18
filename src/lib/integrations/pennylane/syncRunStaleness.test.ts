import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStalePennylaneSyncMessage,
  getPennylaneSyncStaleAfterMs,
  isPennylaneSyncingIntegrationStale,
  isPennylaneSyncRunStale,
} from "./syncRunStaleness.ts";

test("detects stale Pennylane sync runs after the configured window", () => {
  const now = new Date("2026-05-18T12:31:00.000Z");

  assert.equal(
    isPennylaneSyncRunStale({
      now,
      staleAfterMs: 30 * 60 * 1000,
      startedAt: "2026-05-18T12:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    isPennylaneSyncRunStale({
      now,
      staleAfterMs: 30 * 60 * 1000,
      startedAt: "2026-05-18T12:10:00.000Z",
    }),
    false,
  );
});

test("does not treat missing or invalid run timestamps as stale", () => {
  assert.equal(isPennylaneSyncRunStale({ startedAt: null }), false);
  assert.equal(isPennylaneSyncRunStale({ startedAt: "not-a-date" }), false);
});

test("treats syncing integrations without a started timestamp as stale", () => {
  assert.equal(isPennylaneSyncingIntegrationStale({ startedAt: null }), true);
});

test("reads Pennylane stale window from env", () => {
  const originalValue = process.env.PENNYLANE_SYNC_STALE_AFTER_MINUTES;
  process.env.PENNYLANE_SYNC_STALE_AFTER_MINUTES = "5";

  try {
    assert.equal(getPennylaneSyncStaleAfterMs(), 5 * 60 * 1000);
  } finally {
    if (originalValue === undefined) {
      delete process.env.PENNYLANE_SYNC_STALE_AFTER_MINUTES;
    } else {
      process.env.PENNYLANE_SYNC_STALE_AFTER_MINUTES = originalValue;
    }
  }
});

test("builds a clear stale sync recovery message", () => {
  assert.match(
    buildStalePennylaneSyncMessage("2026-05-18T12:00:00.000Z"),
    /marked failed so you can run sync again/,
  );
});
