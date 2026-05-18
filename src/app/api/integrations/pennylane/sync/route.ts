import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { revalidatePennylaneFrontendCache } from "@/lib/frontend-cache";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { runPennylaneSync } from "@/lib/integrations/pennylane/sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    const context = await getIntegrationRequestContext();
    const result = await runPennylaneSync({
      context,
      supabaseAdmin: createSupabaseAdminClient(),
    });
    revalidatePennylaneFrontendCache(context.organizationId);
    const status = result.status === "failed" ? 500 : 200;

    return Response.json(result, { status });
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    const message =
      error instanceof Error ? error.message : "Unable to sync Pennylane.";
    const status = message.includes("already running") ? 409 : 500;

    return Response.json({ errors: [message] }, { status });
  }
}
