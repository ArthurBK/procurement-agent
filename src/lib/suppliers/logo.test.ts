import assert from "node:assert/strict";
import test from "node:test";
import { buildLogoUrl, normalizeDomain } from "./logo.ts";

test("normalizes supplier domains", () => {
  assert.equal(normalizeDomain("https://www.notion.so/pricing"), "notion.so");
  assert.equal(normalizeDomain("OPENAI.COM"), "openai.com");
  assert.equal(normalizeDomain("www.slack.com"), "slack.com");
  assert.equal(normalizeDomain("not a domain"), null);
  assert.equal(normalizeDomain(""), null);
});

test("builds Logo.dev image URLs when the publishable key is configured", () => {
  const originalToken = process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY;

  try {
    process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY = "test-token";

    const logoUrl = buildLogoUrl("openai.com");

    assert.equal(
      logoUrl,
      "https://img.logo.dev/openai.com?token=test-token&size=128&format=png&fallback=monogram",
    );
  } finally {
    restoreEnv("NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY", originalToken);
  }
});

test("returns null when Logo.dev publishable key is missing", () => {
  const originalToken = process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY;

  try {
    delete process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY;

    assert.equal(buildLogoUrl("openai.com"), null);
  } finally {
    restoreEnv("NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY", originalToken);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
