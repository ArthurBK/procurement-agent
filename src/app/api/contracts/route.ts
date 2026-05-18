import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { loadContracts } from "@/lib/contracts/frontendData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { organizationId } = await getIntegrationRequestContext();
    const contracts = await loadContracts({
      confidence: url.searchParams.get("confidence"),
      from: url.searchParams.get("from"),
      organizationId,
      sourceSystem: url.searchParams.get("source_system"),
      status: url.searchParams.get("status"),
      supabaseAdmin: createSupabaseAdminClient(),
      to: url.searchParams.get("to"),
      vendor: url.searchParams.get("vendor"),
    });

    return Response.json({ contracts });
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    return Response.json(
      {
        errors: [
          error instanceof Error ? error.message : "Unable to load contracts.",
        ],
      },
      { status: 500 },
    );
  }
}
