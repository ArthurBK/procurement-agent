import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { createIntegrationAuditLog } from "@/lib/integrations/audit";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { revokeGoogleToken } from "@/lib/integrations/google/oauth";
import { decryptSecret } from "@/lib/security/encryption";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type DisconnectBody = {
  deleteSyncedData?: boolean;
};

type IntegrationRow = {
  delete_synced_data_on_disconnect: boolean;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  id: string;
};

export async function DELETE(request: Request) {
  try {
    const { organizationId, userId } = await getIntegrationRequestContext();
    const supabaseAdmin = createSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as DisconnectBody;
    const { data: integrationData, error: integrationError } =
      await supabaseAdmin
        .from("integrations")
        .select(
          [
            "id",
            "encrypted_access_token",
            "encrypted_refresh_token",
            "delete_synced_data_on_disconnect",
          ].join(", "),
        )
        .eq("organization_id", organizationId)
        .eq("provider", "google_workspace")
        .maybeSingle();

    if (integrationError) {
      return Response.json(
        { errors: [`Unable to load integration: ${integrationError.message}`] },
        { status: 500 },
      );
    }

    if (!integrationData) {
      return Response.json({ status: "disconnected" });
    }

    const integration = integrationData as unknown as IntegrationRow;
    const tokenToRevoke =
      integration.encrypted_refresh_token ?? integration.encrypted_access_token;

    if (tokenToRevoke) {
      await revokeTokenBestEffort(tokenToRevoke);
    }

    const shouldDeleteSyncedData =
      body.deleteSyncedData ?? integration.delete_synced_data_on_disconnect;

    if (shouldDeleteSyncedData) {
      await deleteSyncedGoogleData({ organizationId, supabaseAdmin });
    }

    await supabaseAdmin
      .from("integrations")
      .update({
        access_token_expires_at: null,
        connected_admin_email: null,
        encrypted_access_token: null,
        encrypted_refresh_token: null,
        granted_scopes: [],
        last_error: null,
        status: "disconnected",
      })
      .eq("id", integration.id);

    await createIntegrationAuditLog({
      action: "disconnected",
      actorUserId: userId,
      integrationId: integration.id,
      metadata: { deleteSyncedData: shouldDeleteSyncedData },
      organizationId,
      provider: "google_workspace",
      supabaseAdmin,
    });

    return Response.json({ status: "disconnected" });
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    return Response.json(
      {
        errors: [
          error instanceof Error
            ? error.message
            : "Unable to disconnect Google Workspace.",
        ],
      },
      { status: 500 },
    );
  }
}

async function revokeTokenBestEffort(encryptedToken: string) {
  try {
    await revokeGoogleToken(decryptSecret(encryptedToken));
  } catch {
    // Disconnect must still clear local credentials if Google revoke is unavailable.
  }
}

async function deleteSyncedGoogleData({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
}) {
  await Promise.all([
    supabaseAdmin
      .from("google_workspace_users")
      .delete()
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("google_oauth_events")
      .delete()
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("google_saml_events")
      .delete()
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("google_login_events")
      .delete()
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("google_authorized_apps")
      .delete()
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("supplier_identity_matches")
      .delete()
      .eq("organization_id", organizationId),
  ]);
}
