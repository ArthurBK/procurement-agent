"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PennylaneFrontendStatus } from "@/lib/integrations/pennylane/frontendData";

type PennylaneSyncResult = {
  status: string;
  summary: {
    aiExtractionsAttempted: number;
    aiExtractionsSucceeded: number;
    contractsInferred: number;
    errors: string[];
    invoicesFetched: number;
    matchesCreated: number;
    missingContractsDetected: number;
  };
  syncRunId: string;
};

export function PennylaneIntegrationCard({
  initialStatus,
}: {
  initialStatus: PennylaneFrontendStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<PennylaneFrontendStatus>(initialStatus);
  const [apiToken, setApiToken] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshStatus = useCallback(async () => {
    const response = await fetch("/api/integrations/pennylane/status");
    const result = (await response.json()) as PennylaneFrontendStatus & {
      errors?: string[];
    };

    if (!response.ok) {
      throw new Error(result.errors?.[0] ?? "Unable to load Pennylane status.");
    }

    setStatus(result);
  }, []);

  useEffect(() => {
    if (status.status !== "syncing") {
      return;
    }

    const intervalId = window.setInterval(() => {
      refreshStatus()
        .then(() => {
          router.refresh();
        })
        .catch(() => undefined);
    }, 5_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshStatus, router, status.status]);

  async function saveKey() {
    const token = apiToken.trim();

    if (!token) {
      setActionError("Enter a Pennylane API key before saving.");
      return;
    }

    setActionError(null);
    setActionMessage(null);
    setIsSaving(true);

    try {
      const response = await fetch("/api/integrations/pennylane/credentials", {
        body: JSON.stringify({ apiToken: token }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as PennylaneFrontendStatus & {
        errors?: string[];
      };

      if (!response.ok) {
        throw new Error(result.errors?.[0] ?? "Unable to save Pennylane key.");
      }

      setStatus(result);
      setApiToken("");
      setActionMessage("Pennylane key saved.");
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to save Pennylane key.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function runSync() {
    setActionError(null);
    setActionMessage(null);
    setIsSyncing(true);
    setStatus((current) => ({ ...current, status: "syncing" }));

    try {
      const response = await fetch("/api/integrations/pennylane/sync", {
        method: "POST",
      });
      const result = (await response.json()) as PennylaneSyncResult & {
        errors?: string[];
      };

      if (!response.ok) {
        throw new Error(result.errors?.[0] ?? "Unable to sync Pennylane.");
      }

      setActionMessage(buildSyncMessage(result));
      await refreshStatus();
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to sync Pennylane.",
      );
      await refreshStatus().catch(() => undefined);
    } finally {
      setIsSyncing(false);
    }
  }

  const canSync = status.hasApiKey && status.status !== "syncing";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-zinc-950">Pennylane</h2>
            <PennylaneStatusPill status={status.status} />
          </div>
          <p className="max-w-3xl text-sm leading-6 text-zinc-600">
            Sync supplier invoices, infer SaaS contracts, and match them with
            Google Workspace identity signals.
          </p>

          <dl className="grid gap-3 text-sm text-zinc-700 sm:grid-cols-2 lg:grid-cols-4">
            <MetadataItem label="API key" value={formatApiKeySource(status)} />
            <MetadataItem
              label="Last sync"
              value={formatLastSync(status)}
            />
            <MetadataItem
              label="Invoices synced"
              value={String(status.invoicesSynced)}
            />
            <MetadataItem
              label="Contracts inferred"
              value={String(status.contractsInferred)}
            />
          </dl>

          {status.lastError ? (
            <p className="max-w-3xl text-sm text-red-700">{status.lastError}</p>
          ) : null}
          {actionError ? (
            <p className="max-w-3xl text-sm text-red-700" role="alert">
              {actionError}
            </p>
          ) : null}
          {actionMessage ? (
            <p className="max-w-3xl text-sm text-emerald-700">{actionMessage}</p>
          ) : null}
        </div>

        <div className="flex w-full flex-col gap-3 lg:w-[360px]">
          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            Pennylane API key
            <input
              autoComplete="off"
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm font-normal text-zinc-950 outline-none transition focus:border-zinc-500"
              onChange={(event) => setApiToken(event.target.value)}
              placeholder="Paste a Pennylane API key"
              type="password"
              value={apiToken}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
              disabled={isSaving || !apiToken.trim()}
              onClick={saveKey}
              type="button"
            >
              {isSaving ? "Saving..." : "Save key"}
            </button>
            <button
              className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canSync || isSyncing}
              onClick={runSync}
              type="button"
            >
              {isSyncing || status.status === "syncing" ? "Syncing..." : "Run sync"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PennylaneStatusPill({
  status,
}: {
  status: PennylaneFrontendStatus["status"];
}) {
  const styles = {
    connected: "bg-emerald-50 text-emerald-700",
    error: "bg-red-50 text-red-700",
    not_connected: "bg-zinc-100 text-zinc-600",
    syncing: "bg-indigo-50 text-indigo-700",
  } satisfies Record<PennylaneFrontendStatus["status"], string>;

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}>
      {formatEnum(status)}
    </span>
  );
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt>
      <dd className="mt-1 font-medium text-zinc-950">{value}</dd>
    </div>
  );
}

function formatApiKeySource(status: PennylaneFrontendStatus): string {
  if (status.apiKeySource === "custom") {
    return "Custom key";
  }

  if (status.apiKeySource === "environment") {
    return "Environment key";
  }

  return "Not configured";
}

function buildSyncMessage(result: PennylaneSyncResult): string {
  return [
    `Synced ${result.summary.invoicesFetched} invoices`,
    `inferred ${result.summary.contractsInferred} contracts`,
    `created ${result.summary.matchesCreated} matches`,
  ].join(", ");
}

function formatLastSync(status: PennylaneFrontendStatus): string {
  const date = formatNullableDate(status.lastSyncCompletedAt);

  if (!status.latestSyncStatus || date === "-") {
    return date;
  }

  return `${date} · ${formatEnum(status.latestSyncStatus)}`;
}

function formatNullableDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatEnum(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
