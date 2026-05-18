import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { loadGoogleStatus } from "@/lib/integrations/google/frontendData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { organizationId } = await getIntegrationRequestContext();
    const status = await loadGoogleStatus({
      organizationId,
      supabaseAdmin: createSupabaseAdminClient(),
    });

    return Response.json({
      connectedAdminEmail: status.connectedAdminEmail,
      lastError: status.lastError,
      lastSyncCompletedAt: status.lastSyncCompletedAt,
      lastSyncStartedAt: status.lastSyncStartedAt,
      oauthAppsDiscovered: status.oauthAppsDiscovered,
      samlAppsDiscovered: status.samlAppsDiscovered,
      status: status.status,
      suppliersMatched: status.suppliersMatched,
      usersSynced: status.usersSynced,
    });
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
            : "Unable to load Google Workspace status.",
        ],
      },
      { status: 500 },
    );
  }
}
