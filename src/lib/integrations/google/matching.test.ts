import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSupplierIdentityDashboard,
  dedupeIdentitySuppliers,
  resolveIdentitySupplierDomain,
} from "./matching.ts";

test("matches known aliases like ChatGPT to OpenAI", () => {
  const [row] = buildSupplierIdentityDashboard({
    activeGoogleUsersCount: 12,
    now: new Date("2026-05-12T00:00:00.000Z"),
    signals: [
      {
        appDomain: null,
        appName: "ChatGPT",
        eventName: "authorize",
        eventTime: "2026-05-10T00:00:00.000Z",
        source: "oauth",
        userEmail: "ada@example.com",
      },
    ],
    suppliers: [
      {
        id: "supplier-openai",
        monthlySpend: 9500,
        supplierDomain: "openai.com",
        supplierName: "OpenAI",
      },
    ],
    suspendedUserEmails: new Set(),
  });

  assert.equal(row.visibleViaGoogle, true);
  assert.equal(row.identityMode, "oauth");
  assert.equal(row.matchSource, "known_alias");
  assert.equal(row.usersWithSignal90d, 0);
  assert.equal(row.lastSignalAt, null);
  assert.equal(row.confidence, "low");
});

test("prefers SAML signals over OAuth signals for identity mode", () => {
  const [row] = buildSupplierIdentityDashboard({
    activeGoogleUsersCount: 8,
    now: new Date("2026-05-12T00:00:00.000Z"),
    signals: [
      {
        appDomain: null,
        appName: "Aircall",
        eventName: "authorize",
        eventTime: "2026-05-01T00:00:00.000Z",
        source: "oauth",
        userEmail: "ada@example.com",
      },
      {
        appDomain: null,
        appName: "Aircall",
        eventTime: "2026-05-02T00:00:00.000Z",
        source: "saml",
        userEmail: "grace@example.com",
      },
    ],
    suppliers: [
      {
        id: "supplier-aircall",
        monthlySpend: 10000,
        supplierDomain: "aircall.io",
        supplierName: "Aircall",
      },
    ],
    suspendedUserEmails: new Set(),
  });

  assert.equal(row.identityMode, "saml");
  assert.equal(row.confidence, "high");
  assert.equal(row.usersWithSignal90d, 1);
});

test("does not count OAuth revoke events as active usage signals", () => {
  const [row] = buildSupplierIdentityDashboard({
    activeGoogleUsersCount: 8,
    now: new Date("2026-05-12T00:00:00.000Z"),
    signals: [
      {
        appDomain: null,
        appName: "Aircall",
        eventName: "revoke",
        eventTime: "2026-05-01T00:00:00.000Z",
        source: "oauth",
        userEmail: "ada@example.com",
      },
    ],
    suppliers: [
      {
        id: "supplier-aircall",
        monthlySpend: 10000,
        supplierDomain: "aircall.io",
        supplierName: "Aircall",
      },
    ],
    suspendedUserEmails: new Set(["ada@example.com"]),
  });

  assert.equal(row.visibleViaGoogle, true);
  assert.equal(row.identityMode, "oauth");
  assert.equal(row.usersWithSignal30d, 0);
  assert.equal(row.usersWithSignal90d, 0);
  assert.equal(row.usersWithSignal180d, 0);
  assert.equal(row.lastSignalAt, null);
  assert.equal(row.suspendedUsersWithSignalOrToken, 0);
  assert.equal(row.confidence, "low");
});

test("counts successful SAML logins as active usage signals", () => {
  const [row] = buildSupplierIdentityDashboard({
    activeGoogleUsersCount: 8,
    now: new Date("2026-05-12T00:00:00.000Z"),
    signals: [
      {
        appDomain: null,
        appName: "Aircall",
        eventName: "login_success",
        eventTime: "2026-05-01T00:00:00.000Z",
        source: "saml",
        success: true,
        userEmail: "ada@example.com",
      },
    ],
    suppliers: [
      {
        id: "supplier-aircall",
        monthlySpend: 10000,
        supplierDomain: "aircall.io",
        supplierName: "Aircall",
      },
    ],
    suspendedUserEmails: new Set(),
  });

  assert.equal(row.visibleViaGoogle, true);
  assert.equal(row.identityMode, "saml");
  assert.equal(row.usersWithSignal30d, 1);
  assert.equal(row.usersWithSignal90d, 1);
  assert.equal(row.usersWithSignal180d, 1);
  assert.equal(row.lastSignalAt, "2026-05-01T00:00:00.000Z");
  assert.equal(row.confidence, "high");
});

