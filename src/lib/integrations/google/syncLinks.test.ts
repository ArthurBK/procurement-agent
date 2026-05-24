import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleWorkspaceSyncLinkUrl,
  createGoogleWorkspaceSyncLinkToken,
  getGoogleWorkspaceSyncLinkExpiresAt,
  getGoogleWorkspaceSyncLinkValidation,
  hashGoogleWorkspaceSyncLinkToken,
} from "./syncLinks.ts";

test("creates URL-safe sync link tokens and hashes them without leaking the token", () => {
  const token = createGoogleWorkspaceSyncLinkToken();
  const hash = hashGoogleWorkspaceSyncLinkToken(token);

  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.match(hash, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(hash, token);
  assert.equal(hashGoogleWorkspaceSyncLinkToken(token), hash);
});

test("sets Google Workspace sync links to expire in 48 hours", () => {
  const now = new Date("2026-05-24T10:00:00.000Z");
  const expiresAt = getGoogleWorkspaceSyncLinkExpiresAt(now);

  assert.equal(expiresAt.toISOString(), "2026-05-26T10:00:00.000Z");
});

test("classifies sync links as valid, expired, or used", () => {
  const now = new Date("2026-05-24T10:00:00.000Z");

  assert.equal(
    getGoogleWorkspaceSyncLinkValidation(
      {
        consumed_at: null,
        expires_at: "2026-05-24T10:00:01.000Z",
      },
      now,
    ),
    "valid",
  );
  assert.equal(
    getGoogleWorkspaceSyncLinkValidation(
      {
        consumed_at: null,
        expires_at: "2026-05-24T10:00:00.000Z",
      },
      now,
    ),
    "expired",
  );
  assert.equal(
    getGoogleWorkspaceSyncLinkValidation(
      {
        consumed_at: "2026-05-24T09:00:00.000Z",
        expires_at: "2026-05-24T11:00:00.000Z",
      },
      now,
    ),
    "used",
  );
});

test("builds the public Google Workspace sync link start URL", () => {
  assert.equal(
    buildGoogleWorkspaceSyncLinkUrl({
      origin: "https://app.example.com",
      token: "abc_123",
    }),
    "https://app.example.com/api/integrations/google/sync-links/abc_123/start",
  );
});
