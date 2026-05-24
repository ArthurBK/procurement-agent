import type { NextRequest } from "next/server";
import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { createIntegrationAuditLog } from "@/lib/integrations/audit";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import {
  buildGoogleWorkspaceSyncLinkUrl,
  createGoogleWorkspaceSyncLinkToken,
  getGoogleWorkspaceSyncLinkExpiresAt,
  getPublicAppOrigin,
  hashGoogleWorkspaceSyncLinkToken,
} from "@/lib/integrations/google/syncLinks";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { organizationId, userId } = await getIntegrationRequestContext();
    const supabaseAdmin = createSupabaseAdminClient();
    const token = createGoogleWorkspaceSyncLinkToken();
    const expiresAt = getGoogleWorkspaceSyncLinkExpiresAt();
    const { data: syncLink, error } = await supabaseAdmin
      .from("google_workspace_sync_links")
      .insert({
        created_by_user_id: userId,
        expires_at: expiresAt.toISOString(),
        organization_id: organizationId,
        token_hash: hashGoogleWorkspaceSyncLinkToken(token),
      })
      .select("id")
      .single();

    if (error || !syncLink) {
      return Response.json(
        {
          errors: [
            `Unable to create Google Workspace sync link: ${
              error?.message ?? "missing sync link row"
            }`,
          ],
        },
        { status: 500 },
      );
    }

    await createIntegrationAuditLog({
      action: "external_sync_link_created",
      actorUserId: userId,
      integrationId: null,
      metadata: {
        expiresAt: expiresAt.toISOString(),
        syncLinkId: (syncLink as { id: string }).id,
      },
      organizationId,
      provider: "google_workspace",
      supabaseAdmin,
    });

    return Response.json({
      expiresAt: expiresAt.toISOString(),
      url: buildGoogleWorkspaceSyncLinkUrl({
        origin: getPublicAppOrigin(request.url),
        token,
      }),
    });
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
            : "Unable to create Google Workspace sync link.",
        ],
      },
      { status: 500 },
    );
  }
}
