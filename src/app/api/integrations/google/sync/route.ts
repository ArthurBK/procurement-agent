import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { runGoogleWorkspaceSync } from "@/lib/integrations/google/sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { organizationId } = await getIntegrationRequestContext();
    const summary = await runGoogleWorkspaceSync({
      organizationId,
      supabaseAdmin: createSupabaseAdminClient(),
    });

    return Response.json({ summary });
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
            : "Unable to sync Google Workspace.",
        ],
      },
      { status: 500 },
    );
  }
}
