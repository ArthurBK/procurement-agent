import type { NextRequest } from "next/server";
import { ensureWorkspaceForUser } from "@/lib/auth/workspace";
import { WorkspaceAuthError } from "@/lib/auth/workspace-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = getSafeNextPath(requestUrl.searchParams.get("next"));

  if (!code) {
    logAuthCallbackWarning("missing_code", request, {
      oauthError: requestUrl.searchParams.get("error"),
    });

    return redirectToLogin(request, "auth_callback_failed", next);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !user) {
    logAuthCallbackWarning("exchange_failed", request, {
      errorMessage: sanitizeAuthErrorMessage(error?.message),
      errorName: error?.name,
      errorStatus: getAuthErrorStatus(error),
    });

    return redirectToLogin(request, "auth_callback_failed", next);
  }

  try {
    await ensureWorkspaceForUser({
      supabaseAdmin: createSupabaseAdminClient(),
      user,
    });
  } catch (workspaceError) {
    await supabase.auth.signOut();

    if (workspaceError instanceof WorkspaceAuthError) {
      return redirectToLogin(request, workspaceError.code, next);
    }

    return redirectToLogin(request, "workspace_membership_required", next);
  }

  return Response.redirect(new URL(next, request.url));
}

function logAuthCallbackWarning(
  reason: "exchange_failed" | "missing_code",
  request: NextRequest,
  details: Record<string, string | null | undefined>,
) {
  const url = new URL(request.url);

  console.warn("auth_callback_failed", {
    details,
    host: url.host,
    reason,
  });
}

function sanitizeAuthErrorMessage(message: string | undefined): string | null {
  if (!message) {
    return null;
  }

  return message
    .replace(/code=[^&\s]+/gi, "code=[redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/refresh_token=[^&\s]+/gi, "refresh_token=[redacted]");
}

function getAuthErrorStatus(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null;
  }

  const status = (error as { status?: unknown }).status;

  return typeof status === "number" || typeof status === "string"
    ? String(status)
    : null;
}

function getSafeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/app/suppliers";
  }

  return value;
}

function redirectToLogin(
  request: NextRequest,
  error: string,
  next: string,
): Response {
  const redirectUrl = new URL("/login", request.url);
  redirectUrl.searchParams.set("error", error);
  redirectUrl.searchParams.set("next", next);

  return Response.redirect(redirectUrl);
}
