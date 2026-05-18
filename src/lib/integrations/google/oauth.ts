import "server-only";

export const GOOGLE_WORKSPACE_CORE_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/admin.reports.usage.readonly",
] as const;

const GOOGLE_WORKSPACE_ALLOWED_SCOPES = new Set<string>(
  GOOGLE_WORKSPACE_CORE_SCOPES,
);
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();

  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }

  if (!clientSecret) {
    throw new Error("GOOGLE_CLIENT_SECRET is not configured");
  }

  if (!redirectUri) {
    throw new Error("GOOGLE_REDIRECT_URI is not configured");
  }

  return { clientId, clientSecret, redirectUri };
}

export function getGoogleWorkspaceScopes(): string[] {
  const configuredScopes = process.env.GOOGLE_WORKSPACE_SCOPES?.trim();

  if (!configuredScopes) {
    return [...GOOGLE_WORKSPACE_CORE_SCOPES];
  }

  const scopes = Array.from(
    new Set(configuredScopes.split(/[\s,]+/).filter(Boolean)),
  );
  const unsupportedScopes = scopes.filter(
    (scope) => !GOOGLE_WORKSPACE_ALLOWED_SCOPES.has(scope),
  );

  if (unsupportedScopes.length > 0) {
    throw new Error(
      `GOOGLE_WORKSPACE_SCOPES contains unsupported scope(s): ${unsupportedScopes.join(
        ", ",
      )}`,
    );
  }

  return scopes;
}

export function buildGoogleAuthorizationUrl({
  state,
}: {
  state: string;
}): string {
  const config = getGoogleOAuthConfig();
  const searchParams = new URLSearchParams({
    access_type: "offline",
    client_id: config.clientId,
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: getGoogleWorkspaceScopes().join(" "),
    state,
  });

  return `${GOOGLE_AUTH_URL}?${searchParams.toString()}`;
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
): Promise<GoogleTokenResponse> {
  const config = getGoogleOAuthConfig();

  return postGoogleTokenRequest({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const config = getGoogleOAuthConfig();

  return postGoogleTokenRequest({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const response = await fetch(GOOGLE_REVOKE_URL, {
    body: new URLSearchParams({ token }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok && response.status !== 400) {
    throw new Error(`Google token revoke failed with status ${response.status}`);
  }
}

export function parseGrantedScopes(scope: string | undefined): string[] {
  return Array.from(
    new Set((scope ?? "").split(/\s+/).filter((value) => value.length > 0)),
  );
}

async function postGoogleTokenRequest(
  params: Record<string, string>,
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams(params),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const body = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!response.ok) {
    const errorMessage = body.error
      ? `${body.error}: ${body.error_description ?? "Google OAuth failed"}`
      : `Google OAuth failed with status ${response.status}`;

    throw new Error(errorMessage);
  }

  return body;
}
