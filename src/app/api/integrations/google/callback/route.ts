import { addSeconds } from "date-fns";
import type { NextRequest } from "next/server";
import { revalidateGoogleFrontendCache } from "@/lib/frontend-cache";
import { createIntegrationAuditLog } from "@/lib/integrations/audit";
import { getGoogleTokenInfo } from "@/lib/integrations/google/api";
import {
  exchangeGoogleAuthorizationCode,
  parseGrantedScopes,
} from "@/lib/integrations/google/oauth";
import {
  runGoogleWorkspaceSmokeTest,
  runGoogleWorkspaceSync,
} from "@/lib/integrations/google/sync";
import { encryptSecret } from "@/lib/security/encryption";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseUrl } from "@/lib/supabase/env";

export const runtime = "nodejs";

type OAuthStateRow = {
  consumed_at: string | null;
  expires_at: string;
  organization_id: string;
  user_id: string | null;
};

type ExternalSyncLinkRow = {
  id: string;
  organization_id: string;
};

export async function GET(request: NextRequest) {
  const callbackUrl = new URL(request.url);
  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const oauthError = callbackUrl.searchParams.get("error");

  if (!state) {
    if (oauthError) {
      return redirectToGooglePage(request, `oauth_${oauthError}`);
    }

    return redirectToGooglePage(request, "missing_code_or_state");
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const { data: stateRow, error: stateError } = await supabaseAdmin
    .from("google_oauth_states")
    .select("organization_id, user_id, expires_at, consumed_at")
    .eq("state", state)
    .maybeSingle();

  if (!stateError && !stateRow) {
    return redirectToSupabaseAuthCallback(request);
  }

  if (stateError) {
    return redirectToGooglePage(request, "invalid_state");
  }

  const oauthState = stateRow as unknown as OAuthStateRow;
  const externalSyncLink = await loadExternalSyncLink({
    state,
    supabaseAdmin,
  });

  if (oauthError) {
    await updateExternalSyncLinkError({
      message: `Google OAuth failed: ${oauthError}`,
      supabaseAdmin,
      syncLink: externalSyncLink,
    });

    return redirectToConnectionResult(
      request,
      externalSyncLink,
      `oauth_${oauthError}`,
    );
  }

  if (!code) {
    await updateExternalSyncLinkError({
      message: "Google OAuth callback was missing an authorization code.",
      supabaseAdmin,
      syncLink: externalSyncLink,
    });

    return redirectToConnectionResult(
      request,
      externalSyncLink,
      "missing_code_or_state",
    );
  }

  if (oauthState.consumed_at || new Date(oauthState.expires_at) < new Date()) {
    await updateExternalSyncLinkError({
      message: "Google OAuth state was already used or expired.",
      supabaseAdmin,
      syncLink: externalSyncLink,
    });

    return redirectToConnectionResult(
      request,
      externalSyncLink,
      "expired_state",
    );
  }

  await supabaseAdmin
    .from("google_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state", state);

  try {
    const tokenResponse = await exchangeGoogleAuthorizationCode(code);

    if (!tokenResponse.access_token) {
      await updateExternalSyncLinkError({
        message: "Google did not return an access token.",
        supabaseAdmin,
        syncLink: externalSyncLink,
      });

      return redirectToConnectionResult(
        request,
        externalSyncLink,
        "missing_access_token",
      );
    }

    if (!tokenResponse.refresh_token) {
      const message =
        "Google did not return a refresh token. Reconnect with consent to grant offline access.";
      await upsertFailedIntegration({
        lastError: message,
        organizationId: oauthState.organization_id,
        supabaseAdmin,
        userId: oauthState.user_id,
      });
      await updateExternalSyncLinkError({
        message,
        supabaseAdmin,
        syncLink: externalSyncLink,
      });

      return redirectToConnectionResult(
        request,
        externalSyncLink,
        "missing_refresh_token",
      );
    }

    const expiresAt = addSeconds(
      new Date(),
      Math.max(0, tokenResponse.expires_in ?? 3600),
    ).toISOString();
    const tokenInfo = await getGoogleTokenInfo(tokenResponse.access_token).catch(
      () => ({ email: null, scope: null }),
    );
    const { data: integration, error: integrationError } = await supabaseAdmin
      .from("integrations")
      .upsert(
        {
          access_token_expires_at: expiresAt,
          connected_admin_email:
            getEmailFromIdToken(tokenResponse.id_token) ?? tokenInfo.email,
          connected_by_user_id: oauthState.user_id,
          encrypted_access_token: encryptSecret(tokenResponse.access_token),
          encrypted_refresh_token: encryptSecret(tokenResponse.refresh_token),
          granted_scopes: parseGrantedScopes(
            tokenResponse.scope ?? tokenInfo.scope ?? undefined,
          ),
          last_error: null,
          organization_id: oauthState.organization_id,
          provider: "google_workspace",
          status: "connected",
        },
        { onConflict: "organization_id,provider" },
      )
      .select("id")
      .single();

    if (integrationError || !integration) {
      await updateExternalSyncLinkError({
        message: integrationError?.message ?? "Unable to save Google integration.",
        supabaseAdmin,
        syncLink: externalSyncLink,
      });

      return redirectToConnectionResult(
        request,
        externalSyncLink,
        "integration_save_failed",
      );
    }

    const integrationId = (integration as unknown as { id: string }).id;
    await createIntegrationAuditLog({
      action: "connected",
      actorUserId: oauthState.user_id,
      integrationId,
      organizationId: oauthState.organization_id,
      provider: "google_workspace",
      supabaseAdmin,
    });

    try {
      await runGoogleWorkspaceSmokeTest(tokenResponse.access_token);
    } catch (smokeError) {
      const message =
        smokeError instanceof Error
          ? smokeError.message
          : "Google Workspace permission smoke test failed.";

      await supabaseAdmin
        .from("integrations")
        .update({
          last_error: message,
          status: "permission_error",
        })
        .eq("id", integrationId);
      await createIntegrationAuditLog({
        action: "smoke_test_failed",
        actorUserId: externalSyncLink ? null : oauthState.user_id,
        integrationId,
        message,
        organizationId: oauthState.organization_id,
        provider: "google_workspace",
        supabaseAdmin,
      });
      await updateExternalSyncLinkError({
        message,
        supabaseAdmin,
        syncLink: externalSyncLink,
      });
      revalidateGoogleFrontendCache(oauthState.organization_id);

      return redirectToConnectionResult(
        request,
        externalSyncLink,
        "permission_smoke_test_failed",
      );
    }

    if (externalSyncLink) {
      const syncError = await runExternalGoogleWorkspaceSync({
        integrationId,
        organizationId: oauthState.organization_id,
        supabaseAdmin,
        syncLink: externalSyncLink,
      });

      if (syncError) {
        return redirectToExternalSyncLinkComplete(request, "sync_failed");
      }

      return redirectToExternalSyncLinkComplete(request, "success");
    }

    revalidateGoogleFrontendCache(oauthState.organization_id);

    return redirectToGooglePage(request, null, "connected");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google Workspace connection failed.";

    await upsertFailedIntegration({
      lastError: message,
      organizationId: oauthState.organization_id,
      supabaseAdmin,
      userId: oauthState.user_id,
    });
    await updateExternalSyncLinkError({
      message,
      supabaseAdmin,
      syncLink: externalSyncLink,
    });

    return redirectToConnectionResult(
      request,
      externalSyncLink,
      "callback_failed",
    );
  }
}

async function loadExternalSyncLink({
  state,
  supabaseAdmin,
}: {
  state: string;
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
}): Promise<ExternalSyncLinkRow | null> {
  const { data, error } = await supabaseAdmin
    .from("google_workspace_sync_links")
    .select("id, organization_id")
    .eq("oauth_state", state)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as ExternalSyncLinkRow;
}

async function runExternalGoogleWorkspaceSync({
  integrationId,
  organizationId,
  supabaseAdmin,
  syncLink,
}: {
  integrationId: string;
  organizationId: string;
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  syncLink: ExternalSyncLinkRow;
}): Promise<string | null> {
  await supabaseAdmin
    .from("google_workspace_sync_links")
    .update({
      last_error: null,
      sync_started_at: new Date().toISOString(),
    })
    .eq("id", syncLink.id);
  await createIntegrationAuditLog({
    action: "external_sync_started",
    actorUserId: null,
    integrationId,
    metadata: { syncLinkId: syncLink.id },
    organizationId,
    provider: "google_workspace",
    supabaseAdmin,
  });

  try {
    const summary = await runGoogleWorkspaceSync({
      actorUserId: null,
      organizationId,
      supabaseAdmin,
    });

    await supabaseAdmin
      .from("google_workspace_sync_links")
      .update({
        last_error: null,
        sync_completed_at: new Date().toISOString(),
      })
      .eq("id", syncLink.id);
    await createIntegrationAuditLog({
      action: "external_sync_completed",
      actorUserId: null,
      integrationId,
      metadata: {
        ...summary,
        syncLinkId: syncLink.id,
      },
      organizationId,
      provider: "google_workspace",
      supabaseAdmin,
    });
    revalidateGoogleFrontendCache(organizationId);

    return null;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google Workspace sync failed.";

    await updateExternalSyncLinkError({
      message,
      supabaseAdmin,
      syncLink,
    });
    await createIntegrationAuditLog({
      action: "external_sync_failed",
      actorUserId: null,
      integrationId,
      message,
      metadata: { syncLinkId: syncLink.id },
      organizationId,
      provider: "google_workspace",
      supabaseAdmin,
    });
    revalidateGoogleFrontendCache(organizationId);

    return message;
  }
}

async function updateExternalSyncLinkError({
  message,
  supabaseAdmin,
  syncLink,
}: {
  message: string;
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  syncLink: ExternalSyncLinkRow | null;
}) {
  if (!syncLink) {
    return;
  }

  await supabaseAdmin
    .from("google_workspace_sync_links")
    .update({ last_error: message })
    .eq("id", syncLink.id);
}

async function upsertFailedIntegration({
  lastError,
  organizationId,
  supabaseAdmin,
  userId,
}: {
  lastError: string;
  organizationId: string;
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  userId: string | null;
}) {
  await supabaseAdmin.from("integrations").upsert(
    {
      connected_by_user_id: userId,
      last_error: lastError,
      organization_id: organizationId,
      provider: "google_workspace",
      status: "error",
    },
    { onConflict: "organization_id,provider" },
  );
  revalidateGoogleFrontendCache(organizationId);
}

function redirectToGooglePage(
  request: NextRequest,
  error: string | null,
  connected?: string,
): Response {
  if (error) {
    const redirectUrl = new URL("/app/settings/integrations", request.url);
    redirectUrl.searchParams.set("error", error);

    if (error !== "google_oauth_failed") {
      redirectUrl.searchParams.set("google_error", error);
      redirectUrl.searchParams.set("error", "google_oauth_failed");
    }

    return Response.redirect(redirectUrl);
  }

  if (connected) {
    return Response.redirect(
      new URL("/app/integrations/google/syncing", request.url),
    );
  }

  return Response.redirect(new URL("/app/settings/integrations", request.url));
}

function redirectToConnectionResult(
  request: NextRequest,
  syncLink: ExternalSyncLinkRow | null,
  error: string | null,
  connected?: string,
): Response {
  if (syncLink) {
    return redirectToExternalSyncLinkComplete(
      request,
      error ?? (connected ? "success" : "cancelled"),
    );
  }

  return redirectToGooglePage(request, error, connected);
}

function redirectToExternalSyncLinkComplete(
  request: NextRequest,
  status: string,
): Response {
  const redirectUrl = new URL(
    "/integrations/google/sync-link/complete",
    request.url,
  );
  redirectUrl.searchParams.set("status", status);

  return Response.redirect(redirectUrl);
}

function redirectToSupabaseAuthCallback(request: NextRequest): Response {
  const requestUrl = new URL(request.url);
  const redirectUrl = new URL("/auth/v1/callback", getSupabaseUrl());
  redirectUrl.search = requestUrl.search;

  return Response.redirect(redirectUrl);
}

function getEmailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) {
    return null;
  }

  const [, payload] = idToken.split(".");

  if (!payload) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { email?: string };

    return decoded.email ?? null;
  } catch {
    return null;
  }
}
