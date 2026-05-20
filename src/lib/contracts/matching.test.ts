import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContractAppLinkRows,
  matchContractToSsoSupplier,
  type ContractForMatching,
  type SsoSupplierForMatching,
  type VendorAliasForMatching,
} from "./matching.ts";

test("matches contracts by exact normalized name", () => {
  const match = matchContractToSsoSupplier({
    aliases: [],
    contract: contract({ vendor_name: "OpenAI LLC" }),
    suppliers: [supplier({ supplier_name: "OpenAI" })],
  });

  assert.equal(match.matchStatus, "matched");
  assert.equal(match.matchScore, 0.96);
});

test("matches contracts by alias", () => {
  const match = matchContractToSsoSupplier({
    aliases: [
      alias({
        alias: "ChatGPT",
        canonical_name: "OpenAI",
        normalized_alias: "chatgpt",
      }),
    ],
    contract: contract({ vendor_name: "ChatGPT" }),
    suppliers: [supplier({ supplier_name: "OpenAI" })],
  });

  assert.equal(match.matchStatus, "matched");
  assert.equal(match.matchReason, "Manual vendor alias match");
});

test("matches known aliases like ChatGPT to OpenAI", () => {
  const match = matchContractToSsoSupplier({
    aliases: [],
    contract: contract({ vendor_name: "ChatGPT" }),
    suppliers: [supplier({ supplier_name: "OpenAI" })],
  });

  assert.equal(match.matchStatus, "matched");
  assert.equal(match.matchReason, "Known alias match");
});

test("creates missing_contract when SSO app has no contract", () => {
  const links = buildContractAppLinkRows({
    aliases: [],
    contracts: [],
    organizationId: "org",
    suppliers: [
      supplier({
        identity_mode: "saml",
        supplier_name: "Aircall",
        users_with_signal_90d: 3,
      }),
    ],
  });

  assert.equal(links.length, 1);
  assert.equal(links[0].match_status, "missing_contract");
});

test("does not create missing_contract for automatically discovered Google apps", () => {
  const links = buildContractAppLinkRows({
    aliases: [],
    contracts: [],
    organizationId: "org",
    suppliers: [
      supplier({
        identity_mode: "oauth",
        source: "google_workspace",
        supplier_name: "Random OAuth App",
      }),
    ],
  });

  assert.equal(links.length, 0);
});

test("does not create a duplicate missing contract for known equivalent apps", () => {
  const links = buildContractAppLinkRows({
    aliases: [],
    contracts: [contract({ vendor_name: "OpenAI" })],
    organizationId: "org",
    suppliers: [
      supplier({
        id: "supplier-chatgpt",
        supplier_domain: "chatgpt.com",
        supplier_name: "ChatGPT",
      }),
      supplier({
        id: "supplier-openai",
        supplier_domain: "openai.com",
        supplier_name: "OpenAI",
      }),
    ],
  });

  assert.equal(links.length, 1);
  assert.equal(links[0].match_status, "matched");
  assert.equal(links[0].sso_supplier_id, "supplier-openai");
});

test("prefers official vendor domains over third-party integration domains", () => {
  const match = matchContractToSsoSupplier({
    aliases: [],
    contract: contract({
      normalized_vendor_name: "notion labs",
      vendor_name: "Notion Labs, Inc.",
    }),
    suppliers: [
      supplier({
        id: "supplier-notion-calendar",
        supplier_domain: "notiontocalendar.com",
        supplier_name: "Notion Calendar",
        users_with_signal_90d: 0,
      }),
      supplier({
        id: "supplier-notion-mail",
        supplier_domain: "notion.so",
        supplier_name: "Notion Mail",
        users_with_signal_90d: 0,
      }),
    ],
  });

  assert.equal(match.matchStatus, "matched");
  assert.equal(match.ssoSupplierId, "supplier-notion-mail");
  assert.equal(match.matchReason, "Known official domain match");
});

test("does not match a contract only because a third-party app name contains the vendor", () => {
  const match = matchContractToSsoSupplier({
    aliases: [],
    contract: contract({
      normalized_vendor_name: "notion",
      vendor_name: "Notion",
    }),
    suppliers: [
      supplier({
        supplier_domain: "notiontocalendar.com",
        supplier_name: "Notion Calendar",
        users_with_signal_90d: 0,
      }),
    ],
  });

  assert.equal(match.matchStatus, "orphan_contract");
  assert.equal(match.ssoSupplierId, null);
});

test("creates orphan_contract when contract has no SSO app match", () => {
  const links = buildContractAppLinkRows({
    aliases: [],
    contracts: [contract({ vendor_name: "Unknown Vendor" })],
    organizationId: "org",
    suppliers: [supplier({ supplier_name: "Aircall" })],
  });

  assert.equal(links.length, 2);
  assert.equal(links[0].match_status, "orphan_contract");
  assert.equal(links[1].match_status, "missing_contract");
});

test("does not recreate an ignored manual contract app match", () => {
  const links = buildContractAppLinkRows({
    aliases: [],
    contracts: [contract({ id: "contract-openai", vendor_name: "OpenAI" })],
    manualLinks: [
      {
        contract_id: "contract-openai",
        match_status: "ignored",
        sso_supplier_id: "supplier-openai",
      },
    ],
    organizationId: "org",
    suppliers: [
      supplier({
        id: "supplier-openai",
        supplier_name: "OpenAI",
      }),
    ],
  });

  assert.equal(links[0].match_status, "orphan_contract");
  assert.equal(links[0].match_reason, "Manual review ignored this SSO match.");
});

function contract(overrides: Partial<ContractForMatching> = {}): ContractForMatching {
  return {
    id: "contract-1",
    normalized_vendor_name: "",
    status: "active",
    vendor_name: "OpenAI",
    ...overrides,
  };
}

function supplier(
  overrides: Partial<SsoSupplierForMatching> = {},
): SsoSupplierForMatching {
  return {
    id: "supplier-1",
    identity_mode: "saml",
    last_signal_at: "2026-05-01T00:00:00.000Z",
    source: "seed",
    supplier_domain: null,
    supplier_name: "OpenAI",
    users_with_signal_90d: 1,
    ...overrides,
  };
}

function alias(overrides: Partial<VendorAliasForMatching>): VendorAliasForMatching {
  return {
    alias: "ChatGPT",
    canonical_name: "OpenAI",
    domain: null,
    normalized_alias: "chatgpt",
    ...overrides,
  };
}
