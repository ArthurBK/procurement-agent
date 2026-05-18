import "server-only";

import { addSeconds } from "date-fns";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  refreshGoogleAccessToken,
  type GoogleTokenResponse,
} from "./oauth";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type GoogleIntegrationRow = {
  id: string;
  organization_id: string;
  provider: "google_workspace";
  status: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  access_token_expires_at: string | null;
  data_retention_days: number;
};

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason: string | null = null,
  ) {
    super(message);
  }
}

type GoogleUsersListResponse = {
  users?: unknown[];
};

type GoogleTokenInfoResponse = {
  email?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
};

export type GoogleTokenInfo = {
  email: string | null;
  scope: string | null;
};

const DIRECTORY_USERS_URL =
  "https://admin.googleapis.com/admin/directory/v1/users";
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";

export async function getGoogleAccessToken({
  integration,
  supabaseAdmin,
}: {
  integration: GoogleIntegrationRow;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<string> {
  if (
    integration.encrypted_access_token &&
    integration.access_token_expires_at &&
    new Date(integration.access_token_expires_at).getTime() >
      Date.now() + 60_000
  ) {
    return decryptSecret(integration.encrypted_access_token);
  }

  if (!integration.encrypted_refresh_token) {
    throw new Error("Google refresh token is missing. Please reconnect.");
  }

  let tokenResponse: GoogleTokenResponse;

  try {
    tokenResponse = await refreshGoogleAccessToken(
      decryptSecret(integration.encrypted_refresh_token),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token refresh failed";

    if (message.includes("invalid_grant")) {
      await supabaseAdmin
        .from("integrations")
        .update({
          encrypted_access_token: null,
          encrypted_refresh_token: null,
          last_error: "Google refresh token was revoked. Please reconnect.",
          status: "revoked",
        })
        .eq("id", integration.id);
    }

    throw error;
  }

  if (!tokenResponse.access_token) {
    throw new Error("Google did not return a refreshed access token.");
  }

  const expiresAt = addSeconds(
    new Date(),
    Math.max(0, tokenResponse.expires_in ?? 3600),
  ).toISOString();

  await supabaseAdmin
    .from("integrations")
    .update({
      access_token_expires_at: expiresAt,
      encrypted_access_token: encryptSecret(tokenResponse.access_token),
    })
    .eq("id", integration.id);

  return tokenResponse.access_token;
}

export async function runGoogleDirectoryUsersSmokeTest(
  accessToken: string,
): Promise<void> {
  await googleApiFetchJson<GoogleUsersListResponse>({
    accessToken,
    path: DIRECTORY_USERS_URL,
    query: {
      customer: "my_customer",
      maxResults: 1,
      projection: "basic",
    },
  });
}

export async function getGoogleTokenInfo(
  accessToken: string,
): Promise<GoogleTokenInfo> {
  const url = new URL(GOOGLE_TOKEN_INFO_URL);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  const body = (await response
    .json()
    .catch(() => ({}))) as GoogleTokenInfoResponse;

  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? `${body.error}: ${
            typeof body.error_description === "string"
              ? body.error_description
              : "Google token info failed"
          }`
        : `Google token info failed with status ${response.status}`;

    throw new Error(message);
  }

  return {
    email: typeof body.email === "string" ? body.email : null,
    scope: typeof body.scope === "string" ? body.scope : null,
  };
}

export async function googleApiFetchJson<T>({
  accessToken,
  path,
  query,
}: {
  accessToken: string;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
}): Promise<T> {
  const url = new URL(path);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return fetchWithRetry<T>(url.toString(), accessToken);
}

async function fetchWithRetry<T>(url: string, accessToken: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    const body = await readErrorBody(response);
    const reason = extractGoogleErrorReason(body);
    const googleMessage = extractGoogleErrorMessage(body);
    const bodyText =
      typeof body === "string" ? body : JSON.stringify(body);

    if (response.status === 403) {
      if (reason === "accessNotConfigured") {
        throw new GoogleApiError(
          "Admin SDK API is disabled. Enable the Admin SDK API in the Google Cloud project and reconnect.",
          response.status,
          reason,
        );
      }

      throw new GoogleApiError(
        "Please connect with a Google Workspace admin that has access to Admin SDK Directory and Reports.",
        response.status,
        reason,
      );
    }

    if (
      response.status === 400 &&
      bodyText.toLowerCase().includes("invalid page token")
    ) {
      throw new GoogleApiError("Google page token expired.", response.status, reason);
    }

    if (response.status === 401) {
      throw new GoogleApiError("Google access token is invalid.", response.status, reason);
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = new GoogleApiError(
        formatGoogleApiErrorMessage(response.status, googleMessage),
        response.status,
        reason,
      );
      await wait(500 * 2 ** attempt);
      continue;
    }

    throw new GoogleApiError(
      formatGoogleApiErrorMessage(response.status, googleMessage),
      response.status,
      reason,
    );
  }

  throw lastError ?? new Error("Google API request failed.");
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text().catch(() => "");
  }
}

function extractGoogleErrorReason(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const error = (body as Record<string, unknown>).error;

  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return null;
  }

  const errors = (error as Record<string, unknown>).errors;

  if (!Array.isArray(errors)) {
    return null;
  }

  const firstError = errors[0];

  if (
    typeof firstError === "object" &&
    firstError !== null &&
    !Array.isArray(firstError) &&
    typeof (firstError as Record<string, unknown>).reason === "string"
  ) {
    return (firstError as Record<string, string>).reason;
  }

  return null;
}

function extractGoogleErrorMessage(body: unknown): string | null {
  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const error = (body as Record<string, unknown>).error;

  if (typeof error === "string") {
    return error;
  }

  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim().length > 0
    ? message
    : null;
}

function formatGoogleApiErrorMessage(
  status: number,
  googleMessage: string | null,
): string {
  return googleMessage
    ? `Google API failed with status ${status}: ${googleMessage}`
    : `Google API failed with status ${status}`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
