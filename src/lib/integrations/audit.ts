import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export async function createIntegrationAuditLog({
  action,
  actorUserId,
  integrationId,
  message,
  metadata = {},
  organizationId,
  provider,
  supabaseAdmin,
}: {
  action: string;
  actorUserId: string | null;
  integrationId: string | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
  organizationId: string;
    provider: "google_workspace" | "pennylane";
  supabaseAdmin: SupabaseAdminClient;
}) {
  await supabaseAdmin.from("integration_audit_logs").insert({
    action,
    actor_user_id: actorUserId,
    integration_id: integrationId,
    message: message ?? null,
    metadata,
    organization_id: organizationId,
    provider,
  });
}
