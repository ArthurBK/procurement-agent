import "server-only";

import { addDays, subDays } from "date-fns";
import { createIntegrationAuditLog } from "@/lib/integrations/audit";
import { DEFAULT_ACTOR_USER_ID } from "@/lib/integrations/context";
import type {
  IdentitySignal,
  SupplierForIdentityMatch,
} from "@/lib/integrations/google/matching";
import {
  buildSupplierIdentityDashboard,
  isSameIdentitySupplier,
  normalizeIdentityName,
} from "@/lib/integrations/google/matching";
import {
  GoogleApiError,
  getGoogleAccessToken,
  googleApiFetchJson,
  type GoogleIntegrationRow,
} from "@/lib/integrations/google/api";
import {
  normalizeAuthorizedAppsReport,
  normalizeLoginActivity,
  normalizeOAuthActivity,
  normalizeSamlActivity,
  type GoogleActivityItem,
  type GoogleUsageReport,
} from "@/lib/integrations/google/reportParsers";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type GoogleUsersResponse = {
  nextPageToken?: string;
  users?: GoogleWorkspaceUserApiRow[];
};

type GoogleWorkspaceUserApiRow = {
  aliases?: string[];
  archived?: boolean;
  creationTime?: string;
  id?: string;
  isAdmin?: boolean;
  lastLoginTime?: string;
  name?: {
    fullName?: string;
  };
  orgUnitPath?: string;
  primaryEmail?: string;
  suspended?: boolean;
};

type GoogleActivitiesResponse = {
  items?: GoogleActivityItem[];
  nextPageToken?: string;
};

type GoogleUsageResponse = {
  usageReports?: GoogleUsageReport[];
};

export type GoogleWorkspaceSyncSummary = {
  authorizedAppsSynced: number;
  identitySuppliersSynced: number;
  loginEventsSynced: number;
  oauthEventsSynced: number;
  samlEventsSynced: number;
  suppliersMatched: number;
  usersSynced: number;
  warnings: string[];
};

const DIRECTORY_USERS_URL =
  "https://admin.googleapis.com/admin/directory/v1/users";
const REPORTS_ACTIVITIES_URL =
  "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications";
const REPORTS_USAGE_URL =
  "https://admin.googleapis.com/admin/reports/v1/usage/dates";

export async function runGoogleWorkspaceSmokeTest(accessToken: string) {
  await googleApiFetchJson<GoogleUsersResponse>({
    accessToken,
    path: DIRECTORY_USERS_URL,
    query: {
      customer: "my_customer",
      maxResults: 1,
      projection: "basic",
    },
  });
}

