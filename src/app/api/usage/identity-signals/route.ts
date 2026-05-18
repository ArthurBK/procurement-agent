import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { loadIdentitySignals } from "@/lib/integrations/google/frontendData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { organizationId } = await getIntegrationRequestContext();
    const payload = await loadIdentitySignals({
      organizationId,
      supabaseAdmin: createSupabaseAdminClient(),
    });

    return Response.json(payload);
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
            : "Unable to load identity signals.",
        ],
      },
      { status: 500 },
    );
  }
}
