"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type DetectRecurringPaymentsResponse = {
  errors?: string[];
  candidatesCount?: number;
  autoAcceptedCount?: number;
  autoIgnoredCount?: number;
  autoLogoCreatedCount?: number;
  autoLogoError?: string | null;
  needsReviewCount?: number;
};

export function DetectRecurringPaymentsButton({
  importId,
}: {
  importId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [summary, setSummary] = useState<DetectRecurringPaymentsResponse | null>(
    null,
  );

  async function handleDetectRecurringPayments() {
    setError(null);
    setSummary(null);
    setIsDetecting(true);

    try {
      const response = await fetch(
        `/api/imports/${importId}/recurring-candidates/detect`,
        {
          method: "POST",
        },
      );
      const result = (await response.json()) as DetectRecurringPaymentsResponse;

      if (!response.ok) {
        setError(result.errors?.[0] ?? "Unable to detect recurring payments.");
        return;
      }

      setSummary(result);
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to detect recurring payments.",
      );
    } finally {
      setIsDetecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        disabled={isDetecting}
        onClick={handleDetectRecurringPayments}
        type="button"
      >
        {isDetecting ? "Detecting..." : "Detect recurring payments"}
      </button>
      {error ? (
        <p className="max-w-md text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {summary ? (
        <div className="max-w-md rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-700 shadow-sm">
          <p>
            Detected {summary.candidatesCount ?? 0} recurring payment candidates:{" "}
            {summary.autoAcceptedCount ?? 0} auto-accepted,{" "}
            {summary.needsReviewCount ?? 0} need review,{" "}
            {summary.autoIgnoredCount ?? 0} auto-ignored.
          </p>
          {summary.autoLogoError ? (
            <p className="mt-2 text-red-700">{summary.autoLogoError}</p>
          ) : summary.autoLogoCreatedCount ? (
            <p className="mt-2 text-zinc-500">
              Added {summary.autoLogoCreatedCount} supplier logos.
            </p>
          ) : null}
          {(summary.needsReviewCount ?? 0) > 0 ? (
            <Link
              className="mt-2 inline-flex h-9 items-center justify-center rounded-md bg-zinc-950 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
              href={`/imports/${importId}/recurring-candidates`}
            >
              Review {summary.needsReviewCount} candidates
            </Link>
          ) : (
            <p className="mt-2 font-medium text-zinc-950">
              All recurring payments were triaged automatically.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
