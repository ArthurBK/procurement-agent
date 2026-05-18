import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { organizationId } = await getIntegrationRequestContext();
    const { data, error } = await createSupabaseAdminClient()
      .from("pennylane_sync_runs")
      .select(
        [
          "id",
          "status",
          "started_at",
          "completed_at",
          "error_message",
          "summary_json",
        ].join(", "),
      )
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(20);

    if (error) {
      return Response.json(
        { errors: [`Unable to load Pennylane sync runs: ${error.message}`] },
        { status: 500 },
      );
    }

    return Response.json({ syncRuns: data ?? [] });
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
            : "Unable to load Pennylane sync runs.",
        ],
      },
      { status: 500 },
    );
  }
}
