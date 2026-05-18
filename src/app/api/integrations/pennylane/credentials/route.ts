import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { revalidatePennylaneFrontendCache } from "@/lib/frontend-cache";
import { createIntegrationAuditLog } from "@/lib/integrations/audit";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { PennylaneApiError, PennylaneClient } from "@/lib/integrations/pennylane/client";
import { loadPennylaneStatus } from "@/lib/integrations/pennylane/frontendData";
import { encryptSecret } from "@/lib/security/encryption";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type SavePennylaneCredentialsBody = {
  apiToken?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SavePennylaneCredentialsBody;
    const apiToken = body.apiToken?.trim();

    if (!apiToken) {
      return Response.json(
        { errors: ["Pennylane API key is required."] },
        { status: 400 },
      );
    }

    await new PennylaneClient({ apiToken }).testConnection();

    const context = await getIntegrationRequestContext();
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: integration, error } = await supabaseAdmin
      .from("integrations")
      .upsert(
        {
          access_token_expires_at: null,
          connected_by_user_id: context.userId,
          encrypted_access_token: encryptSecret(apiToken),
          encrypted_refresh_token: null,
          granted_scopes: [],
          last_error: null,
          organization_id: context.organizationId,
          provider: "pennylane",
          status: "connected",
        },
        { onConflict: "organization_id,provider" },
      )
      .select("id")
      .single();

    if (error || !integration) {
      return Response.json(
        {
          errors: [
            `Unable to save Pennylane integration: ${
              error?.message ?? "missing integration row"
            }`,
          ],
        },
        { status: 500 },
      );
    }

    await createIntegrationAuditLog({
      action: "connected",
      actorUserId: context.userId,
      integrationId: (integration as { id: string }).id,
      organizationId: context.organizationId,
      provider: "pennylane",
      supabaseAdmin,
    });
    revalidatePennylaneFrontendCache(context.organizationId);

    const status = await loadPennylaneStatus({
      organizationId: context.organizationId,
      supabaseAdmin,
    });

    return Response.json(status);
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    const message =
      error instanceof Error ? error.message : "Unable to save Pennylane key.";
    const status = error instanceof PennylaneApiError ? 400 : 500;

    return Response.json({ errors: [message] }, { status });
  }
}
