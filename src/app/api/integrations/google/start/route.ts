import { randomBytes } from "crypto";
import { addMinutes } from "date-fns";
import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { createIntegrationAuditLog } from "@/lib/integrations/audit";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { buildGoogleAuthorizationUrl } from "@/lib/integrations/google/oauth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { organizationId, userId } = await getIntegrationRequestContext();
    const supabaseAdmin = createSupabaseAdminClient();
    const state = randomBytes(32).toString("base64url");
    const { error } = await supabaseAdmin.from("google_oauth_states").insert({
      expires_at: addMinutes(new Date(), 10).toISOString(),
      organization_id: organizationId,
      state,
      user_id: userId,
    });

    if (error) {
      return Response.json(
        { errors: [`Unable to start Google OAuth: ${error.message}`] },
        { status: 500 },
      );
    }

    await createIntegrationAuditLog({
      action: "connect_started",
      actorUserId: userId,
      integrationId: null,
      organizationId,
      provider: "google_workspace",
      supabaseAdmin,
    });

    return Response.redirect(buildGoogleAuthorizationUrl({ state }), 302);
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
            : "Unable to start Google Workspace OAuth.",
        ],
      },
      { status: 500 },
    );
  }
}
