import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAuthorizedAppsReport,
  normalizeOAuthActivity,
  normalizeSamlActivity,
} from "./reportParsers.ts";

test("normalizes Google OAuth token audit events", () => {
  const [event] = normalizeOAuthActivity({
    actor: { email: "ada@example.com" },
    events: [
      {
        name: "authorize",
        parameters: [
          { name: "app_name", value: "ChatGPT" },
          { name: "client_id", value: "client-123" },
          {
            multiValue: ["openid", "email"],
            name: "scope",
          },
        ],
      },
    ],
    id: {
      applicationName: "token",
      time: "2026-05-01T12:00:00.000Z",
      uniqueQualifier: "abc",
    },
  });

  assert.equal(event.appName, "ChatGPT");
  assert.equal(event.oauthClientId, "client-123");
  assert.deepEqual(event.scopes, ["openid", "email"]);
  assert.equal(event.userEmail, "ada@example.com");
});

test("normalizes Google SAML login events", () => {
  const [event] = normalizeSamlActivity({
    actor: { email: "grace@example.com" },
    events: [
      {
        name: "login_success",
        parameters: [{ name: "application_name", value: "Aircall" }],
      },
    ],
    id: {
      applicationName: "saml",
      time: "2026-05-01T12:00:00.000Z",
      uniqueQualifier: "def",
    },
  });

  assert.equal(event.samlAppName, "Aircall");
  assert.equal(event.success, true);
});

test("normalizes customer authorized apps usage reports", () => {
  const apps = normalizeAuthorizedAppsReport({
    date: "2026-05-10",
    parameters: [
      {
        multiMessageValue: [
          {
            parameter: [
              { name: "app_name", value: "Vercel" },
              { intValue: "14", name: "num_users" },
            ],
          },
        ],
        name: "accounts:authorized_apps",
      },
    ],
  });

  assert.deepEqual(apps, [
    {
      appName: "Vercel",
      rawJson: {
        date: "2026-05-10",
        parameters: [
          {
            multiMessageValue: [
              {
                parameter: [
                  { name: "app_name", value: "Vercel" },
                  { intValue: "14", name: "num_users" },
                ],
              },
            ],
            name: "accounts:authorized_apps",
          },
        ],
      },
      reportDate: "2026-05-10",
      usersCount: 14,
    },
  ]);
});
