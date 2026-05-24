import { createHash, randomBytes } from "crypto";

export const GOOGLE_WORKSPACE_SYNC_LINK_TTL_HOURS = 48;
export const GOOGLE_WORKSPACE_SYNC_LINK_TOKEN_BYTES = 32;
export const GOOGLE_WORKSPACE_SYNC_LINK_START_PATH =
  "/api/integrations/google/sync-links";

export type GoogleWorkspaceSyncLinkValidation = "valid" | "expired" | "used";

export type GoogleWorkspaceSyncLinkValidationRow = {
  consumed_at: string | null;
  expires_at: string;
};

export function createGoogleWorkspaceSyncLinkToken(): string {
  return randomBytes(GOOGLE_WORKSPACE_SYNC_LINK_TOKEN_BYTES).toString(
    "base64url",
  );
}

export function hashGoogleWorkspaceSyncLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function getGoogleWorkspaceSyncLinkExpiresAt(now = new Date()): Date {
  return new Date(
    now.getTime() + GOOGLE_WORKSPACE_SYNC_LINK_TTL_HOURS * 60 * 60 * 1000,
  );
}

export function getGoogleWorkspaceSyncLinkValidation(
  row: GoogleWorkspaceSyncLinkValidationRow,
  now = new Date(),
): GoogleWorkspaceSyncLinkValidation {
  if (row.consumed_at) {
    return "used";
  }

  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    return "expired";
  }

  return "valid";
}

export function buildGoogleWorkspaceSyncLinkUrl({
  origin,
  token,
}: {
  origin: string;
  token: string;
}): string {
  const url = new URL(
    `${GOOGLE_WORKSPACE_SYNC_LINK_START_PATH}/${encodeURIComponent(
      token,
    )}/start`,
    origin,
  );

  return url.toString();
}

export function getPublicAppOrigin(requestUrl: string): string {
  const configuredOrigin =
    process.env.APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredOrigin) {
    return new URL(configuredOrigin).origin;
  }

  return new URL(requestUrl).origin;
}
