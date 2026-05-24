import "server-only";

import { recoverStalePennylaneSyncRuns } from "@/lib/integrations/pennylane/syncRunRecovery";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type PennylaneFrontendStatus = {
  apiKeySource: "custom" | "environment" | "missing";
  contractsInferred: number;
  hasApiKey: boolean;
  invoicesSynced: number;
  lastError: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncStartedAt: string | null;
  latestSyncStatus: string | null;
  status: "connected" | "error" | "not_connected" | "syncing";
};

type PennylaneIntegrationRow = {
  encrypted_access_token: string | null;
  last_error: string | null;
  last_sync_completed_at: string | null;
  last_sync_started_at: string | null;
  status: string;
};

type PennylaneSyncRunRow = {
  completed_at: string | null;
  started_at: string;
  status: string;
};

export async function loadPennylaneStatus({
  organizationId,
  recoverStaleRuns = true,
  supabaseAdmin,
}: {
  organizationId: string;
  recoverStaleRuns?: boolean;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<PennylaneFrontendStatus> {
  if (recoverStaleRuns) {
    await recoverStalePennylaneSyncRuns({
      organizationId,
      supabaseAdmin,
    });
  }

  const [integrationResult, latestSyncResult, invoicesResult, contractsResult] =
    await Promise.all([
      supabaseAdmin
        .from("integrations")
        .select(
          [
            "status",
            "encrypted_access_token",
            "last_sync_started_at",
            "last_sync_completed_at",
            "last_error",
          ].join(", "),
        )
        .eq("organization_id", organizationId)
        .eq("provider", "pennylane")
        .maybeSingle(),
      supabaseAdmin
        .from("pennylane_sync_runs")
        .select("status, started_at, completed_at")
        .eq("organization_id", organizationId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("pennylane_supplier_invoices")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      supabaseAdmin
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("source_system", "pennylane"),
    ]);

  for (const result of [
    integrationResult,
    latestSyncResult,
    invoicesResult,
    contractsResult,
  ]) {
    if (result.error) {
      throw new Error(`Unable to load Pennylane status: ${result.error.message}`);
    }
  }

  const integration =
    integrationResult.data as unknown as PennylaneIntegrationRow | null;
  const latestSync =
    latestSyncResult.data as unknown as PennylaneSyncRunRow | null;
  const apiKeySource = getApiKeySource(integration);

  return {
    apiKeySource,
    contractsInferred: contractsResult.count ?? 0,
    hasApiKey: apiKeySource !== "missing",
    invoicesSynced: invoicesResult.count ?? 0,
    lastError: integration?.last_error ?? null,
    lastSyncCompletedAt:
      integration?.last_sync_completed_at ?? latestSync?.completed_at ?? null,
    lastSyncStartedAt:
      integration?.last_sync_started_at ?? latestSync?.started_at ?? null,
    latestSyncStatus: latestSync?.status ?? null,
    status: toPennylaneFrontendStatus(integration?.status, apiKeySource),
  };
}

function getApiKeySource(
  integration: PennylaneIntegrationRow | null,
): PennylaneFrontendStatus["apiKeySource"] {
  if (integration?.encrypted_access_token) {
    return "custom";
  }

  return process.env.PENNYLANE_API_TOKEN ? "environment" : "missing";
}

function toPennylaneFrontendStatus(
  status: string | null | undefined,
  apiKeySource: PennylaneFrontendStatus["apiKeySource"],
): PennylaneFrontendStatus["status"] {
  if (status === "disconnected" || status === "not_connected") {
    return "not_connected";
  }

  if (status === "syncing") {
    return "syncing";
  }

  if (status === "error") {
    return "error";
  }

  if (apiKeySource !== "missing") {
    return "connected";
  }

  return "not_connected";
}