test("does not mark suppliers as unused when Google has no signal", () => {
  const [row] = buildSupplierIdentityDashboard({
    activeGoogleUsersCount: 5,
    now: new Date("2026-05-12T00:00:00.000Z"),
    signals: [],
    suppliers: [
      {
        id: "supplier-wework",
        monthlySpend: 30000,
        supplierDomain: "wework.com",
        supplierName: "WeWork",
      },
    ],
    suspendedUserEmails: new Set(),
  });

  assert.equal(row.visibleViaGoogle, false);
  assert.equal(row.identityMode, "unknown");
  assert.equal(row.confidence, "unknown");
  assert.doesNotMatch(row.recommendedNextStep.toLowerCase(), /unused/);
});

test("deduplicates domain-named identity suppliers", () => {
  const suppliers = dedupeIdentitySuppliers([
    {
      id: "seed-fly",
      monthlySpend: null,
      supplierDomain: "fly.io",
      supplierName: "Fly",
    },
    {
      id: "google-fly-io",
      monthlySpend: null,
      supplierDomain: "fly.io",
      supplierName: "fly.io",
    },
  ]);

  assert.equal(suppliers.length, 1);
  assert.equal(suppliers[0].id, "seed-fly");
  assert.equal(suppliers[0].supplierName, "Fly");
});

test("deduplicates supplier names that are domains against existing supplier domains", () => {
  const suppliers = dedupeIdentitySuppliers([
    {
      id: "google-fly-io",
      monthlySpend: null,
      supplierDomain: null,
      supplierName: "fly.io",
    },
    {
      id: "seed-fly",
      monthlySpend: 12000,
      supplierDomain: "fly.io",
      supplierName: "Fly",
    },
  ]);

  assert.equal(suppliers.length, 1);
  assert.equal(suppliers[0].id, "seed-fly");
  assert.equal(suppliers[0].monthlySpend, 12000);
});

test("does not deduplicate different products sharing a vendor domain", () => {
  const suppliers = dedupeIdentitySuppliers([
    {
      id: "notion-calendar",
      monthlySpend: null,
      supplierDomain: "notion.so",
      supplierName: "Notion Calendar",
    },
    {
      id: "notion-email",
      monthlySpend: null,
      supplierDomain: "notion.so",
      supplierName: "Notion Email",
    },
  ]);

  assert.equal(suppliers.length, 2);
  assert.deepEqual(
    suppliers.map((supplier) => supplier.supplierName),
    ["Notion Calendar", "Notion Email"],
  );
});

test("resolves Google Workspace supplier domains from deterministic identity aliases", () => {
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "google_workspace",
      supplierDomain: "apollo.de",
      supplierName: "Apollo",
    }),
    "apollographql.com",
  );
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "google_workspace",
      supplierDomain: "console.com",
      supplierName: "Neon Console",
    }),
    "neon.tech",
  );
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "google_workspace",
      supplierDomain: "notiontocalendar.com",
      supplierName: "Notion Calendar",
    }),
    "notion.so",
  );
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "google_workspace",
      supplierDomain: null,
      supplierName: "Claude",
    }),
    "claude.ai",
  );
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "google_workspace",
      supplierDomain: null,
      supplierName: "Canva Pro",
    }),
    "canva.com",
  );
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "google_workspace",
      supplierDomain: null,
      supplierName: "Docker Hub",
    }),
    "docker.com",
  );
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "google_workspace",
      supplierDomain: null,
      supplierName: "ElevenLabs",
    }),
    "elevenlabs.io",
  );
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "google_workspace",
      supplierDomain: null,
      supplierName: "Perpplexity AI",
    }),
    "perplexity.ai",
  );
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "google_workspace",
      supplierDomain: null,
      supplierName: "Zapier Automation",
    }),
    "zapier.com",
  );
});

test("does not trust Logo.dev domains for unknown Google Workspace suppliers", () => {
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "google_workspace",
      supplierDomain: "groundwork.org.uk",
      supplierName: "Groundwork",
    }),
    null,
  );
});

test("keeps stored domains for non-Google supplier sources", () => {
  assert.equal(
    resolveIdentitySupplierDomain({
      source: "pennylane",
      supplierDomain: "groundwork.org.uk",
      supplierName: "Groundwork",
    }),
    "groundwork.org.uk",
  );
});
