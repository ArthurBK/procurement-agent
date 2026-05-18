import { loadContractGaps } from "@/lib/contracts/frontendData";
import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { organizationId } = await getIntegrationRequestContext();
    const gaps = await loadContractGaps({
      organizationId,
      supabaseAdmin: createSupabaseAdminClient(),
    });

    return Response.json(gaps);
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    return Response.json(
      {
        errors: [
          error instanceof Error ? error.message : "Unable to load contract gaps.",
        ],
      },
      { status: 500 },
    );
  }
}
