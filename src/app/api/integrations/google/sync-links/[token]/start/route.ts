import { randomBytes } from "crypto";
import { addMinutes } from "date-fns";
import type { NextRequest } from "next/server";
import { createIntegrationAuditLog } from "@/lib/integrations/audit";
import { buildGoogleAuthorizationUrl } from "@/lib/integrations/google/oauth";
import {
  getGoogleWorkspaceSyncLinkValidation,
  hashGoogleWorkspaceSyncLinkToken,
} from "@/lib/integrations/google/syncLinks";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type SyncLinkRow = {
  consumed_at: string | null;
  expires_at: string;
  id: string;
  organization_id: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!token) {
    return redirectToSyncLinkComplete(request, "invalid");
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const tokenHash = hashGoogleWorkspaceSyncLinkToken(token);
  const { data: syncLink, error } = await supabaseAdmin
    .from("google_workspace_sync_links")
    .select("id, organization_id, expires_at, consumed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !syncLink) {
    return redirectToSyncLinkComplete(request, "invalid");
  }

  const linkRow = syncLink as SyncLinkRow;
  const validation = getGoogleWorkspaceSyncLinkValidation(linkRow);

  if (validation !== "valid") {
    return redirectToSyncLinkComplete(request, validation);
  }

  const state = randomBytes(32).toString("base64url");
  const now = new Date();
  const { data: consumedLink, error: consumeError } = await supabaseAdmin
    .from("google_workspace_sync_links")
    .update({
      consumed_at: now.toISOString(),
      last_error: null,
      oauth_state: state,
    })
    .eq("id", linkRow.id)
    .is("consumed_at", null)
    .gt("expires_at", now.toISOString())
    .select("id, organization_id")
    .maybeSingle();

  if (consumeError || !consumedLink) {
    const { data: latestLink } = await supabaseAdmin
      .from("google_workspace_sync_links")
      .select("expires_at, consumed_at")
      .eq("id", linkRow.id)
      .maybeSingle();
    const latestValidation = latestLink
      ? getGoogleWorkspaceSyncLinkValidation(
          latestLink as { consumed_at: string | null; expires_at: string },
        )
      : "invalid";

    return redirectToSyncLinkComplete(request, latestValidation);
  }

  const { error: stateError } = await supabaseAdmin
    .from("google_oauth_states")
    .insert({
      expires_at: addMinutes(now, 10).toISOString(),
      organization_id: linkRow.organization_id,
      state,
      user_id: null,
    });

  if (stateError) {
    await supabaseAdmin
      .from("google_workspace_sync_links")
      .update({ last_error: stateError.message })
      .eq("id", linkRow.id);

    return redirectToSyncLinkComplete(request, "link_start_failed");
  }

  await createIntegrationAuditLog({
    action: "external_sync_link_started",
    actorUserId: null,
    integrationId: null,
    metadata: { syncLinkId: linkRow.id },
    organizationId: linkRow.organization_id,
    provider: "google_workspace",
    supabaseAdmin,
  });

  return Response.redirect(buildGoogleAuthorizationUrl({ state }), 302);
}

function redirectToSyncLinkComplete(
  request: NextRequest,
  status: string,
): Response {
  const redirectUrl = new URL(
    "/integrations/google/sync-link/complete",
    request.url,
  );
  redirectUrl.searchParams.set("status", status);

  return Response.redirect(redirectUrl, 302);
}
