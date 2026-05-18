import { addMonths } from "date-fns";
import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { loadRenewals } from "@/lib/contracts/frontendData";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
    const to =
      url.searchParams.get("to") ??
      addMonths(new Date(from), 12).toISOString().slice(0, 10);
    const { organizationId } = await getIntegrationRequestContext();
    const renewals = await loadRenewals({
      from,
      organizationId,
      supabaseAdmin: createSupabaseAdminClient(),
      to,
    });

    return Response.json({ from, renewals, to });
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    return Response.json(
      {
        errors: [
          error instanceof Error ? error.message : "Unable to load renewals.",
        ],
      },
      { status: 500 },
    );
  }
}
