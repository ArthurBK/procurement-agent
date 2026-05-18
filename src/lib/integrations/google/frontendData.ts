import "server-only";

import { buildIdentityDashboardRows } from "@/lib/integrations/google/sync";
import {
  isGooglePermissionError,
  toGoogleFrontendStatus,
  type GoogleFrontendStatus,
} from "@/lib/integrations/google/frontendStatus";
import {
  autoEnrichIdentitySupplierLogos,
  getSupplierLogoUrl,
  loadSupplierLogoProfilesByName,
} from "@/lib/integrations/google/identityLogoEnrichment";
import {
  getKnownAliasTarget,
  matchSupplierToSignal,
  normalizeIdentityName,
  type IdentitySignal,
  type SupplierForIdentityMatch,
} from "@/lib/integrations/google/matching";
import { normalizeSupplierKey } from "@/lib/recurring/normalizeSupplierKey";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type IntegrationRow = {
  connected_admin_email: string | null;
  granted_scopes: string[] | null;
  last_error: string | null;
  last_sync_completed_at: string | null;
  last_sync_started_at: string | null;
  status: string;
};

type SupplierRow = {
  category: string | null;
  id: string;
  monthly_spend: number | null;
  supplier_domain: string | null;
  supplier_name: string;
};

type SubscriptionSeatRow = {
  quantity?: number | null;
  supplier: string;
};

type ContractPricingLinkRow = {
  contract_id: string | null;
  matched_app_name: string | null;
  matched_app_domain: string | null;
  sso_supplier_id: string | null;
};

type ContractPricingContractRow = {
  billing_frequency: string;
  id: string;
  last_invoice_amount_cents: number | null;
  recurring_amount_cents: number | null;
  status: string;
};

type ContractPricingSupplierRow = {
  id: string;
  supplier_domain: string | null;
  supplier_name: string;
};

type IdentityPricingSource = IdentitySignalsPayload["suppliers"][number]["pricingSource"];

type GoogleOAuthEventRow = {
  app_name: string | null;
  event_name: string;
  event_time: string;
  id: string;
  oauth_client_id: string | null;
  scopes_json: unknown;
  user_email: string | null;
};

type GoogleSamlEventRow = {
  event_name: string;
  event_time: string;
  id: string;
  saml_app_name: string | null;
  success: boolean | null;
  user_email: string | null;
};

type GoogleAuthorizedAppRow = {
  app_name: string;
  id: string;
  report_date: string;
  users_count: number;
};

type GoogleWorkspaceUserRow = {
  primary_email: string;
  suspended: boolean;
};

export type GoogleStatusPayload = {
  connectedAdminEmail: string | null;
  grantedScopes: string[];
  lastError: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncStartedAt: string | null;
  oauthAppsDiscovered: number;
  permissionError: boolean;
  rawStatus: string | null;
  samlAppsDiscovered: number;
  status: GoogleFrontendStatus;
  suppliersMatched: number;
  usersSynced: number;
};

export type IdentitySignalsPayload = {
  summary: {
    authorizedAppsDiscovered: number;
    googleUsersSynced: number;
    oauthAppsDiscovered: number;
    paidSuppliersMatched: number;
    samlAppsDiscovered: number;
    suppliersNeedingAppUsage: number;
    suspendedUsers: number;
  };
  suppliers: Array<{
    confidence: "high" | "medium" | "low" | "unknown";
    identityMode: "saml" | "oauth" | "authorized_app" | "unknown";
    lastSignalAt: string | null;
    logoUrl: string | null;
    monthlySpend: number | null;
    paidSeats: number | null;
    pricingSource: "contract" | "shared_contract" | "supplier" | "unknown";
    recommendedNextAction: string;
    supplierDomain: string | null;
    supplierId: string;
    supplierName: string;
    suspendedUsersWithSignal: number;
    usersWithSignal180d: number;
    usersWithSignal30d: number;
    usersWithSignal90d: number;
    visibleViaGoogle: boolean;
  }>;
};

