"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DetectRecurringPaymentsResponse = {
  errors?: string[];
};

export function ViewSubscriptionsButton({ importId }: { importId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  async function handleViewSubscriptions() {
    setError(null);
    setIsPreparing(true);

    try {
      const response = await fetch(
        `/api/imports/${importId}/recurring-candidates/detect`,
        { method: "POST" },
      );
      const result = (await response.json()) as DetectRecurringPaymentsResponse;

      if (!response.ok) {
        setError(result.errors?.[0] ?? "Unable to prepare subscriptions.");
        return;
      }

      router.push(`/imports/${importId}/subscriptions`);
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to prepare subscriptions.",
      );
    } finally {
      setIsPreparing(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        className="text-sm font-medium text-zinc-700 hover:underline disabled:cursor-not-allowed disabled:text-zinc-400"
        disabled={isPreparing}
        onClick={handleViewSubscriptions}
        type="button"
      >
        {isPreparing ? "Preparing subscriptions..." : "View subscriptions"}
      </button>
      {error ? (
        <p className="max-w-md text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
