import assert from "node:assert/strict";
import test from "node:test";
import {
  applyManualContractReviewOverride,
  buildContractReviewUpdate,
} from "./reviewActions.ts";

test("builds a cancellation confirmation update", () => {
  const update = buildContractReviewUpdate({
    action: "confirm_cancellation",
    currentReason: "Possible cancellation",
    currentStatus: "possibly_cancelled",
    existingFields: { lifecycle_review: { status: "possibly_cancelled" } },
    reviewedAt: "2026-05-20T10:00:00.000Z",
  });

  assert.equal(update.status, "inactive");
  assert.equal(
    update.confidenceReason,
    "Cancellation confirmed manually on 2026-05-20.",
  );
  assert.deepEqual(update.extractedFields.manual_review, {
    action: "confirm_cancellation",
    previous_confidence_reason: "Possible cancellation",
    previous_status: "possibly_cancelled",
    reviewed_at: "2026-05-20T10:00:00.000Z",
  });
});

test("builds a keep active update", () => {
  const update = buildContractReviewUpdate({
    action: "keep_active",
    currentReason: "Possible cancellation",
    currentStatus: "possibly_cancelled",
    existingFields: {},
    reviewedAt: "2026-05-20T10:00:00.000Z",
  });

  assert.equal(update.status, "active");
  assert.match(update.confidenceReason, /Marked active manually/);
  assert.equal(
    (update.extractedFields.manual_review as Record<string, unknown>).action,
    "keep_active",
  );
});

test("keeps manual review overrides when no newer invoice exists", () => {
  const result = applyManualContractReviewOverride({
    existingReview: {
      confidenceReason: "Cancellation confirmed manually on 2026-05-20.",
      extractedFields: {
        manual_review: {
          action: "confirm_cancellation",
          reviewed_at: "2026-05-20T10:00:00.000Z",
        },
      },
      status: "inactive",
    },
    nextFields: {
      invoice_dates: ["2025-08-22"],
      lifecycle_review: { status: "possibly_cancelled" },
    },
    nextReason: "Possible cancellation",
    nextStatus: "possibly_cancelled",
  });

  assert.equal(result.status, "inactive");
  assert.equal(
    result.confidenceReason,
    "Cancellation confirmed manually on 2026-05-20.",
  );
  assert.equal(
    (result.extractedFields.manual_review as Record<string, unknown>).action,
    "confirm_cancellation",
  );
});

test("clears manual review overrides when a newer invoice appears", () => {
  const result = applyManualContractReviewOverride({
    existingReview: {
      confidenceReason: "Cancellation confirmed manually on 2026-05-20.",
      extractedFields: {
        manual_review: {
          action: "confirm_cancellation",
          reviewed_at: "2026-05-20T10:00:00.000Z",
        },
      },
      status: "inactive",
    },
    nextFields: {
      invoice_dates: ["2026-06-01"],
    },
    nextReason: "Fresh invoice found.",
    nextStatus: "active",
  });

  assert.equal(result.status, "active");
  assert.equal(result.confidenceReason, "Fresh invoice found.");
  assert.equal(result.extractedFields.manual_review, undefined);
});
