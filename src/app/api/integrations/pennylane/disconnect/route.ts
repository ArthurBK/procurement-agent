import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { revalidatePennylaneFrontendCache } from "@/lib/frontend-cache";
import { createIntegrationAuditLog } from "@/lib/integrations/audit";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { loadPennylaneStatus } from "@/lib/integrations/pennylane/frontendData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export async function DELETE() {
  try {
    const { organizationId, userId } = await getIntegrationRequestContext();
    const supabaseAdmin = createSupabaseAdminClient();
    const currentStatus = await loadPennylaneStatus({
      organizationId,
      supabaseAdmin,
    });

    if (currentStatus.status === "syncing") {
      return Response.json(
        { errors: ["A Pennylane sync is already running."] },
        { status: 409 },
      );
    }

    const deleted = await deletePennylaneData({
      organizationId,
      supabaseAdmin,
    });
    const integration = await markPennylaneDisconnected({
      organizationId,
      supabaseAdmin,
    });

    await createIntegrationAuditLog({
      action: "disconnected",
      actorUserId: userId,
      integrationId: integration.id,
      metadata: { deleteSyncedData: true, deleted },
      organizationId,
      provider: "pennylane",
      supabaseAdmin,
    });
    revalidatePennylaneFrontendCache(organizationId);

    const status = await loadPennylaneStatus({
      organizationId,
      supabaseAdmin,
    });

    return Response.json({ ...status, deleted });
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    return Response.json(
      {
        errors: [
          error instanceof Error ? error.message : "Unable to disconnect Pennylane.",
        ],
      },
      { status: 500 },
    );
  }
}

async function deletePennylaneData({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}) {
  const [
    automaticLinksResult,
    contractsResult,
    suppliersResult,
    invoicesResult,
    syncRunsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("contract_app_links")
      .delete({ count: "exact" })
      .eq("organization_id", organizationId)
      .eq("matched_by", "automatic"),
    supabaseAdmin
      .from("contracts")
      .delete({ count: "exact" })
      .eq("organization_id", organizationId)
      .eq("source_system", "pennylane"),
    supabaseAdmin
      .from("saas_suppliers")
      .delete({ count: "exact" })
      .eq("organization_id", organizationId)
      .eq("source", "pennylane"),
    supabaseAdmin
      .from("pennylane_supplier_invoices")
      .delete({ count: "exact" })
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("pennylane_sync_runs")
      .delete({ count: "exact" })
      .eq("organization_id", organizationId),
  ]);

  const results = [
    ["contract app links", automaticLinksResult],
    ["contracts", contractsResult],
    ["Pennylane-only suppliers", suppliersResult],
    ["supplier invoices", invoicesResult],
    ["sync runs", syncRunsResult],
  ] as const;

  for (const [label, result] of results) {
    if (result.error) {
      throw new Error(`Unable to delete Pennylane ${label}: ${result.error.message}`);
    }
  }

  return {
    contractAppLinks: automaticLinksResult.count ?? 0,
    contracts: contractsResult.count ?? 0,
    invoices: invoicesResult.count ?? 0,
    saasSuppliers: suppliersResult.count ?? 0,
    syncRuns: syncRunsResult.count ?? 0,
  };
}

async function markPennylaneDisconnected({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .upsert(
      {
        access_token_expires_at: null,
        connected_admin_email: null,
        connected_by_user_id: null,
        encrypted_access_token: null,
        encrypted_refresh_token: null,
        granted_scopes: [],
        last_error: null,
        last_sync_completed_at: null,
        last_sync_started_at: null,
        organization_id: organizationId,
        provider: "pennylane",
        status: "disconnected",
      },
      { onConflict: "organization_id,provider" },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to mark Pennylane disconnected: ${
        error?.message ?? "missing integration row"
      }`,
    );
  }

  return data as { id: string };
}
