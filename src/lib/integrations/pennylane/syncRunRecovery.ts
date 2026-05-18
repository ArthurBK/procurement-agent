import "server-only";

import {
  buildStalePennylaneSyncMessage,
  getPennylaneSyncStaleAfterMs,
  isPennylaneSyncingIntegrationStale,
  isPennylaneSyncRunStale,
} from "@/lib/integrations/pennylane/syncRunStaleness";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type RunningSyncRunRow = {
  id: string;
  integration_id: string | null;
  started_at: string;
};

type PennylaneIntegrationSyncRow = {
  id: string;
  last_sync_started_at: string | null;
  status: string;
};

export async function recoverStalePennylaneSyncRuns({
  now = new Date(),
  organizationId,
  supabaseAdmin,
}: {
  now?: Date;
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<{ recoveredRuns: number; recoveredIntegration: boolean }> {
  const staleAfterMs = getPennylaneSyncStaleAfterMs();
  const [runningRunsResult, integrationResult] = await Promise.all([
    supabaseAdmin
      .from("pennylane_sync_runs")
      .select("id, integration_id, started_at")
      .eq("organization_id", organizationId)
      .eq("status", "running"),
    supabaseAdmin
      .from("integrations")
      .select("id, status, last_sync_started_at")
      .eq("organization_id", organizationId)
      .eq("provider", "pennylane")
      .maybeSingle(),
  ]);

  if (runningRunsResult.error) {
    throw new Error(
      `Unable to load running Pennylane sync runs: ${runningRunsResult.error.message}`,
    );
  }

  if (integrationResult.error) {
    throw new Error(
      `Unable to load Pennylane integration state: ${integrationResult.error.message}`,
    );
  }

  const runningRuns = (runningRunsResult.data ?? []) as RunningSyncRunRow[];
  const staleRuns = runningRuns.filter((run) =>
    isPennylaneSyncRunStale({
      now,
      staleAfterMs,
      startedAt: run.started_at,
    }),
  );
  const activeRunningRuns = runningRuns.filter(
    (run) => !staleRuns.some((staleRun) => staleRun.id === run.id),
  );
  const latestStaleStartedAt =
    staleRuns
      .map((run) => run.started_at)
      .sort()
      .at(-1) ?? null;
  const integration =
    integrationResult.data as unknown as PennylaneIntegrationSyncRow | null;
  const staleMessage = buildStalePennylaneSyncMessage(
    latestStaleStartedAt ?? integration?.last_sync_started_at ?? null,
  );

  if (staleRuns.length > 0) {
    const { error } = await supabaseAdmin
      .from("pennylane_sync_runs")
      .update({
        completed_at: now.toISOString(),
        error_message: staleMessage,
        status: "failed",
        summary_json: {
          errors: [staleMessage],
          recoveredStaleRun: true,
        },
        updated_at: now.toISOString(),
      })
      .in(
        "id",
        staleRuns.map((run) => run.id),
      );

    if (error) {
      throw new Error(`Unable to recover stale Pennylane sync runs: ${error.message}`);
    }
  }

  const shouldRecoverIntegration =
    integration?.status === "syncing" &&
    activeRunningRuns.length === 0 &&
    (staleRuns.length > 0 ||
      isPennylaneSyncingIntegrationStale({
        now,
        staleAfterMs,
        startedAt: integration.last_sync_started_at,
      }));

  if (integration && shouldRecoverIntegration) {
    const { error } = await supabaseAdmin
      .from("integrations")
      .update({
        last_error: staleMessage,
        status: "error",
        updated_at: now.toISOString(),
      })
      .eq("id", integration.id);

    if (error) {
      throw new Error(`Unable to recover stale Pennylane integration: ${error.message}`);
    }
  }

  return {
    recoveredIntegration: Boolean(shouldRecoverIntegration),
    recoveredRuns: staleRuns.length,
  };
}
