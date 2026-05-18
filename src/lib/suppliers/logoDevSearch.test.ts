import assert from "node:assert/strict";
import test from "node:test";
import { searchLogoDevBrands } from "./logoDevSearch.ts";

test("throws a clear error when Logo.dev secret key is missing", async () => {
  const env = saveLogoEnv();

  try {
    delete process.env.LOGO_DEV_SECRET_KEY;

    await assert.rejects(
      () => searchLogoDevBrands("Notion"),
      /LOGO_DEV_SECRET_KEY is not configured/,
    );
  } finally {
    restoreLogoEnv(env);
  }
});

test("returns no results for short queries", async () => {
  const env = saveLogoEnv();
  const originalFetch = globalThis.fetch;

  try {
    delete process.env.LOGO_DEV_SECRET_KEY;
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called");
    };

    assert.deepEqual(await searchLogoDevBrands("N"), []);
  } finally {
    globalThis.fetch = originalFetch;
    restoreLogoEnv(env);
  }
});

test("returns normalized Logo.dev brand search results", async () => {
  const env = saveLogoEnv();
  const originalFetch = globalThis.fetch;

  try {
    process.env.LOGO_DEV_SECRET_KEY = "secret-token";
    process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY = "publishable-token";
    globalThis.fetch = mockJsonFetch([
      { name: "Notion", domain: "NOTION.SO" },
      { name: "Notion Sites", domain: "https://www.notion.site/path" },
    ]);

    const results = await searchLogoDevBrands("Notion");

    assert.deepEqual(results, [
      {
        domain: "notion.so",
        logoUrl:
          "https://img.logo.dev/notion.so?token=publishable-token&size=128&format=png&fallback=monogram",
        name: "Notion",
      },
      {
        domain: "notion.site",
        logoUrl:
          "https://img.logo.dev/notion.site?token=publishable-token&size=128&format=png&fallback=monogram",
        name: "Notion Sites",
      },
    ]);
    assert.ok(results.length <= 10);
  } finally {
    globalThis.fetch = originalFetch;
    restoreLogoEnv(env);
  }
});

test("filters invalid Logo.dev response rows", async () => {
  const env = saveLogoEnv();
  const originalFetch = globalThis.fetch;

  try {
    process.env.LOGO_DEV_SECRET_KEY = "secret-token";
    process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY = "publishable-token";
    globalThis.fetch = mockJsonFetch([
      { name: "Valid", domain: "valid.com" },
      { name: null, domain: "bad.com" },
      { name: "No domain", domain: "" },
    ]);

    assert.deepEqual(await searchLogoDevBrands("Valid"), [
      {
        domain: "valid.com",
        logoUrl:
          "https://img.logo.dev/valid.com?token=publishable-token&size=128&format=png&fallback=monogram",
        name: "Valid",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreLogoEnv(env);
  }
});

test("throws a helpful error for non-2xx Logo.dev responses", async () => {
  const env = saveLogoEnv();
  const originalFetch = globalThis.fetch;

  try {
    process.env.LOGO_DEV_SECRET_KEY = "secret-token";
    globalThis.fetch = async () =>
      new Response("Server error", { status: 500 });

    await assert.rejects(
      () => searchLogoDevBrands("Notion"),
      /Logo\.dev Brand Search failed with status 500/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreLogoEnv(env);
  }
});

function mockJsonFetch(body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
}

function saveLogoEnv(): {
  publishableKey: string | undefined;
  secretKey: string | undefined;
} {
  return {
    publishableKey: process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY,
    secretKey: process.env.LOGO_DEV_SECRET_KEY,
  };
}

function restoreLogoEnv(env: {
  publishableKey: string | undefined;
  secretKey: string | undefined;
}): void {
  restoreEnv("LOGO_DEV_SECRET_KEY", env.secretKey);
  restoreEnv("NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY", env.publishableKey);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
