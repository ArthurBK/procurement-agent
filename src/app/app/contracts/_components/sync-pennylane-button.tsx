"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PennylaneSyncResult = {
  status: string;
  summary: {
    aiExtractionsAttempted: number;
    aiExtractionsFailed: number;
    aiExtractionsReused: number;
    aiExtractionsSkipped: number;
    aiExtractionsSucceeded: number;
    contractsInferred: number;
    errors: string[];
    invoicesCreated: number;
    invoicesFetched: number;
    invoicesUpdated: number;
    matchesCreated: number;
    missingContractsDetected: number;
    orphanContractsDetected: number;
    possibleMatchesDetected: number;
    suppliersFetched: number;
    warnings: string[];
  };
  syncRunId: string;
};

export function SyncPennylaneButton({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<PennylaneSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSync() {
    setError(null);
    setResult(null);
    setIsSyncing(true);

    try {
      const response = await fetch("/api/pennylane/sync", { method: "POST" });
      const payload = (await response.json()) as PennylaneSyncResult & {
        errors?: string[];
      };

      if (!response.ok) {
        throw new Error(payload.errors?.[0] ?? "Unable to sync Pennylane.");
      }

      setResult(payload);
      router.refresh();
    } catch (syncError) {
      setError(
        syncError instanceof Error ? syncError.message : "Unable to sync Pennylane.",
      );
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        className="inline-flex h-10 w-fit items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        disabled={disabled || isSyncing}
        onClick={runSync}
        type="button"
      >
        {isSyncing ? "Syncing Pennylane..." : "Sync Pennylane"}
      </button>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Synced {result.summary.invoicesFetched} invoices, inferred{" "}
          {result.summary.contractsInferred} contracts, created{" "}
          {result.summary.matchesCreated} matches, detected{" "}
          {result.summary.missingContractsDetected} missing contracts.
          {result.summary.aiExtractionsAttempted > 0
            ? ` AI extracted ${result.summary.aiExtractionsSucceeded}/${result.summary.aiExtractionsAttempted} ambiguous invoices.`
            : ""}
        </div>
      ) : null}
    </div>
  );
}