export type SupplierInventoryRow = {
  billingModel: string;
  category: string;
  identityMode: IdentitySignalsPayload["suppliers"][number]["identityMode"];
  monthlySpend: number | null;
  supplierDomain: string | null;
  supplierId: string;
  supplierName: string;
  usageDataStatus: string;
  visibleViaGoogle: boolean;
};

export type SupplierIdentityLogRow = {
  appName: string;
  eventName: string;
  eventTime: string | null;
  id: string;
  matchConfidence: number;
  matchSource: string;
  oauthClientId: string | null;
  scopes: string[];
  source: "oauth" | "saml" | "authorized_app";
  success: boolean | null;
  suspendedUser: boolean;
  userEmail: string | null;
  usersCount: number | null;
};

export async function loadGoogleStatus({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<GoogleStatusPayload> {
  const { data: integrationData, error: integrationError } = await supabaseAdmin
    .from("integrations")
    .select(
      [
        "status",
        "connected_admin_email",
        "granted_scopes",
        "last_sync_started_at",
        "last_sync_completed_at",
        "last_error",
      ].join(", "),
    )
    .eq("organization_id", organizationId)
    .eq("provider", "google_workspace")
    .maybeSingle();

  if (integrationError) {
    throw new Error(`Unable to load integration: ${integrationError.message}`);
  }

  const [usersResult, oauthEventsResult, samlEventsResult, suppliersResult] =
    await Promise.all([
      supabaseAdmin
        .from("google_workspace_users")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      supabaseAdmin
        .from("google_oauth_events")
        .select("app_name, event_name")
        .eq("organization_id", organizationId),
      supabaseAdmin
        .from("google_saml_events")
        .select("saml_app_name")
        .eq("organization_id", organizationId),
      supabaseAdmin
        .from("supplier_identity_matches")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
    ]);

  for (const result of [
    usersResult,
    oauthEventsResult,
    samlEventsResult,
    suppliersResult,
  ]) {
    if (result.error) {
      throw new Error(`Unable to load Google status: ${result.error.message}`);
    }
  }

  const integration = integrationData as unknown as IntegrationRow | null;

  return {
    connectedAdminEmail: integration?.connected_admin_email ?? null,
    grantedScopes: integration?.granted_scopes ?? [],
    lastError: integration?.last_error ?? null,
    lastSyncCompletedAt: integration?.last_sync_completed_at ?? null,
    lastSyncStartedAt: integration?.last_sync_started_at ?? null,
    oauthAppsDiscovered: getDistinctCount(
      getActiveOAuthAppRows(
        (oauthEventsResult.data ?? []) as Array<{
          app_name: string | null;
          event_name: string;
        }>,
      ),
      "app_name",
    ),
    permissionError: isGooglePermissionError(
      integration?.status,
      integration?.last_error,
    ),
    rawStatus: integration?.status ?? null,
    samlAppsDiscovered: getDistinctCount(
      (samlEventsResult.data ?? []) as Array<{ saml_app_name: string | null }>,
      "saml_app_name",
    ),
    status: toGoogleFrontendStatus(integration?.status),
    suppliersMatched: suppliersResult.count ?? 0,
    usersSynced: usersResult.count ?? 0,
  };
}

export async function loadIdentitySignals({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<IdentitySignalsPayload> {
  await autoEnrichIdentitySupplierLogos({
    organizationId,
    supabaseAdmin,
  }).catch(() => undefined);

  const [
    usersResult,
    oauthEventsResult,
    samlEventsResult,
    authorizedAppsResult,
    paidSeatsBySupplierName,
    contractPricing,
    dashboardRows,
  ] = await Promise.all([
    supabaseAdmin
      .from("google_workspace_users")
      .select("suspended")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("google_oauth_events")
      .select("app_name, event_name")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("google_saml_events")
      .select("saml_app_name")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("google_authorized_apps")
      .select("app_name")
      .eq("organization_id", organizationId),
    loadPaidSeatsBySupplierName({ supabaseAdmin }),
    loadContractPricing({ organizationId, supabaseAdmin }),
    buildIdentityDashboardRows({ organizationId, supabaseAdmin }),
  ]);

  for (const result of [
    usersResult,
    oauthEventsResult,
    samlEventsResult,
    authorizedAppsResult,
  ]) {
    if (result.error) {
      throw new Error(
        `Unable to load Google identity signals: ${result.error.message}`,
      );
    }
  }

  const googleUsers = (usersResult.data ?? []) as Array<{
    suspended: boolean | null;
  }>;
  const profilesBySupplierKey = await loadSupplierLogoProfilesByName({
    supplierNames: dashboardRows.map((row) => row.supplierName),
    supabaseAdmin,
  });
  const suppliers = dashboardRows.map((row) => {
    const supplierContractSpendCents = contractPricing.bySupplierId.get(
      row.supplierId,
    );
    const domainContractSpendCents = row.supplierDomain
      ? contractPricing.byDomain.get(row.supplierDomain.toLowerCase())
      : undefined;
    const aliasContractSpendCents = getPricingAliasKey({
      supplierDomain: row.supplierDomain,
      supplierName: row.supplierName,
    });
    const monthlySpendCents =
      row.monthlySpend ??
      supplierContractSpendCents ??
      domainContractSpendCents ??
      (aliasContractSpendCents
        ? contractPricing.byAlias.get(aliasContractSpendCents)
        : null) ??
      null;
    const pricingSource: IdentityPricingSource =
      row.monthlySpend !== null
        ? "supplier"
        : supplierContractSpendCents !== undefined
          ? "contract"
          : domainContractSpendCents !== undefined ||
              (aliasContractSpendCents
                ? contractPricing.byAlias.has(aliasContractSpendCents)
                : false)
            ? "shared_contract"
            : "unknown";

    return {
      confidence: row.confidence,
      identityMode: row.identityMode,
      lastSignalAt: row.lastSignalAt,
      logoUrl: getSupplierLogoUrl({
        profile: profilesBySupplierKey.get(normalizeSupplierKey(row.supplierName)),
        supplierDomain: row.supplierDomain,
      }),
      monthlySpend:
        monthlySpendCents === null
          ? null
          : Number((monthlySpendCents / 100).toFixed(2)),
      paidSeats:
        paidSeatsBySupplierName.get(normalizeIdentityName(row.supplierName)) ?? null,
      pricingSource,
      recommendedNextAction: row.recommendedNextStep,
      supplierDomain: row.supplierDomain,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      suspendedUsersWithSignal: row.suspendedUsersWithSignalOrToken,
      usersWithSignal180d: row.usersWithSignal180d,
      usersWithSignal30d: row.usersWithSignal30d,
      usersWithSignal90d: row.usersWithSignal90d,
      visibleViaGoogle: row.visibleViaGoogle,
    };
  });

  return {
    summary: {
      authorizedAppsDiscovered: getDistinctCount(
        (authorizedAppsResult.data ?? []) as Array<{ app_name: string | null }>,
        "app_name",
      ),
      googleUsersSynced: googleUsers.length,
      oauthAppsDiscovered: getDistinctCount(
        getActiveOAuthAppRows(
          (oauthEventsResult.data ?? []) as Array<{
            app_name: string | null;
            event_name: string;
          }>,
        ),
        "app_name",
      ),
      paidSuppliersMatched: suppliers.filter((supplier) => supplier.visibleViaGoogle)
        .length,
      samlAppsDiscovered: getDistinctCount(
        (samlEventsResult.data ?? []) as Array<{ saml_app_name: string | null }>,
        "saml_app_name",
      ),
      suppliersNeedingAppUsage: dashboardRows.filter((row) => row.needsAppUsage)
        .length,
      suspendedUsers: googleUsers.filter((user) => user.suspended).length,
    },
    suppliers,
  };
}

async function loadPaidSeatsBySupplierName({
  supabaseAdmin,
}: {
  supabaseAdmin: SupabaseAdminClient;
}): Promise<Map<string, number>> {
  const withQuantityResult = await supabaseAdmin
    .from("subscriptions")
    .select("supplier, quantity");

  let rows: SubscriptionSeatRow[] = [];

  if (withQuantityResult.error) {
    const fallbackResult = await supabaseAdmin
      .from("subscriptions")
      .select("supplier");

    if (fallbackResult.error) {
      throw new Error(
        `Unable to load subscription seats: ${fallbackResult.error.message}`,
      );
    }

    rows = (fallbackResult.data ?? []) as SubscriptionSeatRow[];
  } else {
    rows = (withQuantityResult.data ?? []) as SubscriptionSeatRow[];
  }

  const paidSeatsBySupplierName = new Map<string, number>();

  for (const row of rows) {
    const quantity = row.quantity;

    if (!Number.isFinite(quantity) || !quantity || quantity <= 0) {
      continue;
    }

    const supplierName = normalizeIdentityName(row.supplier);

    paidSeatsBySupplierName.set(
      supplierName,
      (paidSeatsBySupplierName.get(supplierName) ?? 0) + Math.floor(quantity),
    );
  }

  return paidSeatsBySupplierName;
}

async function loadContractPricing({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<{
  byAlias: Map<string, number>;
  byDomain: Map<string, number>;
  bySupplierId: Map<string, number>;
}> {
  const linksResult = await supabaseAdmin
    .from("contract_app_links")
    .select("contract_id, matched_app_name, matched_app_domain, sso_supplier_id")
    .eq("organization_id", organizationId)
    .eq("match_status", "matched");

  if (linksResult.error) {
    throw new Error(
      `Unable to load contract pricing links: ${linksResult.error.message}`,
    );
  }

  const links = (linksResult.data ?? []) as ContractPricingLinkRow[];
  const contractIds = Array.from(
    new Set(
      links.flatMap((link) => (link.contract_id ? [link.contract_id] : [])),
    ),
  );

  if (contractIds.length === 0) {
    return { byAlias: new Map(), byDomain: new Map(), bySupplierId: new Map() };
  }

  const supplierIds = Array.from(
    new Set(
      links.flatMap((link) => (link.sso_supplier_id ? [link.sso_supplier_id] : [])),
    ),
  );

  const [contractsResult, suppliersResult] = await Promise.all([
    supabaseAdmin
      .from("contracts")
      .select(
        [
          "id",
          "status",
          "billing_frequency",
          "recurring_amount_cents",
          "last_invoice_amount_cents",
        ].join(", "),
      )
      .eq("organization_id", organizationId)
      .in("id", contractIds),
    supplierIds.length > 0
      ? supabaseAdmin
          .from("saas_suppliers")
          .select("id, supplier_name, supplier_domain")
          .eq("organization_id", organizationId)
          .in("id", supplierIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contractsResult.error) {
    throw new Error(
      `Unable to load contract pricing: ${contractsResult.error.message}`,
    );
  }

  if (suppliersResult.error) {
    throw new Error(
      `Unable to load contract pricing suppliers: ${suppliersResult.error.message}`,
    );
  }

  const contractById = new Map(
    ((contractsResult.data ?? []) as unknown as ContractPricingContractRow[]).map(
      (contract) => [contract.id, contract],
    ),
  );
  const supplierById = new Map(
    ((suppliersResult.data ?? []) as unknown as ContractPricingSupplierRow[]).map(
      (supplier) => [supplier.id, supplier],
    ),
  );
  const monthlySpendByAlias = new Map<string, number>();
  const monthlySpendByDomain = new Map<string, number>();
  const monthlySpendBySupplierId = new Map<string, number>();
  const seenPricingKeys = new Set<string>();

  for (const link of links) {
    if (!link.contract_id) {
      continue;
    }

    const contract = contractById.get(link.contract_id);
    const monthlyAmountCents = contract
      ? getContractMonthlyAmountCents(contract)
      : null;

    if (monthlyAmountCents === null) {
      continue;
    }

    if (link.sso_supplier_id) {
      addPricingAmount({
        amountCents: monthlyAmountCents,
        map: monthlySpendBySupplierId,
        seenPricingKeys,
        seenKey: `supplier:${link.sso_supplier_id}:${link.contract_id}`,
        targetKey: link.sso_supplier_id,
      });
    }

    const domain = link.matched_app_domain?.trim().toLowerCase();

    if (domain) {
      addPricingAmount({
        amountCents: monthlyAmountCents,
        map: monthlySpendByDomain,
        seenPricingKeys,
        seenKey: `domain:${domain}:${link.contract_id}`,
        targetKey: domain,
      });
    }

    const linkedSupplier = link.sso_supplier_id
      ? supplierById.get(link.sso_supplier_id)
      : null;
    const aliasKeys = new Set(
      [
        getPricingAliasKey({
          supplierDomain: linkedSupplier?.supplier_domain ?? null,
          supplierName: linkedSupplier?.supplier_name ?? null,
        }),
        getPricingAliasKey({
          supplierDomain: link.matched_app_domain,
          supplierName: link.matched_app_name,
        }),
      ].filter((value): value is string => typeof value === "string"),
    );

    for (const aliasKey of aliasKeys) {
      addPricingAmount({
        amountCents: monthlyAmountCents,
        map: monthlySpendByAlias,
        seenPricingKeys,
        seenKey: `alias:${aliasKey}:${link.contract_id}`,
        targetKey: aliasKey,
      });
    }
  }

  return {
    byAlias: monthlySpendByAlias,
    byDomain: monthlySpendByDomain,
    bySupplierId: monthlySpendBySupplierId,
  };
}

function addPricingAmount({
  amountCents,
  map,
  seenPricingKeys,
  seenKey,
  targetKey,
}: {
  amountCents: number;
  map: Map<string, number>;
  seenPricingKeys: Set<string>;
  seenKey: string;
  targetKey: string;
}) {
  if (seenPricingKeys.has(seenKey)) {
    return;
  }

  seenPricingKeys.add(seenKey);
  map.set(targetKey, (map.get(targetKey) ?? 0) + amountCents);
}

function getContractMonthlyAmountCents(
  contract: ContractPricingContractRow,
): number | null {
  if (contract.status === "ignored" || contract.status === "inactive") {
    return null;
  }

  const amountCents =
    contract.recurring_amount_cents ?? contract.last_invoice_amount_cents;

  if (!Number.isFinite(amountCents) || amountCents === null || amountCents <= 0) {
    return null;
  }

  if (contract.billing_frequency === "monthly") {
    return amountCents;
  }

  if (
    contract.billing_frequency === "annual" ||
    contract.billing_frequency === "annually"
  ) {
    return Math.round(amountCents / 12);
  }

  if (contract.billing_frequency === "quarterly") {
    return Math.round(amountCents / 3);
  }

  if (contract.billing_frequency === "weekly") {
    return Math.round((amountCents * 52) / 12);
  }

  return amountCents;
}

function getPricingAliasKey({
  supplierDomain,
  supplierName,
}: {
  supplierDomain: string | null;
  supplierName: string | null;
}): string | null {
  const normalizedName = normalizeIdentityName(supplierName);
  const nameAlias = getKnownAliasTarget(normalizedName);

  if (nameAlias) {
    return nameAlias;
  }

  const domainName = supplierDomain?.split(".")[0] ?? null;
  const domainAlias = getKnownAliasTarget(normalizeIdentityName(domainName));

  return domainAlias ?? null;
}

export async function loadSupplierInventory({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<SupplierInventoryRow[]> {
  const [identitySignals, suppliersResult] = await Promise.all([
    loadIdentitySignals({ organizationId, supabaseAdmin }),
    supabaseAdmin
      .from("saas_suppliers")
      .select("id, supplier_name, supplier_domain, monthly_spend, category")
      .eq("organization_id", organizationId)
      .order("supplier_name", { ascending: true }),
  ]);

  if (suppliersResult.error) {
    throw new Error(
      `Unable to load SaaS suppliers: ${suppliersResult.error.message}`,
    );
  }

  const identityBySupplierId = new Map(
    identitySignals.suppliers.map((supplier) => [supplier.supplierId, supplier]),
  );

  const suppliers = (suppliersResult.data ?? []) as SupplierRow[];

  return suppliers.map((supplier) => {
    const identity = identityBySupplierId.get(supplier.id);

    return {
      billingModel: "unknown",
      category: supplier.category ?? "unknown",
      identityMode: identity?.identityMode ?? "unknown",
      monthlySpend:
        supplier.monthly_spend === null
          ? null
          : Number((supplier.monthly_spend / 100).toFixed(2)),
      supplierDomain: supplier.supplier_domain,
      supplierId: supplier.id,
      supplierName: supplier.supplier_name,
      usageDataStatus: toIdentityUsageStatus(identity),
      visibleViaGoogle: identity?.visibleViaGoogle ?? false,
    };
  });
}

export async function loadSupplierIdentityLogs({
  limit = 100,
  organizationId,
  supplier,
  supabaseAdmin,
}: {
  limit?: number;
  organizationId: string;
  supplier: SupplierInventoryRow;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<SupplierIdentityLogRow[]> {
  const [oauthResult, samlResult, authorizedAppsResult, usersResult] =
    await Promise.all([
      supabaseAdmin
        .from("google_oauth_events")
        .select(
          "id, user_email, app_name, oauth_client_id, event_name, event_time, scopes_json",
        )
        .eq("organization_id", organizationId)
        .order("event_time", { ascending: false })
        .limit(1000),
      supabaseAdmin
        .from("google_saml_events")
        .select("id, user_email, saml_app_name, event_name, event_time, success")
        .eq("organization_id", organizationId)
        .order("event_time", { ascending: false })
        .limit(1000),
      supabaseAdmin
        .from("google_authorized_apps")
        .select("id, app_name, users_count, report_date")
        .eq("organization_id", organizationId)
        .order("report_date", { ascending: false })
        .limit(1000),
      supabaseAdmin
        .from("google_workspace_users")
        .select("primary_email, suspended")
        .eq("organization_id", organizationId),
    ]);

  for (const result of [
    oauthResult,
    samlResult,
    authorizedAppsResult,
    usersResult,
  ]) {
    if (result.error) {
      throw new Error(`Unable to load supplier identity logs: ${result.error.message}`);
    }
  }

  const suspendedEmails = new Set(
    ((usersResult.data ?? []) as GoogleWorkspaceUserRow[])
      .filter((user) => user.suspended)
      .map((user) => user.primary_email.toLowerCase()),
  );
  const supplierForMatch: SupplierForIdentityMatch = {
    id: supplier.supplierId,
    monthlySpend:
      supplier.monthlySpend === null ? null : Math.round(supplier.monthlySpend * 100),
    supplierDomain: supplier.supplierDomain,
    supplierName: supplier.supplierName,
  };
  const logs: SupplierIdentityLogRow[] = [
    ...((oauthResult.data ?? []) as GoogleOAuthEventRow[]).flatMap((event) => {
      if (!event.app_name) {
        return [];
      }

      const match = matchSupplierToSignal(supplierForMatch, {
        appDomain: null,
        appName: event.app_name,
        eventTime: event.event_time,
        source: "oauth",
        userEmail: event.user_email,
      });

      return match.matchConfidence > 0
        ? [
            {
              appName: event.app_name,
              eventName: event.event_name,
              eventTime: event.event_time,
              id: `oauth:${event.id}`,
              matchConfidence: match.matchConfidence,
              matchSource: match.matchSource,
              oauthClientId: event.oauth_client_id,
              scopes: normalizeScopes(event.scopes_json),
              source: "oauth" as const,
              success: null,
              suspendedUser: isSuspended(event.user_email, suspendedEmails),
              userEmail: event.user_email,
              usersCount: null,
            },
          ]
        : [];
    }),
    ...((samlResult.data ?? []) as GoogleSamlEventRow[]).flatMap((event) => {
      if (!event.saml_app_name) {
        return [];
      }

      const match = matchSupplierToSignal(supplierForMatch, {
        appDomain: null,
        appName: event.saml_app_name,
        eventTime: event.event_time,
        source: "saml",
        userEmail: event.user_email,
      });

      return match.matchConfidence > 0
        ? [
            {
              appName: event.saml_app_name,
              eventName: event.event_name,
              eventTime: event.event_time,
              id: `saml:${event.id}`,
              matchConfidence: match.matchConfidence,
              matchSource: match.matchSource,
              oauthClientId: null,
              scopes: [],
              source: "saml" as const,
              success: event.success,
              suspendedUser: isSuspended(event.user_email, suspendedEmails),
              userEmail: event.user_email,
              usersCount: null,
            },
          ]
        : [];
    }),
    ...((authorizedAppsResult.data ?? []) as GoogleAuthorizedAppRow[]).flatMap(
      (app) => {
        const signal: IdentitySignal = {
          appDomain: null,
          appName: app.app_name,
          eventTime: app.report_date,
          source: "authorized_app",
          userEmail: null,
          usersCount: app.users_count,
        };
        const match = matchSupplierToSignal(supplierForMatch, signal);

        return match.matchConfidence > 0
          ? [
              {
                appName: app.app_name,
                eventName: "authorized_apps_report",
                eventTime: app.report_date,
                id: `authorized_app:${app.id}`,
                matchConfidence: match.matchConfidence,
                matchSource: match.matchSource,
                oauthClientId: null,
                scopes: [],
                source: "authorized_app" as const,
                success: null,
                suspendedUser: false,
                userEmail: null,
                usersCount: app.users_count,
              },
            ]
          : [];
      },
    ),
  ];

  return logs
    .sort((left, right) => {
      const leftTime = left.eventTime ? new Date(left.eventTime).getTime() : 0;
      const rightTime = right.eventTime ? new Date(right.eventTime).getTime() : 0;

      return rightTime - leftTime;
    })
    .slice(0, limit);
}

function getDistinctCount<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
): number {
  return new Set(
    rows.flatMap((row) => {
      const value = row[key];

      return typeof value === "string" && value.trim() ? [value] : [];
    }),
  ).size;
}

function toIdentityUsageStatus(
  identity: IdentitySignalsPayload["suppliers"][number] | undefined,
): string {
  if (!identity?.visibleViaGoogle) {
    return "No recent Google identity signal";
  }

  if (identity.identityMode === "saml") {
    return "SAML login signal found";
  }

  return "Visible via Google; needs app-level usage";
}

function getActiveOAuthAppRows<
  T extends {
    app_name: string | null;
    event_name: string;
  },
>(rows: T[]): T[] {
  return rows.filter(
    (row) => normalizeIdentityName(row.event_name) === "authorize",
  );
}

function normalizeScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((scope) =>
    typeof scope === "string" && scope.trim() ? [scope] : [],
  );
}

function isSuspended(
  email: string | null,
  suspendedEmails: Set<string>,
): boolean {
  return email ? suspendedEmails.has(email.toLowerCase()) : false;
}