export async function runGoogleWorkspaceSync({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<GoogleWorkspaceSyncSummary> {
  const integration = await loadGoogleIntegration({
    organizationId,
    supabaseAdmin,
  });

  if (!integration?.encrypted_refresh_token) {
    throw new Error("Google Workspace is not connected.");
  }

  await supabaseAdmin
    .from("integrations")
    .update({
      last_error: null,
      last_sync_started_at: new Date().toISOString(),
      status: "syncing",
    })
    .eq("id", integration.id);

  try {
    const accessToken = await getGoogleAccessToken({ integration, supabaseAdmin });
    const retentionDays = integration.data_retention_days ?? 180;
    const startTime = subDays(new Date(), retentionDays).toISOString();
    const endTime = new Date().toISOString();
    const warnings: string[] = [];

    const usersSynced = await runRequiredGoogleResourceSync({
      label: "Google Workspace users",
      run: () =>
        syncUsers({
          accessToken,
          organizationId,
          supabaseAdmin,
        }),
    });
    const oauthEventsSynced = await runRequiredGoogleResourceSync({
      label: "Google OAuth token audit events",
      run: () =>
        syncActivityEvents({
          accessToken,
          applicationName: "token",
          endTime,
          kind: "oauth",
          organizationId,
          startTime,
          supabaseAdmin,
        }),
    });
    const samlEventsSynced = await runOptionalGoogleResourceSync({
      label: "Google SAML events",
      run: () =>
        syncActivityEvents({
          accessToken,
          applicationName: "saml",
          endTime,
          kind: "saml",
          organizationId,
          startTime,
          supabaseAdmin,
        }),
      warnings,
    });
    const loginEventsSynced = await runOptionalGoogleResourceSync({
      label: "Google login events",
      run: () =>
        syncActivityEvents({
          accessToken,
          applicationName: "login",
          endTime,
          kind: "login",
          organizationId,
          startTime,
          supabaseAdmin,
        }),
      warnings,
    });
    const authorizedAppsSynced = await runOptionalGoogleResourceSync({
      label: "Google authorized apps report",
      run: () =>
        syncAuthorizedApps({
          accessToken,
          organizationId,
          supabaseAdmin,
        }),
      warnings,
    });
    const identitySuppliersSynced = await ensureIdentityProviderSuppliers({
      organizationId,
      supabaseAdmin,
    });

    await pruneRawEvents({ organizationId, retentionDays, supabaseAdmin });
    const suppliersMatched = await rebuildSupplierIdentityMatches({
      organizationId,
      supabaseAdmin,
    });

    await supabaseAdmin
      .from("integrations")
      .update({
        last_error: null,
        last_sync_completed_at: new Date().toISOString(),
        status: "connected",
      })
      .eq("id", integration.id);
    await createIntegrationAuditLog({
      action: "sync_completed",
      actorUserId: DEFAULT_ACTOR_USER_ID,
      integrationId: integration.id,
      metadata: {
        authorizedAppsSynced,
        identitySuppliersSynced,
        loginEventsSynced,
        oauthEventsSynced,
        samlEventsSynced,
        suppliersMatched,
        usersSynced,
        warnings,
      },
      organizationId,
      provider: "google_workspace",
      supabaseAdmin,
    });

    return {
      authorizedAppsSynced,
      identitySuppliersSynced,
      loginEventsSynced,
      oauthEventsSynced,
      samlEventsSynced,
      suppliersMatched,
      usersSynced,
      warnings,
    };
  } catch (error) {
    const message = toUserFacingSyncError(error);

    await supabaseAdmin
      .from("integrations")
      .update({
        last_error: message,
        status: error instanceof GoogleApiError && error.status === 403
          ? "connected_but_insufficient_permissions"
          : "error",
      })
      .eq("id", integration.id);

    throw new Error(message);
  }
}

async function loadGoogleIntegration({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<GoogleIntegrationRow | null> {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select(
      [
        "id",
        "organization_id",
        "provider",
        "status",
        "encrypted_access_token",
        "encrypted_refresh_token",
        "access_token_expires_at",
        "data_retention_days",
      ].join(", "),
    )
    .eq("organization_id", organizationId)
    .eq("provider", "google_workspace")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load Google integration: ${error.message}`);
  }

  return (data as GoogleIntegrationRow | null) ?? null;
}

async function runRequiredGoogleResourceSync<T>({
  label,
  run,
}: {
  label: string;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw labelGoogleResourceError(label, error);
  }
}

async function runOptionalGoogleResourceSync({
  label,
  run,
  warnings,
}: {
  label: string;
  run: () => Promise<number>;
  warnings: string[];
}): Promise<number> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 400) {
      warnings.push(`${label} skipped: ${error.message}`);
      return 0;
    }

    throw labelGoogleResourceError(label, error);
  }
}

function labelGoogleResourceError(label: string, error: unknown): Error {
  if (error instanceof GoogleApiError) {
    return new GoogleApiError(
      `${label} failed: ${error.message}`,
      error.status,
      error.reason,
    );
  }

  if (error instanceof Error) {
    return new Error(`${label} failed: ${error.message}`);
  }

  return new Error(`${label} failed.`);
}

async function syncUsers({
  accessToken,
  organizationId,
  supabaseAdmin,
}: {
  accessToken: string;
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<number> {
  let pageToken: string | undefined;
  let syncedCount = 0;

  do {
    const response = await googleApiFetchJson<GoogleUsersResponse>({
      accessToken,
      path: DIRECTORY_USERS_URL,
      query: {
        customer: "my_customer",
        maxResults: 500,
        pageToken,
        projection: "full",
      },
    });
    const rows = (response.users ?? []).flatMap((user) => {
      if (!user.id || !user.primaryEmail) {
        return [];
      }

      return [
        {
          aliases_json: user.aliases ?? [],
          archived: user.archived ?? false,
          creation_time: user.creationTime ?? null,
          full_name: user.name?.fullName ?? null,
          google_user_id: user.id,
          is_admin: user.isAdmin ?? null,
          last_login_time:
            user.lastLoginTime && user.lastLoginTime !== "1970-01-01T00:00:00.000Z"
              ? user.lastLoginTime
              : null,
          org_unit_path: user.orgUnitPath ?? null,
          organization_id: organizationId,
          primary_email: user.primaryEmail,
          raw_json: user,
          suspended: user.suspended ?? false,
          synced_at: new Date().toISOString(),
        },
      ];
    });

    if (rows.length > 0) {
      const { error } = await supabaseAdmin
        .from("google_workspace_users")
        .upsert(rows, {
          onConflict: "organization_id,google_user_id",
        });

      if (error) {
        throw new Error(`Unable to save Google users: ${error.message}`);
      }
    }

    syncedCount += rows.length;
    pageToken = response.nextPageToken;
  } while (pageToken);

  return syncedCount;
}

async function syncActivityEvents({
  accessToken,
  applicationName,
  endTime,
  kind,
  organizationId,
  startTime,
  supabaseAdmin,
}: {
  accessToken: string;
  applicationName: "token" | "saml" | "login";
  endTime: string;
  kind: "oauth" | "saml" | "login";
  organizationId: string;
  startTime: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<number> {
  const items = await fetchActivityItems({
    accessToken,
    applicationName,
    endTime,
    startTime,
  });

  if (kind === "oauth") {
    return saveOAuthEvents({ items, organizationId, supabaseAdmin });
  }

  if (kind === "saml") {
    return saveSamlEvents({ items, organizationId, supabaseAdmin });
  }

  return saveLoginEvents({ items, organizationId, supabaseAdmin });
}

async function fetchActivityItems({
  accessToken,
  applicationName,
  endTime,
  restartAttempted = false,
  startTime,
}: {
  accessToken: string;
  applicationName: "token" | "saml" | "login";
  endTime: string;
  restartAttempted?: boolean;
  startTime: string;
}): Promise<GoogleActivityItem[]> {
  let pageToken: string | undefined;
  const items: GoogleActivityItem[] = [];

  try {
    do {
      const response = await googleApiFetchJson<GoogleActivitiesResponse>({
        accessToken,
        path: `${REPORTS_ACTIVITIES_URL}/${applicationName}`,
        query: {
          endTime,
          maxResults: 1000,
          pageToken,
          startTime,
        },
      });

      items.push(...(response.items ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);
  } catch (error) {
    if (
      !restartAttempted &&
      error instanceof GoogleApiError &&
      error.message === "Google page token expired."
    ) {
      return fetchActivityItems({
        accessToken,
        applicationName,
        endTime,
        restartAttempted: true,
        startTime,
      });
    }

    throw error;
  }

  return items;
}

async function saveOAuthEvents({
  items,
  organizationId,
  supabaseAdmin,
}: {
  items: GoogleActivityItem[];
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<number> {
  const rows = items.flatMap(normalizeOAuthActivity).map((event) => ({
    app_name: event.appName,
    event_name: event.eventName,
    event_time: event.eventTime,
    google_event_id: event.googleEventId,
    oauth_client_id: event.oauthClientId,
    organization_id: organizationId,
    raw_json: event.rawJson,
    scopes_json: event.scopes,
    synced_at: new Date().toISOString(),
    user_email: event.userEmail,
  }));

  if (rows.length === 0) {
    return 0;
  }

  const { error } = await supabaseAdmin
    .from("google_oauth_events")
    .upsert(rows, { onConflict: "organization_id,google_event_id" });

  if (error) {
    throw new Error(`Unable to save Google OAuth events: ${error.message}`);
  }

  return rows.length;
}

async function saveSamlEvents({
  items,
  organizationId,
  supabaseAdmin,
}: {
  items: GoogleActivityItem[];
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<number> {
  const rows = items.flatMap(normalizeSamlActivity).map((event) => ({
    event_name: event.eventName,
    event_time: event.eventTime,
    google_event_id: event.googleEventId,
    organization_id: organizationId,
    raw_json: event.rawJson,
    saml_app_name: event.samlAppName,
    success: event.success,
    synced_at: new Date().toISOString(),
    user_email: event.userEmail,
  }));

  if (rows.length === 0) {
    return 0;
  }

  const { error } = await supabaseAdmin
    .from("google_saml_events")
    .upsert(rows, { onConflict: "organization_id,google_event_id" });

  if (error) {
    throw new Error(`Unable to save Google SAML events: ${error.message}`);
  }

  return rows.length;
}

async function saveLoginEvents({
  items,
  organizationId,
  supabaseAdmin,
}: {
  items: GoogleActivityItem[];
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<number> {
  const rows = items.flatMap(normalizeLoginActivity).map((event) => ({
    event_name: event.eventName,
    event_time: event.eventTime,
    google_event_id: event.googleEventId,
    login_type: event.loginType,
    organization_id: organizationId,
    raw_json: event.rawJson,
    synced_at: new Date().toISOString(),
    user_email: event.userEmail,
  }));

  if (rows.length === 0) {
    return 0;
  }

  const { error } = await supabaseAdmin
    .from("google_login_events")
    .upsert(rows, { onConflict: "organization_id,google_event_id" });

  if (error) {
    throw new Error(`Unable to save Google login events: ${error.message}`);
  }

  return rows.length;
}

async function syncAuthorizedApps({
  accessToken,
  organizationId,
  supabaseAdmin,
}: {
  accessToken: string;
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<number> {
  const response = await fetchAuthorizedAppsUsageReport({ accessToken });
  const rows = (response.usageReports ?? [])
    .flatMap(normalizeAuthorizedAppsReport)
    .map((app) => ({
      app_name: app.appName,
      organization_id: organizationId,
      raw_json: app.rawJson,
      report_date: app.reportDate,
      synced_at: new Date().toISOString(),
      users_count: app.usersCount,
    }));

  if (rows.length === 0) {
    return 0;
  }

  const { error } = await supabaseAdmin
    .from("google_authorized_apps")
    .upsert(rows, { onConflict: "organization_id,app_name,report_date" });

  if (error) {
    throw new Error(`Unable to save Google authorized apps: ${error.message}`);
  }

  return rows.length;
}

async function fetchAuthorizedAppsUsageReport({
  accessToken,
}: {
  accessToken: string;
}): Promise<GoogleUsageResponse> {
  let lastBadRequest: GoogleApiError | null = null;

  for (let daysAgo = 1; daysAgo <= 7; daysAgo += 1) {
    const reportDate = addDays(new Date(), -daysAgo).toISOString().slice(0, 10);

    try {
      return await googleApiFetchJson<GoogleUsageResponse>({
        accessToken,
        path: `${REPORTS_USAGE_URL}/${reportDate}`,
        query: {
          parameters: "accounts:authorized_apps",
        },
      });
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 400) {
        lastBadRequest = error;
        continue;
      }

      throw error;
    }
  }

  throw (
    lastBadRequest ??
    new GoogleApiError("Google authorized apps report is not available yet.", 400)
  );
}

async function ensureIdentityProviderSuppliers({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<number> {
  const [oauthResult, samlResult, authorizedAppsResult, existingSuppliersResult] =
    await Promise.all([
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
      supabaseAdmin
        .from("saas_suppliers")
        .select("supplier_name, supplier_domain")
        .eq("organization_id", organizationId),
    ]);

  for (const result of [
    oauthResult,
    samlResult,
    authorizedAppsResult,
    existingSuppliersResult,
  ]) {
    if (result.error) {
      throw new Error(
        `Unable to load Google supplier discovery data: ${result.error.message}`,
      );
    }
  }

  const existingSuppliers = (
    (existingSuppliersResult.data ?? []) as Array<{
      supplier_domain: string | null;
      supplier_name: string;
    }>
  ).map(
    (supplier): SupplierForIdentityMatch => ({
      id: "",
      monthlySpend: null,
      supplierDomain: supplier.supplier_domain,
      supplierName: supplier.supplier_name,
    }),
  );
  const discoveredSuppliers: SupplierForIdentityMatch[] = [];

  for (const appName of [
    ...((oauthResult.data ?? []) as Array<{
      app_name: string | null;
      event_name: string;
    }>)
      .filter((event) => normalizeIdentityName(event.event_name) === "authorize")
      .map((event) => event.app_name),
    ...((samlResult.data ?? []) as Array<{ saml_app_name: string | null }>).map(
      (event) => event.saml_app_name,
    ),
    ...((authorizedAppsResult.data ?? []) as Array<{ app_name: string | null }>).map(
      (app) => app.app_name,
    ),
  ]) {
    const supplierName = normalizeSupplierDisplayName(appName);
    const supplierDomain = extractDomainFromText(supplierName);
    const supplier: SupplierForIdentityMatch = {
      id: "",
      monthlySpend: null,
      supplierDomain,
      supplierName,
    };

    if (
      !supplierName ||
      existingSuppliers.some((existingSupplier) =>
        isSameIdentitySupplier(existingSupplier, supplier),
      ) ||
      discoveredSuppliers.some((discoveredSupplier) =>
        isSameIdentitySupplier(discoveredSupplier, supplier),
      )
    ) {
      continue;
    }

    discoveredSuppliers.push(supplier);
  }

  const rows = discoveredSuppliers.map((supplier) => ({
    category: null,
    monthly_spend: null,
    organization_id: organizationId,
    source: "google_workspace",
    supplier_domain: supplier.supplierDomain,
    supplier_name: supplier.supplierName,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length === 0) {
    return 0;
  }

  const { error } = await supabaseAdmin.from("saas_suppliers").upsert(rows, {
    onConflict: "organization_id,supplier_name,supplier_domain",
  });

  if (error) {
    throw new Error(`Unable to save identity-discovered suppliers: ${error.message}`);
  }

  return rows.length;
}

function normalizeSupplierDisplayName(input: string | null | undefined): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

function extractDomainFromText(input: string): string | null {
  const match = input
    .toLowerCase()
    .match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/);

  return match?.[1] ?? null;
}

export async function rebuildSupplierIdentityMatches({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<number> {
  const dashboardRows = await buildIdentityDashboardRows({
    organizationId,
    supabaseAdmin,
  });
  const rows = dashboardRows.flatMap((row) =>
    row.visibleViaGoogle
      ? [
          {
            identity_mode: row.identityMode,
            last_signal_at: row.lastSignalAt,
            match_confidence: row.matchConfidence,
            match_source: row.matchSource,
            matched_app_domain: row.matchedAppDomain,
            matched_app_name: row.matchedAppName,
            organization_id: organizationId,
            supplier_id: row.supplierId,
            updated_at: new Date().toISOString(),
            users_with_signal_180d: row.usersWithSignal180d,
            users_with_signal_30d: row.usersWithSignal30d,
            users_with_signal_90d: row.usersWithSignal90d,
          },
        ]
      : [],
  );

  await supabaseAdmin
    .from("supplier_identity_matches")
    .delete()
    .eq("organization_id", organizationId);

  if (rows.length === 0) {
    return 0;
  }

  const { error } = await supabaseAdmin.from("supplier_identity_matches").insert(rows);

  if (error) {
    throw new Error(`Unable to save supplier identity matches: ${error.message}`);
  }

  return rows.length;
}

export async function buildIdentityDashboardRows({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}) {
  const [
    suppliersResult,
    usersResult,
    oauthResult,
    samlResult,
    authorizedAppsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("saas_suppliers")
      .select("id, supplier_name, supplier_domain, monthly_spend")
      .eq("organization_id", organizationId)
      .order("supplier_name", { ascending: true }),
    supabaseAdmin
      .from("google_workspace_users")
      .select("primary_email, suspended")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("google_oauth_events")
      .select("user_email, app_name, event_name, event_time")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("google_saml_events")
      .select("user_email, saml_app_name, event_name, event_time, success")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("google_authorized_apps")
      .select("app_name, users_count, report_date")
      .eq("organization_id", organizationId),
  ]);

  for (const result of [
    suppliersResult,
    usersResult,
    oauthResult,
    samlResult,
    authorizedAppsResult,
  ]) {
    if (result.error) {
      throw new Error(`Unable to load Google dashboard data: ${result.error.message}`);
    }
  }

  const suppliers = ((suppliersResult.data ?? []) as Array<{
    id: string;
    monthly_spend: number | null;
    supplier_domain: string | null;
    supplier_name: string;
  }>).map(
    (supplier): SupplierForIdentityMatch => ({
      id: supplier.id,
      monthlySpend: supplier.monthly_spend,
      supplierDomain: supplier.supplier_domain,
      supplierName: supplier.supplier_name,
    }),
  );
  const users = (usersResult.data ?? []) as Array<{
    primary_email: string;
    suspended: boolean;
  }>;
  const activeGoogleUsersCount = users.filter((user) => !user.suspended).length;
  const suspendedUserEmails = new Set(
    users
      .filter((user) => user.suspended)
      .map((user) => user.primary_email.toLowerCase()),
  );
  const signals: IdentitySignal[] = [
    ...((samlResult.data ?? []) as Array<{
      event_name: string;
      event_time: string;
      saml_app_name: string | null;
      success: boolean | null;
      user_email: string | null;
    }>).flatMap((event) =>
      event.saml_app_name
        ? [
            {
              appDomain: null,
              appName: event.saml_app_name,
              eventName: event.event_name,
              eventTime: event.event_time,
              source: "saml" as const,
              success: event.success,
              userEmail: event.user_email,
            },
          ]
        : [],
    ),
    ...((oauthResult.data ?? []) as Array<{
      app_name: string | null;
      event_name: string;
      event_time: string;
      user_email: string | null;
    }>).flatMap((event) =>
      event.app_name
        ? [
            {
              appDomain: null,
              appName: event.app_name,
              eventName: event.event_name,
              eventTime: event.event_time,
              source: "oauth" as const,
              userEmail: event.user_email,
            },
          ]
        : [],
    ),
    ...((authorizedAppsResult.data ?? []) as Array<{
      app_name: string;
      report_date: string;
      users_count: number;
    }>).map((app) => ({
      appDomain: null,
      appName: app.app_name,
      eventTime: app.report_date,
      source: "authorized_app" as const,
      userEmail: null,
      usersCount: app.users_count,
    })),
  ];

  return buildSupplierIdentityDashboard({
    activeGoogleUsersCount,
    signals,
    suppliers,
    suspendedUserEmails,
  });
}

async function pruneRawEvents({
  organizationId,
  retentionDays,
  supabaseAdmin,
}: {
  organizationId: string;
  retentionDays: number;
  supabaseAdmin: SupabaseAdminClient;
}) {
  const cutoff = subDays(new Date(), retentionDays).toISOString();

  await Promise.all([
    supabaseAdmin
      .from("google_oauth_events")
      .delete()
      .eq("organization_id", organizationId)
      .lt("event_time", cutoff),
    supabaseAdmin
      .from("google_saml_events")
      .delete()
      .eq("organization_id", organizationId)
      .lt("event_time", cutoff),
    supabaseAdmin
      .from("google_login_events")
      .delete()
      .eq("organization_id", organizationId)
      .lt("event_time", cutoff),
  ]);
}

function toUserFacingSyncError(error: unknown): string {
  if (error instanceof GoogleApiError) {
    if (error.reason === "accessNotConfigured") {
      return "Admin SDK API is disabled. Enable the Admin SDK API in the Google Cloud project and reconnect.";
    }

    if (error.status === 403) {
      return "Please connect with a Google Workspace admin that has access to Admin SDK Directory and Reports.";
    }
  }

  if (error instanceof Error && error.message.includes("invalid_grant")) {
    return "Google refresh token was revoked. Please reconnect.";
  }

  return error instanceof Error ? error.message : "Google Workspace sync failed.";
}
