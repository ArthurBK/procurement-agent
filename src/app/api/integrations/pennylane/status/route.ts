import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { loadPennylaneStatus } from "@/lib/integrations/pennylane/frontendData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { organizationId } = await getIntegrationRequestContext();
    const status = await loadPennylaneStatus({
      organizationId,
      supabaseAdmin: createSupabaseAdminClient(),
    });

    return Response.json(status);
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    const message =
      error instanceof Error
        ? error.message
        : "Unable to load Pennylane status.";

    return Response.json({ errors: [message] }, { status: 500 });
  }
}
