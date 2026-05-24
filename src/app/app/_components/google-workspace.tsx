"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpDown,
  BadgeCheck,
  BadgeEuro,
  CalendarDays,
  Check,
  ChevronDown,
  CircleGauge,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Hash,
  Link2,
  ListFilter,
  Percent,
  Plus,
  Search,
  Sigma,
  SlidersHorizontal,
  Table2,
  Type,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  computeUtilization,
  formatRelativeLastUsed,
  getLoginFrequency,
  getUtilizationStatus,
  type LoginFrequency,
  type UtilizationStatus,
} from "@/lib/google-workspace/usageMetrics";
import {
  DEFAULT_IDENTITY_TABLE_FILTERS,
  DEFAULT_IDENTITY_TABLE_SORTS,
  applyIdentityTableControls,
  createIdentityFilterRule,
  createIdentitySortRule,
  getActiveIdentityFilterCount,
  getDefaultFilterOperator,
  getDefaultFilterValue,
  parseIdentityTableStateFromSearchParams,
  writeIdentityTableStateToSearchParams,
  type IdentityFilterOperator,
  type IdentityFilterProperty,
  type IdentityFilterRule,
  type IdentitySortDirection,
  type IdentitySortField,
  type IdentitySortRule,
} from "@/lib/google-workspace/identityTableControls";
import type { GoogleFrontendStatus } from "@/lib/integrations/google/frontendStatus";
import { buildLogoUrl } from "@/lib/suppliers/logo";

type GoogleStatusResponse = {
  connectedAdminEmail: string | null;
  grantedScopes?: string[];
  lastError: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncStartedAt: string | null;
  oauthAppsDiscovered: number;
  permissionError?: boolean;
  rawStatus?: string | null;
  samlAppsDiscovered: number;
  status: GoogleFrontendStatus;
  suppliersMatched: number;
  usersSynced: number;
};

type GoogleSyncLinkResponse = {
  errors?: string[];
  expiresAt: string;
  url: string;
};

type IdentitySupplierRow = {
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
};

type IdentitySignalsData = {
  summary: {
    authorizedAppsDiscovered: number;
    googleUsersSynced: number;
    oauthAppsDiscovered: number;
    paidSuppliersMatched: number;
    samlAppsDiscovered: number;
    suppliersNeedingAppUsage: number;
    suspendedUsers: number;
  };
  suppliers: IdentitySupplierRow[];
};

const EMPTY_STATUS: GoogleStatusResponse = {
  connectedAdminEmail: null,
  lastError: null,
  lastSyncCompletedAt: null,
  lastSyncStartedAt: null,
  oauthAppsDiscovered: 0,
  samlAppsDiscovered: 0,
  status: "not_connected",
  suppliersMatched: 0,
  usersSynced: 0,
};

const FILTER_PROPERTY_OPTIONS = [
  { Icon: Type, label: "Name", value: "application" },
  { Icon: CircleGauge, label: "Identity mode", value: "identityMode" },
  { Icon: BadgeCheck, label: "Confidence", value: "confidence" },
  { Icon: Hash, label: "Pricing", value: "pricing" },
  { Icon: Percent, label: "Utilization", value: "utilization" },
];

const IDENTITY_MODE_FILTER_OPTIONS = [
  { label: "SAML", value: "saml" },
  { label: "OAuth", value: "oauth" },
  { label: "Authorized app", value: "authorized_app" },
  { label: "Unknown", value: "unknown" },
];

const CONFIDENCE_FILTER_OPTIONS = [
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
  { label: "Unknown", value: "unknown" },
];

const PRICING_FILTER_OPTIONS = [
  { label: "Known", value: "known" },
  { label: "Missing", value: "missing" },
];

const UTILIZATION_FILTER_OPTIONS = [
  { label: "Healthy", value: "healthy" },
  { label: "Underutilized", value: "underutilized" },
  { label: "Needs data", value: "needs_data" },
];

const FILTER_OPERATOR_OPTIONS = {
  application: [{ label: "Contains", value: "contains" }],
  confidence: [
    { label: "Is", value: "is" },
    { label: "Is not", value: "is_not" },
  ],
  identityMode: [
    { label: "Is", value: "is" },
    { label: "Is not", value: "is_not" },
  ],
  pricing: [
    { label: "Is", value: "is" },
    { label: "Is not", value: "is_not" },
  ],
  utilization: [
    { label: "Is", value: "is" },
    { label: "Is not", value: "is_not" },
  ],
} satisfies Record<
  IdentityFilterProperty,
  Array<{ label: string; value: IdentityFilterOperator }>
>;

const SORT_FIELD_OPTIONS = [
  { label: "Name", value: "application" },
  { label: "Total pricing", value: "monthlySpend" },
  { label: "Last SAML Login", value: "lastSignalAt" },
  { label: "Login Users", value: "loginUsers" },
  { label: "Utilization", value: "utilization" },
  { label: "Login Frequency", value: "loginFrequency" },
  { label: "Confidence", value: "confidence" },
];

type IdentityColumnId =
  | "application"
  | "pricingType"
  | "unitPrice"
  | "totalPricing"
  | "lastSignalAt"
  | "loginUsers"
  | "utilization"
  | "loginFrequency"
  | "confidence";

type IdentityColumnConfig = {
  defaultLabel: string;
  filterProperty?: IdentityFilterProperty;
  Icon: LucideIcon;
  id: IdentityColumnId;
  sortField?: IdentitySortField;
  widthClassName: string;
};

type IdentityColumnSettings = Record<
  IdentityColumnId,
  {
    label: string;
    visible: boolean;
  }
>;

const COLUMN_MENU_WIDTH = 318;
const TOOLBAR_MENU_WIDTH = 352;

const IDENTITY_TABLE_COLUMNS: IdentityColumnConfig[] = [
  {
    defaultLabel: "Application",
    filterProperty: "application",
    Icon: Type,
    id: "application",
    sortField: "application",
    widthClassName: "w-[260px]",
  },
  {
    defaultLabel: "Pricing type",
    filterProperty: "pricing",
    Icon: Hash,
    id: "pricingType",
    sortField: "monthlySpend",
    widthClassName: "w-[135px]",
  },
  {
    defaultLabel: "Unit price",
    filterProperty: "pricing",
    Icon: BadgeEuro,
    id: "unitPrice",
    sortField: "monthlySpend",
    widthClassName: "w-[140px]",
  },
  {
    defaultLabel: "Total pricing",
    filterProperty: "pricing",
    Icon: Sigma,
    id: "totalPricing",
    sortField: "monthlySpend",
    widthClassName: "w-[150px]",
  },
  {
    defaultLabel: "Last SAML Login",
    Icon: CalendarDays,
    id: "lastSignalAt",
    sortField: "lastSignalAt",
    widthClassName: "w-[145px]",
  },
  {
    defaultLabel: "Login Users",
    Icon: Users,
    id: "loginUsers",
    sortField: "loginUsers",
    widthClassName: "w-[120px]",
  },
  {
    defaultLabel: "Utilization",
    filterProperty: "utilization",
    Icon: Percent,
    id: "utilization",
    sortField: "utilization",
    widthClassName: "w-[170px]",
  },
  {
    defaultLabel: "Login Frequency",
    Icon: Activity,
    id: "loginFrequency",
    sortField: "loginFrequency",
    widthClassName: "w-[135px]",
  },
  {
    defaultLabel: "Confidence",
    filterProperty: "confidence",
    Icon: BadgeCheck,
    id: "confidence",
    sortField: "confidence",
    widthClassName: "w-[110px]",
  },
];

function createDefaultColumnSettings(): IdentityColumnSettings {
  return Object.fromEntries(
    IDENTITY_TABLE_COLUMNS.map((column) => [
      column.id,
      { label: column.defaultLabel, visible: true },
    ]),
  ) as IdentityColumnSettings;
}

export function ConnectGoogleWorkspaceButton({
  children = "Connect Google Workspace",
  href = "/app/integrations/google/connect",
}: {
  children?: React.ReactNode;
  href?: string;
}) {
  return (
    <Link
      className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
      href={href}
    >
      {children}
    </Link>
  );
}

export function GoogleWorkspaceIntegrationCard({
  initialStatus,
}: {
  initialStatus: GoogleStatusResponse;
}) {
  const [status, setStatus] = useState<GoogleStatusResponse>(initialStatus);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isCreatingSyncLink, setIsCreatingSyncLink] = useState(false);
  const [syncLink, setSyncLink] = useState<GoogleSyncLinkResponse | null>(null);
  const [syncLinkCopied, setSyncLinkCopied] = useState(false);

  async function refreshStatus() {
    const response = await fetch("/api/integrations/google/status");
    const result = (await response.json()) as GoogleStatusResponse & {
      errors?: string[];
    };

    if (!response.ok) {
      throw new Error(
        result.errors?.[0] ?? "Unable to load Google Workspace status.",
      );
    }

    setStatus((current) => ({
      ...current,
      ...result,
    }));
  }

  async function runSync() {
    setActionError(null);
    setIsSyncing(true);
    setStatus((current) => ({ ...current, status: "syncing" }));

    try {
      const response = await fetch("/api/integrations/google/sync", {
        method: "POST",
      });
      const result = (await response.json()) as { errors?: string[] };

      if (!response.ok) {
        throw new Error(result.errors?.[0] ?? "Unable to sync Google Workspace.");
      }

      await refreshStatus();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to sync Google Workspace.",
      );
      await refreshStatus().catch(() => undefined);
    } finally {
      setIsSyncing(false);
    }
  }

  async function disconnect() {
    setActionError(null);
    setIsDisconnecting(true);

    try {
      const response = await fetch("/api/integrations/google/disconnect", {
        method: "DELETE",
      });
      const result = (await response.json()) as { errors?: string[] };

      if (!response.ok) {
        throw new Error(
          result.errors?.[0] ?? "Unable to disconnect Google Workspace.",
        );
      }

      setStatus(EMPTY_STATUS);
      await refreshStatus();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Unable to disconnect Google Workspace.",
      );
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function createSyncLink() {
    setActionError(null);
    setIsCreatingSyncLink(true);
    setSyncLinkCopied(false);

    try {
      const response = await fetch("/api/integrations/google/sync-links", {
        method: "POST",
      });
      const result = (await response.json()) as GoogleSyncLinkResponse;

      if (!response.ok) {
        throw new Error(
          result.errors?.[0] ?? "Unable to create Google Workspace sync link.",
        );
      }

      setSyncLink(result);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Unable to create Google Workspace sync link.",
      );
    } finally {
      setIsCreatingSyncLink(false);
    }
  }

  async function copySyncLink() {
    if (!syncLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(syncLink.url);
      setSyncLinkCopied(true);
    } catch {
      setActionError("Unable to copy the sync link.");
    }
  }

  const isConnected = status.status === "connected" || status.status === "syncing";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-zinc-950">
              Google Workspace
            </h2>
            <StatusPill status={status.status} />
          </div>
          <p className="max-w-3xl text-sm leading-6 text-zinc-600">
            Collect read-only identity and SSO signals from Google Workspace:
            users, suspended accounts, OAuth app events, SAML login events, and
            authorized third-party apps.
          </p>

          {isConnected ? (
            <dl className="grid gap-3 text-sm text-zinc-700 sm:grid-cols-2 lg:grid-cols-3">
              <MetadataItem
                label="Connected admin"
                value={status.connectedAdminEmail ?? "-"}
              />
              <MetadataItem
                label="Last sync"
                value={formatNullableDate(status.lastSyncCompletedAt)}
              />
              <MetadataItem
                label="Users synced"
                value={String(status.usersSynced)}
              />
              <MetadataItem
                label="OAuth apps"
                value={String(status.oauthAppsDiscovered)}
              />
              <MetadataItem
                label="SAML apps"
                value={String(status.samlAppsDiscovered)}
              />
              <MetadataItem
                label="Suppliers matched"
                value={String(status.suppliersMatched)}
              />
            </dl>
          ) : null}

          {isConnected && status.grantedScopes?.length ? (
            <div className="flex max-w-4xl flex-wrap gap-2">
              {status.grantedScopes.map((scope) => (
                <span
                  className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600"
                  key={scope}
                >
                  {scope.replace("https://www.googleapis.com/auth/", "")}
                </span>
              ))}
            </div>
          ) : null}

          {status.lastError ? (
            <p className="max-w-3xl text-sm text-red-700">{status.lastError}</p>
          ) : null}
          {actionError ? (
            <p className="max-w-3xl text-sm text-red-700" role="alert">
              {actionError}
            </p>
          ) : null}
          {syncLink ? (
            <div className="flex max-w-3xl flex-col gap-2 border-l-2 border-emerald-500 pl-3">
              <p className="text-sm font-medium text-zinc-800">
                Sync link created
              </p>
              <p className="text-sm leading-6 text-zinc-600">
                Valid until {formatNullableDate(syncLink.expiresAt)}.
              </p>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <input
                  className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700"
                  readOnly
                  value={syncLink.url}
                />
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
                  onClick={copySyncLink}
                  type="button"
                >
                  {syncLinkCopied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {syncLinkCopied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {!isConnected ? (
            <>
              <ConnectGoogleWorkspaceButton />
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                disabled={isCreatingSyncLink}
                onClick={createSyncLink}
                type="button"
              >
                <Link2 className="h-4 w-4" />
                {isCreatingSyncLink ? "Creating..." : "Create sync link"}
              </button>
            </>
          ) : null}
          {isConnected ? (
            <>
              <button
                className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                disabled={isSyncing || status.status === "syncing"}
                onClick={runSync}
                type="button"
              >
                {isSyncing || status.status === "syncing" ? "Syncing..." : "Run sync"}
              </button>
              <Link
                className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
                href="/app/usage/identity"
              >
                View signals
              </Link>
              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-red-200 bg-white px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300"
                disabled={isDisconnecting}
                onClick={disconnect}
                type="button"
              >
                {isDisconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function GooglePreConsentScreen() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-zinc-500">Integration setup</p>
          <h1 className="text-3xl font-semibold tracking-normal text-zinc-950">
            Connect Google Workspace
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-zinc-600">
            We use read-only admin access to understand which SaaS tools are
            visible through Google Workspace and which users have recent
            identity signals.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <PermissionList
            items={[
              "Google Workspace users",
              "Suspended user status",
              "OAuth app events",
              "SAML login events",
              "Login events",
              "Authorized third-party apps",
            ]}
            title="We will access"
          />
          <PermissionList
            items={[
              "Modify users",
              "Suspend accounts",
              "Revoke tokens",
              "Change app access policies",
              "Write to Google Workspace",
            ]}
            title="We will not"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ConnectGoogleWorkspaceButton href="/api/integrations/google/start">
            Continue with Google
          </ConnectGoogleWorkspaceButton>
          <Link
            className="text-sm font-medium text-zinc-600 hover:underline"
            href="/app/settings/integrations"
          >
            Back to integrations
          </Link>
        </div>
      </div>
    </section>
  );
}

export function GoogleSyncProgress({
  initialStatus,
}: {
  initialStatus: GoogleStatusResponse;
}) {
  const [status, setStatus] = useState<GoogleStatusResponse>(() =>
    initialStatus.status === "connected"
      ? { ...initialStatus, status: "syncing" }
      : initialStatus,
  );
  const [error, setError] = useState<string | null>(null);
  const syncStarted = useRef(false);
  const [syncRequestSettled, setSyncRequestSettled] = useState(false);

  useEffect(() => {
    if (syncStarted.current) {
      return;
    }

    syncStarted.current = true;

    void fetch("/api/integrations/google/sync", { method: "POST" })
      .then(async (response) => {
        const result = (await response.json()) as { errors?: string[] };

        if (!response.ok) {
          throw new Error(result.errors?.[0] ?? "Unable to sync Google Workspace.");
        }
      })
      .catch((requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to sync Google Workspace.",
        );
      })
      .finally(() => {
        setSyncRequestSettled(true);
      });
  }, []);

  useEffect(() => {
    if (status.status !== "syncing" && syncRequestSettled) {
      return;
    }

    const interval = window.setInterval(() => {
      void fetch("/api/integrations/google/status")
        .then(async (response) => {
          const result = (await response.json()) as GoogleStatusResponse & {
            errors?: string[];
          };

          if (!response.ok) {
            throw new Error(
              result.errors?.[0] ?? "Unable to load Google Workspace status.",
            );
          }

          setStatus((current) => ({ ...current, ...result }));
        })
        .catch((requestError) => {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load Google Workspace status.",
          );
        });
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [status.status, syncRequestSettled]);

  const isComplete = status.status === "connected" && syncRequestSettled && !error;
  const steps = useMemo(
    () => [
      { done: isComplete || status.usersSynced > 0, label: "Users" },
      {
        done: isComplete || status.oauthAppsDiscovered > 0,
        label: "OAuth app events",
      },
      {
        done: isComplete || status.samlAppsDiscovered > 0,
        label: "SAML login events",
      },
      { done: isComplete, label: "Login events" },
      { done: isComplete, label: "Authorized apps" },
      { done: isComplete || status.suppliersMatched > 0, label: "Supplier matching" },
    ],
    [isComplete, status],
  );

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-zinc-500">Google Workspace</p>
          <h1 className="text-3xl font-semibold tracking-normal text-zinc-950">
            Syncing identity signals
          </h1>
          <p className="text-sm leading-6 text-zinc-600">
            We are syncing read-only Google Workspace users, SSO events, OAuth
            app signals, and supplier matches.
          </p>
        </div>

        <div className="grid gap-3">
          {steps.map((step) => (
            <div
              className="flex items-center justify-between rounded-md border border-zinc-200 px-4 py-3"
              key={step.label}
            >
              <span className="text-sm font-medium text-zinc-800">
                {step.label}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  step.done
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {step.done ? "Done" : "Syncing"}
              </span>
            </div>
          ))}
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {isComplete ? (
          <div className="flex flex-col gap-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4">
            <dl className="grid gap-3 text-sm text-emerald-950 sm:grid-cols-2">
              <MetadataItem label="Users synced" value={String(status.usersSynced)} />
              <MetadataItem
                label="OAuth apps discovered"
                value={String(status.oauthAppsDiscovered)}
              />
              <MetadataItem
                label="SAML apps discovered"
                value={String(status.samlAppsDiscovered)}
              />
              <MetadataItem
                label="Suppliers matched"
                value={String(status.suppliersMatched)}
              />
            </dl>
            <div>
              <Link
                className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
                href="/app/usage/identity"
              >
                View SSO signals
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function IdentitySignalsDashboard({
  data,
  googleStatus,
}: {
  data: IdentitySignalsData;
  googleStatus: GoogleStatusResponse;
}) {
  if (googleStatus.permissionError) {
    return (
      <EmptyState
        action={
          <ConnectGoogleWorkspaceButton>
            Reconnect with Google Admin
          </ConnectGoogleWorkspaceButton>
        }
        title="Google Workspace was connected, but the account does not have enough permissions to access Directory and Reports data."
      />
    );
  }

  if (googleStatus.status === "not_connected") {
    return (
      <EmptyState
        action={<ConnectGoogleWorkspaceButton />}
        title="Connect Google Workspace to enrich your SaaS inventory with identity and SSO signals."
      />
    );
  }

  const dashboardMetrics = getDashboardMetrics(data);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <SummaryCard
          label="Google Users Synced"
          value={String(data.summary.googleUsersSynced)}
        />
        <SummaryCard
          label="Apps Discovered"
          value={String(dashboardMetrics.appsDiscovered)}
        />
        <SummaryCard
          label="Apps Matched"
          value={String(data.summary.paidSuppliersMatched)}
        />
        <SummaryCard
          label="Underutilized Apps"
          value={String(dashboardMetrics.underutilizedApps)}
        />
        <SummaryCard
          label="Estimated Wasted Seats"
          value={String(dashboardMetrics.estimatedWastedSeats)}
        />
        <SummaryCard
          label="Needs App Usage"
          value={String(dashboardMetrics.needsAppUsage)}
        />
      </div>

      {data.summary.samlAppsDiscovered === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No SAML login events found yet. Google OAuth events show access grants
          and revocations; reliable Google login signals appear only when a SaaS
          app is configured as a SAML app in Google Admin and users sign in
          through Google SSO.
        </div>
      ) : null}

      <SupplierIdentitySignalsTable suppliers={data.suppliers} />
    </div>
  );
}

export function SupplierIdentitySignalsTable({
  suppliers,
}: {
  suppliers: IdentitySupplierRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSearchString = searchParams.toString();
  const initialTableState = parseIdentityTableStateFromSearchParams(searchParams);
  const [filters, setFilters] = useState<IdentityFilterRule[]>(
    initialTableState.filters,
  );
  const [sorts, setSorts] = useState<IdentitySortRule[]>(
    initialTableState.sorts,
  );
  const [columnSettings, setColumnSettings] = useState<IdentityColumnSettings>(
    createDefaultColumnSettings,
  );
  const [openMenu, setOpenMenu] = useState<
    "filter" | "properties" | "sort" | null
  >(null);
  const [openColumnMenu, setOpenColumnMenu] =
    useState<IdentityColumnId | null>(null);
  const [columnMenuPosition, setColumnMenuPosition] = useState({
    left: 0,
    top: 0,
  });
  const [toolbarMenuPosition, setToolbarMenuPosition] = useState({
    left: 0,
    top: 0,
  });
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const propertiesMenuRef = useRef<HTMLDivElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const lastWrittenSearchString = useRef<string | null>(null);
  const visibleSuppliers = useMemo(
    () => applyIdentityTableControls({ filters, sorts, suppliers }),
    [filters, sorts, suppliers],
  );
  const visibleColumns = useMemo(
    () =>
      IDENTITY_TABLE_COLUMNS.filter(
        (column) => columnSettings[column.id]?.visible ?? true,
      ),
    [columnSettings],
  );
  const activeFilterCount = getActiveIdentityFilterCount(filters);
  const hasCustomSort = sorts.length > 0;
  const hasCustomColumns = IDENTITY_TABLE_COLUMNS.some((column) => {
    const setting = columnSettings[column.id];

    return (
      !setting?.visible ||
      (setting.label.trim() && setting.label.trim() !== column.defaultLabel)
    );
  });
  const hasCustomView = activeFilterCount > 0 || hasCustomSort || hasCustomColumns;
  const activeColumn = openColumnMenu
    ? IDENTITY_TABLE_COLUMNS.find((column) => column.id === openColumnMenu) ?? null
    : null;

  useEffect(() => {
    if (lastWrittenSearchString.current === currentSearchString) {
      lastWrittenSearchString.current = null;
      return;
    }

    const nextState = parseIdentityTableStateFromSearchParams(searchParams);
    setFilters(nextState.filters);
    setSorts(nextState.sorts);
  }, [currentSearchString, searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(currentSearchString);
    const nextSearchString = writeIdentityTableStateToSearchParams(params, {
      filters,
      sorts,
    }).toString();

    if (nextSearchString === currentSearchString) {
      return;
    }

    lastWrittenSearchString.current = nextSearchString;
    router.replace(
      `${pathname}${nextSearchString ? `?${nextSearchString}` : ""}`,
      { scroll: false },
    );
  }, [currentSearchString, filters, pathname, router, sorts]);

  useEffect(() => {
    if (!openMenu && !openColumnMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (
        filterMenuRef.current?.contains(target) ||
        propertiesMenuRef.current?.contains(target) ||
        columnMenuRef.current?.contains(target) ||
        sortMenuRef.current?.contains(target)
      ) {
        return;
      }

      setOpenMenu(null);
      setOpenColumnMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setOpenColumnMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openColumnMenu, openMenu]);

  function addFilterRule(property: IdentityFilterProperty = "application") {
    setFilters((current) => [...current, createIdentityFilterRule(property)]);
  }

  function updateFilterRule(
    id: string,
    updates: Partial<Omit<IdentityFilterRule, "id">>,
  ) {
    setFilters((current) =>
      current.map((filter) =>
        filter.id === id ? { ...filter, ...updates } : filter,
      ),
    );
  }

  function removeFilterRule(id: string) {
    setFilters((current) => current.filter((filter) => filter.id !== id));
  }

  function addSortRule() {
    const field = getNextSortField(sorts);
    setSorts((current) => [...current, createIdentitySortRule(field)]);
  }

  function updateSortRule(
    id: string,
    updates: Partial<Omit<IdentitySortRule, "id">>,
  ) {
    setSorts((current) =>
      current.map((sort) => (sort.id === id ? { ...sort, ...updates } : sort)),
    );
  }

  function removeSortRule(id: string) {
    setSorts((current) => current.filter((sort) => sort.id !== id));
  }

  function openColumnHeaderMenu(
    columnId: IdentityColumnId,
    element: HTMLButtonElement,
  ) {
    const bounds = element.getBoundingClientRect();

    setColumnMenuPosition({
      left: Math.max(
        8,
        Math.min(bounds.left, window.innerWidth - COLUMN_MENU_WIDTH - 8),
      ),
      top: bounds.bottom + 6,
    });
    setOpenMenu(null);
    setOpenColumnMenu((current) => (current === columnId ? null : columnId));
  }

  function openToolbarMenu(
    menu: "filter" | "properties" | "sort",
    element: HTMLButtonElement,
    width = TOOLBAR_MENU_WIDTH,
  ) {
    const bounds = element.getBoundingClientRect();

    setToolbarMenuPosition({
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
      top: bounds.bottom + 6,
    });
    setOpenColumnMenu(null);
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function updateColumnLabel(columnId: IdentityColumnId, label: string) {
    setColumnSettings((current) => ({
      ...current,
      [columnId]: {
        ...current[columnId],
        label,
      },
    }));
  }

  function setColumnVisibility(columnId: IdentityColumnId, visible: boolean) {
    if (!visible && visibleColumns.length <= 1) {
      return;
    }

    setColumnSettings((current) => ({
      ...current,
      [columnId]: {
        ...current[columnId],
        visible,
      },
    }));
  }

  function showAllColumns() {
    setColumnSettings((current) => {
      const next = { ...current };

      for (const column of IDENTITY_TABLE_COLUMNS) {
        next[column.id] = { ...next[column.id], visible: true };
      }

      return next;
    });
  }

  function addColumnFilter(column: IdentityColumnConfig) {
    if (column.filterProperty) {
      setFilters((current) => [
        ...current,
        createIdentityFilterRule(column.filterProperty),
      ]);
    }

    setOpenColumnMenu(null);
    setOpenMenu(null);
  }

  function setColumnSort(
    column: IdentityColumnConfig,
    direction: IdentitySortDirection,
  ) {
    if (!column.sortField) {
      return;
    }

    const sortField = column.sortField;

    setSorts((current) => [
      {
        ...createIdentitySortRule(sortField),
        direction,
        field: sortField,
      },
      ...current.filter((sort) => sort.field !== sortField),
    ]);
    setOpenColumnMenu(null);
  }

  function resetView() {
    setFilters(DEFAULT_IDENTITY_TABLE_FILTERS);
    setSorts(DEFAULT_IDENTITY_TABLE_SORTS);
    setColumnSettings(createDefaultColumnSettings());
  }

  return (
    <section className="isolate min-w-0 max-w-full overflow-hidden rounded-[10px] border border-[#e6e4df] bg-white shadow-[0_1px_2px_rgba(15,15,15,0.04)]">
      <div className="relative z-[200] bg-white">
        <div className="flex flex-col gap-4 px-5 pb-3 pt-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-[34px] font-semibold leading-tight tracking-normal text-[#37352f]">
              Applications
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-[#8b8781]">
            <div className="relative" ref={filterMenuRef}>
              <NotionToolbarIconButton
                active={activeFilterCount > 0}
                expanded={openMenu === "filter"}
                label="Filter"
                onClick={(event) => openToolbarMenu("filter", event.currentTarget)}
              >
                <ListFilter className="h-4 w-4" />
              </NotionToolbarIconButton>
              {openMenu === "filter" ? (
                <FilterBuilderPopover
                  filters={filters}
                  onAdd={addFilterRule}
                  onClear={() => setFilters(DEFAULT_IDENTITY_TABLE_FILTERS)}
                  onRemove={removeFilterRule}
                  onUpdate={updateFilterRule}
                  position={toolbarMenuPosition}
                />
              ) : null}
            </div>
            <div className="relative" ref={sortMenuRef}>
              <NotionToolbarIconButton
                active={hasCustomSort}
                expanded={openMenu === "sort"}
                label="Sort"
                onClick={(event) => openToolbarMenu("sort", event.currentTarget)}
              >
                <ArrowUpDown className="h-4 w-4" />
              </NotionToolbarIconButton>
              {openMenu === "sort" ? (
                <SortBuilderPopover
                  onAdd={addSortRule}
                  onClear={() => setSorts(DEFAULT_IDENTITY_TABLE_SORTS)}
                  onRemove={removeSortRule}
                  onUpdate={updateSortRule}
                  position={toolbarMenuPosition}
                  sorts={sorts}
                />
              ) : null}
            </div>
            <NotionToolbarIconButton
              active={false}
              expanded={false}
              label="Search"
              onClick={() => addFilterRule("application")}
            >
              <Search className="h-4 w-4" />
            </NotionToolbarIconButton>
            <div className="relative" ref={propertiesMenuRef}>
              <NotionToolbarIconButton
                active={hasCustomColumns}
                expanded={openMenu === "properties"}
                label="Properties"
                onClick={(event) =>
                  openToolbarMenu(
                    "properties",
                    event.currentTarget,
                    336,
                  )
                }
              >
                <SlidersHorizontal className="h-4 w-4" />
              </NotionToolbarIconButton>
              {openMenu === "properties" ? (
                <ColumnVisibilityPopover
                  columnSettings={columnSettings}
                  columns={IDENTITY_TABLE_COLUMNS}
                  onShowAll={showAllColumns}
                  onVisibilityChange={setColumnVisibility}
                  position={toolbarMenuPosition}
                  visibleColumnsCount={visibleColumns.length}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex min-h-[48px] items-center justify-between gap-3 border-b border-[#e6e4df] px-5">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="inline-flex h-8 items-center gap-2 rounded-full bg-[#efeeeb] px-3 text-[15px] font-semibold text-[#37352f]"
              type="button"
            >
              <Table2 className="h-4 w-4" />
              <span>Table</span>
            </button>
          </div>
          <span className="shrink-0 text-[13px] font-medium text-[#a09d97]">
            {visibleSuppliers.length}
            {visibleSuppliers.length === suppliers.length
              ? ""
              : ` of ${suppliers.length}`}
          </span>
        </div>

        <div className="flex min-h-[50px] flex-wrap items-center justify-between gap-2 border-b border-[#efeeeb] px-5 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {sorts.length > 0 ? (
              sorts.map((sort) => (
                <NotionControlChip
                  key={sort.id}
                  label={getSortFieldLabel(sort.field)}
                  onRemove={() => removeSortRule(sort.id)}
                  prefix={sort.direction === "asc" ? "↑" : "↓"}
                />
              ))
            ) : null}
            {filters.length > 0 ? (
              <ActiveViewChips
                filters={filters}
                onFiltersChange={setFilters}
                onSortsChange={setSorts}
                sorts={[]}
              />
            ) : null}
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2 text-[15px] font-medium text-[#8b8781] transition-colors hover:bg-[#f5f4f2] hover:text-[#37352f]"
              onClick={(event) => openToolbarMenu("filter", event.currentTarget)}
              type="button"
            >
              <Plus className="h-4 w-4" />
              <span>Filter</span>
            </button>
          </div>
          {hasCustomView ? (
            <button
              className="h-8 rounded-[6px] px-2 text-[13px] font-medium text-[#78746e] transition-colors hover:bg-[#f1f1ef] hover:text-[#37352f]"
              onClick={resetView}
              type="button"
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>
      <div className="relative z-0 max-h-[calc(100vh-6rem)] max-w-full overflow-auto">
        <table className="w-full min-w-[1320px] table-fixed border-collapse text-left text-sm">
          <colgroup>
            {visibleColumns.map((column) => (
              <col className={column.widthClassName} key={column.id} />
            ))}
          </colgroup>
          <thead className="bg-zinc-100 text-xs uppercase text-zinc-500">
            <tr>
              {visibleColumns.map((column) => (
                <IdentityColumnHeader
                  column={column}
                  key={column.id}
                  label={getColumnLabel(column, columnSettings)}
                  onOpen={openColumnHeaderMenu}
                  sorted={sorts.some((sort) => sort.field === column.sortField)}
                />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {visibleSuppliers.length > 0 ? (
              visibleSuppliers.map((supplier) => (
                <UsageDashboardRow
                  columns={visibleColumns}
                  key={supplier.supplierId}
                  supplier={supplier}
                />
              ))
            ) : (
              <tr>
                <td
                  className="px-5 py-6 text-center text-zinc-500"
                  colSpan={visibleColumns.length}
                >
                  {suppliers.length > 0
                    ? "No apps match these filters."
                    : "No Google identity signals matched to suppliers yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {activeColumn ? (
        <ColumnHeaderMenu
          column={activeColumn}
          label={getColumnLabel(activeColumn, columnSettings)}
          menuRef={columnMenuRef}
          onFilter={addColumnFilter}
          onHide={(columnId) => setColumnVisibility(columnId, false)}
          onLabelChange={updateColumnLabel}
          onSort={setColumnSort}
          position={columnMenuPosition}
          canHide={visibleColumns.length > 1}
        />
      ) : null}
    </section>
  );
}

function IdentityColumnHeader({
  column,
  label,
  onOpen,
  sorted,
}: {
  column: IdentityColumnConfig;
  label: string;
  onOpen: (columnId: IdentityColumnId, element: HTMLButtonElement) => void;
  sorted: boolean;
}) {
  const Icon = column.Icon;

  return (
    <th className="group/column sticky top-0 z-10 bg-zinc-100 px-1 py-1.5 font-semibold shadow-[inset_0_-1px_0_rgb(228_228_231)]">
      <button
        aria-haspopup="menu"
        className={`flex h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-[5px] px-2 text-left text-xs uppercase text-zinc-500 transition-colors hover:bg-[#e9e8e5] hover:text-[#37352f] ${
          sorted ? "bg-[#efeeeb] text-[#5f5b55]" : ""
        }`}
        onClick={(event) => onOpen(column.id, event.currentTarget)}
        type="button"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#8b8781]" />
        <span className="truncate">{label}</span>
      </button>
    </th>
  );
}

function ColumnHeaderMenu({
  canHide,
  column,
  label,
  menuRef,
  onFilter,
  onHide,
  onLabelChange,
  onSort,
  position,
}: {
  canHide: boolean;
  column: IdentityColumnConfig;
  label: string;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onFilter: (column: IdentityColumnConfig) => void;
  onHide: (columnId: IdentityColumnId) => void;
  onLabelChange: (columnId: IdentityColumnId, label: string) => void;
  onSort: (
    column: IdentityColumnConfig,
    direction: IdentitySortDirection,
  ) => void;
  position: { left: number; top: number };
}) {
  const canSort = Boolean(column.sortField);
  const Icon = column.Icon;

  return (
    <div
      className="fixed z-[10000] w-[318px] rounded-[12px] border border-[#e6e4e1] bg-white p-1.5 text-[15px] text-[#2f2e2b] shadow-[0_12px_32px_rgba(15,15,15,0.18)]"
      ref={menuRef}
      role="menu"
      style={{ left: position.left, top: position.top }}
    >
      <div className="grid grid-cols-[34px_minmax(0,1fr)] items-center gap-1 px-1 pb-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-[7px] border border-[#e6e4e1] text-[17px] font-semibold text-[#78746e]">
          <Icon className="h-4 w-4" />
        </div>
        <input
          autoFocus
          className="h-9 min-w-0 rounded-[8px] border-2 border-[#2f7cf6] bg-white px-2.5 text-[15px] font-medium leading-none text-[#37352f] outline-none placeholder:text-[#aaa7a2]"
          onChange={(event) => onLabelChange(column.id, event.target.value)}
          value={label}
        />
      </div>
      <div className="mx-2 my-1 h-px bg-[#e5e3df]" />
      <ColumnMenuButton
        icon={<FilterIcon />}
        label="Filter"
        onClick={() => onFilter(column)}
      />
      <ColumnMenuButton
        disabled={!canSort}
        icon={<SortIcon />}
        label="Sort ascending"
        onClick={() => onSort(column, "asc")}
      />
      <ColumnMenuButton
        disabled={!canSort}
        icon={<SortIcon />}
        label="Sort descending"
        onClick={() => onSort(column, "desc")}
      />
      <div className="mx-2 my-1 h-px bg-[#e5e3df]" />
      <ColumnMenuButton
        disabled={!canHide}
        icon={<EyeOffIcon />}
        label={canHide ? "Hide column" : "Keep one column visible"}
        onClick={() => onHide(column.id)}
      />
    </div>
  );
}

function ColumnMenuButton({
  disabled = false,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="grid h-9 w-full grid-cols-[32px_minmax(0,1fr)] items-center rounded-[7px] px-2 text-left text-[15px] font-normal text-[#37352f] transition-colors hover:bg-[#efeeeb] disabled:cursor-not-allowed disabled:text-[#b9b6b0] disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="flex items-center justify-center text-[#78746e]">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function ColumnVisibilityPopover({
  columnSettings,
  columns,
  onShowAll,
  onVisibilityChange,
  position,
  visibleColumnsCount,
}: {
  columnSettings: IdentityColumnSettings;
  columns: IdentityColumnConfig[];
  onShowAll: () => void;
  onVisibilityChange: (columnId: IdentityColumnId, visible: boolean) => void;
  position: { left: number; top: number };
  visibleColumnsCount: number;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredColumns = columns.filter((column) =>
    getColumnLabel(column, columnSettings)
      .toLowerCase()
      .includes(normalizedQuery),
  );
  const shownColumns = filteredColumns.filter(
    (column) => columnSettings[column.id]?.visible ?? true,
  );
  const hiddenColumns = filteredColumns.filter(
    (column) => !(columnSettings[column.id]?.visible ?? true),
  );

  return (
    <div
      className="fixed z-[10000] w-[336px] rounded-[12px] border border-[#e6e4e1] bg-white p-1.5 text-[14px] text-[#2f2e2b] shadow-[0_12px_32px_rgba(15,15,15,0.18)]"
      style={{ left: position.left, top: position.top }}
    >
      <div className="px-1 pb-1">
        <div className="px-1 pb-2 text-[15px] font-semibold text-[#37352f]">
          Property visibility
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#aaa7a2]" />
          <input
            autoFocus
            className="h-9 w-full rounded-[8px] border-2 border-[#2f7cf6] bg-white pl-8 pr-2.5 text-[15px] text-[#37352f] outline-none placeholder:text-[#aaa7a2]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a property..."
            value={query}
          />
        </div>
      </div>
      <ColumnVisibilitySection
        actionLabel="Hide all"
        columnSettings={columnSettings}
        columns={shownColumns}
        empty="No visible properties"
        onAction={() => {
          for (const column of shownColumns.slice(1)) {
            onVisibilityChange(column.id, false);
          }
        }}
        onVisibilityChange={onVisibilityChange}
        title="Shown in table"
        visible
        visibleColumnsCount={visibleColumnsCount}
      />
      <ColumnVisibilitySection
        actionLabel="Show all"
        columnSettings={columnSettings}
        columns={hiddenColumns}
        empty="No hidden properties"
        onAction={onShowAll}
        onVisibilityChange={onVisibilityChange}
        title="Hidden in table"
        visible={false}
        visibleColumnsCount={visibleColumnsCount}
      />
    </div>
  );
}

function ColumnVisibilitySection({
  actionLabel,
  columnSettings,
  columns,
  empty,
  onAction,
  onVisibilityChange,
  title,
  visible,
  visibleColumnsCount,
}: {
  actionLabel: string;
  columnSettings: IdentityColumnSettings;
  columns: IdentityColumnConfig[];
  empty: string;
  onAction: () => void;
  onVisibilityChange: (columnId: IdentityColumnId, visible: boolean) => void;
  title: string;
  visible: boolean;
  visibleColumnsCount: number;
}) {
  return (
    <div className="px-1 py-1.5">
      <div className="flex h-8 items-center justify-between px-1">
        <span className="text-[13px] font-semibold text-[#78746e]">{title}</span>
        {columns.length > 0 ? (
          <button
            className="rounded-[5px] px-1.5 py-1 text-[13px] font-medium text-[#1f7ae0] hover:bg-[#edf5ff]"
            onClick={onAction}
            type="button"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {columns.length > 0 ? (
        columns.map((column) => {
          const Icon = column.Icon;

          return (
            <button
              className="grid h-9 w-full grid-cols-[24px_28px_minmax(0,1fr)_28px] items-center rounded-[7px] px-1 text-left text-[15px] text-[#37352f] hover:bg-[#efeeeb]"
              key={column.id}
              onClick={() => onVisibilityChange(column.id, !visible)}
              type="button"
            >
              <DragHandleIcon />
              <Icon className="h-4 w-4 text-[#78746e]" />
              <span className="truncate">
                {getColumnLabel(column, columnSettings)}
              </span>
              {visible ? (
                <span
                  className={
                    visibleColumnsCount <= 1
                      ? "text-[#d0ccc7]"
                      : "text-[#78746e]"
                  }
                >
                  <EyeIcon />
                </span>
              ) : (
                <span className="text-[#8f8b85]">
                  <EyeOffIcon />
                </span>
              )}
            </button>
          );
        })
      ) : (
        <div className="px-2 py-2 text-[13px] text-[#aaa7a2]">{empty}</div>
      )}
    </div>
  );
}

function NotionToolbarIconButton({
  active,
  children,
  expanded,
  label,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  expanded: boolean;
  label: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      aria-label={label}
      aria-expanded={expanded}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[#8b8781] transition-colors hover:bg-[#f1f1ef] hover:text-[#37352f] ${
        expanded ? "bg-[#efeeeb] text-[#37352f]" : ""
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
      {active ? (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#2f7cf6]" />
      ) : null}
    </button>
  );
}

function NotionControlChip({
  label,
  onRemove,
  prefix,
}: {
  label: string;
  onRemove: () => void;
  prefix?: string;
}) {
  return (
    <span className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-[#edf5ff] px-2.5 text-[15px] font-medium text-[#2f7cf6]">
      {prefix ? <span className="text-[17px] leading-none">{prefix}</span> : null}
      <span className="truncate">{label}</span>
      <button
        aria-label={`Remove ${label}`}
        className="rounded-[4px] p-0.5 text-[#6b9de8] hover:bg-[#dcecff] hover:text-[#2f7cf6]"
        onClick={onRemove}
        type="button"
      >
        <CloseIcon />
      </button>
    </span>
  );
}

function FilterBuilderPopover({
  filters,
  onAdd,
  onClear,
  onRemove,
  onUpdate,
  position,
}: {
  filters: IdentityFilterRule[];
  onAdd: (property?: IdentityFilterProperty) => void;
  onClear: () => void;
  onRemove: (id: string) => void;
  onUpdate: (
    id: string,
    updates: Partial<Omit<IdentityFilterRule, "id">>,
  ) => void;
  position: { left: number; top: number };
}) {
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const [propertyQuery, setPropertyQuery] = useState("");
  const filteredProperties = FILTER_PROPERTY_OPTIONS.filter((option) =>
    option.label.toLowerCase().includes(propertyQuery.trim().toLowerCase()),
  );

  return (
    <div
      className="fixed z-[10000] w-[352px] max-w-[calc(100vw-2rem)] rounded-[12px] border border-[#e6e4e1] bg-white p-1.5 text-[14px] text-[#2f2e2b] shadow-[0_12px_32px_rgba(15,15,15,0.18)]"
      style={{ left: position.left, top: position.top }}
    >
      <input
        autoFocus
        className="mb-1.5 h-9 w-full rounded-[8px] border-2 border-[#2f7cf6] bg-white px-2.5 text-[15px] font-normal leading-none text-[#37352f] outline-none placeholder:text-[#aaa7a2]"
        onChange={(event) => setPropertyQuery(event.target.value)}
        placeholder="Filter by..."
        value={propertyQuery}
      />
      <div className="flex flex-col gap-0.5 px-0.5">
        {filteredProperties.map((option, index) => {
          const Icon = option.Icon;

          return (
            <button
              className={`grid h-9 grid-cols-[30px_minmax(0,1fr)] items-center rounded-[7px] px-2 text-left transition-colors hover:bg-[#efeeeb] ${
                index === 0 ? "bg-[#efeeeb]" : ""
              }`}
              key={option.value}
              onClick={() => onAdd(option.value as IdentityFilterProperty)}
              type="button"
            >
              <Icon className="h-4 w-4 text-[#37352f]" />
              <span className="truncate text-[15px] font-normal tracking-normal text-[#37352f]">
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mx-2 my-1.5 h-px bg-[#e5e3df]" />
      <button
        className="flex h-9 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[15px] font-normal text-[#78746e] transition-colors hover:bg-[#f5f4f2]"
        onClick={() => onAdd("application")}
        type="button"
      >
        <PlusIcon />
        <span>Add advanced filter</span>
      </button>
      {filters.length > 0 ? (
        <div className="mt-1.5 border-t border-[#e5e3df] pt-1.5">
          <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-normal text-[#9b9892]">
            Active filters
          </div>
          <div className="flex flex-col gap-0.5">
            {filters.map((filter, index) => (
              <FilterRuleRow
                filter={filter}
                index={index}
                key={filter.id}
                onRemove={onRemove}
                onUpdate={onUpdate}
                openSelect={openSelect}
                setOpenSelect={setOpenSelect}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-end">
            <button
              className="h-7 rounded-[5px] px-2 text-[13px] text-[#9b9892] hover:bg-[#f5f4f2] hover:text-[#37352f]"
              onClick={onClear}
              type="button"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterRuleRow({
  filter,
  index,
  onRemove,
  onUpdate,
  openSelect,
  setOpenSelect,
}: {
  filter: IdentityFilterRule;
  index: number;
  onRemove: (id: string) => void;
  onUpdate: (
    id: string,
    updates: Partial<Omit<IdentityFilterRule, "id">>,
  ) => void;
  openSelect: string | null;
  setOpenSelect: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  return (
    <div className="grid min-h-8 grid-cols-[42px_108px_78px_minmax(0,1fr)_24px] items-center gap-1 rounded-[6px] px-1 py-0.5 hover:bg-[#f5f4f2]">
      <span className="px-1 text-[12px] text-[#a09d97]">
        {index === 0 ? "Where" : "And"}
      </span>
      <NotionSelect
        onChange={(value) => {
          const property = value as IdentityFilterProperty;
          onUpdate(filter.id, {
            operator: getDefaultFilterOperator(property),
            property,
            value: getDefaultFilterValue(property),
          });
        }}
        openSelect={openSelect}
        options={FILTER_PROPERTY_OPTIONS}
        selectId={`${filter.id}:property`}
        setOpenSelect={setOpenSelect}
        value={filter.property}
      />
      <NotionSelect
        onChange={(value) =>
          onUpdate(filter.id, { operator: value as IdentityFilterOperator })
        }
        openSelect={openSelect}
        options={FILTER_OPERATOR_OPTIONS[filter.property]}
        selectId={`${filter.id}:operator`}
        setOpenSelect={setOpenSelect}
        value={filter.operator}
      />
      <FilterValueControl
        filter={filter}
        onUpdate={onUpdate}
        openSelect={openSelect}
        setOpenSelect={setOpenSelect}
      />
      <button
        aria-label="Remove filter"
        className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[#b9b6b0] hover:bg-[#e9e8e5] hover:text-[#78746e]"
        onClick={() => onRemove(filter.id)}
        type="button"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function FilterValueControl({
  filter,
  onUpdate,
  openSelect,
  setOpenSelect,
}: {
  filter: IdentityFilterRule;
  onUpdate: (
    id: string,
    updates: Partial<Omit<IdentityFilterRule, "id">>,
  ) => void;
  openSelect: string | null;
  setOpenSelect: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  if (filter.property === "application") {
    return (
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          className="h-7 w-full rounded-[5px] border-0 bg-transparent pl-6 pr-1 text-[13px] text-[#37352f] outline-none placeholder:text-[#aaa7a2] focus:bg-white focus:ring-1 focus:ring-[#d8d5d0]"
          onChange={(event) =>
            onUpdate(filter.id, { value: event.target.value })
          }
          placeholder="Value"
          value={filter.value}
        />
      </div>
    );
  }

  return (
    <NotionSelect
      onChange={(value) => onUpdate(filter.id, { value })}
      openSelect={openSelect}
      options={getFilterValueOptions(filter.property)}
      selectId={`${filter.id}:value`}
      setOpenSelect={setOpenSelect}
      value={filter.value}
    />
  );
}

function SortBuilderPopover({
  onAdd,
  onClear,
  onRemove,
  onUpdate,
  position,
  sorts,
}: {
  onAdd: () => void;
  onClear: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Omit<IdentitySortRule, "id">>) => void;
  position: { left: number; top: number };
  sorts: IdentitySortRule[];
}) {
  const [openSelect, setOpenSelect] = useState<string | null>(null);

  return (
    <div
      className="fixed z-[10000] w-[352px] rounded-[12px] border border-[#e6e4e1] bg-white p-1.5 text-[13px] text-[#37352f] shadow-[0_12px_32px_rgba(15,15,15,0.18)]"
      style={{ left: position.left, top: position.top }}
    >
      <div className="px-2 py-1 text-[12px] font-medium text-[#78746e]">
        Sort
      </div>
      <div className="flex flex-col gap-0.5">
        {sorts.length > 0 ? (
          sorts.map((sort, index) => (
            <SortRuleRow
              index={index}
              key={sort.id}
              onRemove={onRemove}
              onUpdate={onUpdate}
              openSelect={openSelect}
              setOpenSelect={setOpenSelect}
              sort={sort}
            />
          ))
        ) : (
          <div className="rounded-[6px] px-2 py-2 text-[13px] text-[#aaa7a2]">
            No sorts
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-[#e5e3df] pt-1">
        <button
          className="inline-flex h-8 items-center gap-1 rounded-[6px] px-2 text-[13px] text-[#78746e] hover:bg-[#f5f4f2] hover:text-[#37352f]"
          onClick={onAdd}
          type="button"
        >
          <PlusIcon />
          <span>Add sort</span>
        </button>
        <button
          className="h-8 rounded-[6px] px-2 text-[13px] text-[#9b9892] hover:bg-[#f5f4f2] hover:text-[#37352f]"
          onClick={onClear}
          type="button"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function SortRuleRow({
  index,
  onRemove,
  onUpdate,
  openSelect,
  setOpenSelect,
  sort,
}: {
  index: number;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Omit<IdentitySortRule, "id">>) => void;
  openSelect: string | null;
  setOpenSelect: React.Dispatch<React.SetStateAction<string | null>>;
  sort: IdentitySortRule;
}) {
  return (
    <div className="grid min-h-8 grid-cols-[54px_140px_minmax(0,1fr)_24px] items-center gap-1 rounded-[6px] px-1 py-0.5 hover:bg-[#f5f4f2]">
      <span className="px-1 text-[12px] text-[#a09d97]">
        {index === 0 ? "Sort by" : "Then"}
      </span>
      <NotionSelect
        onChange={(value) =>
          onUpdate(sort.id, { field: value as IdentitySortField })
        }
        openSelect={openSelect}
        options={SORT_FIELD_OPTIONS}
        selectId={`${sort.id}:field`}
        setOpenSelect={setOpenSelect}
        value={sort.field}
      />
      <NotionSelect
        onChange={(value) =>
          onUpdate(sort.id, {
            direction: value === "asc" ? "asc" : "desc",
          })
        }
        openSelect={openSelect}
        options={[
          { label: "Ascending", value: "asc" },
          { label: "Descending", value: "desc" },
        ]}
        selectId={`${sort.id}:direction`}
        setOpenSelect={setOpenSelect}
        value={sort.direction}
      />
      <button
        aria-label="Remove sort"
        className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[#b9b6b0] hover:bg-[#e9e8e5] hover:text-[#78746e]"
        onClick={() => onRemove(sort.id)}
        type="button"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function NotionSelect({
  onChange,
  openSelect,
  options,
  selectId,
  setOpenSelect,
  value,
}: {
  onChange: (value: string) => void;
  openSelect: string | null;
  options: Array<{ label: string; value: string }>;
  selectId: string;
  setOpenSelect: React.Dispatch<React.SetStateAction<string | null>>;
  value: string;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const isOpen = openSelect === selectId;

  return (
    <div className="relative min-w-0">
      <button
        aria-expanded={isOpen}
        className="flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-[5px] px-1.5 text-left text-[13px] text-[#37352f] hover:bg-[#efeeeb]"
        onClick={() =>
          setOpenSelect((current) => (current === selectId ? null : selectId))
        }
        type="button"
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDownIcon />
      </button>
      {isOpen ? (
        <div className="absolute left-0 top-8 z-[10000] min-w-full rounded-[8px] border border-[#e6e4e1] bg-white p-1 shadow-[0_8px_24px_rgba(15,15,15,0.14)]">
          {options.map((option) => (
            <button
              className="flex h-7 w-full min-w-[150px] items-center justify-between gap-3 rounded-[5px] px-2 text-left text-[13px] text-[#37352f] hover:bg-[#efeeeb]"
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpenSelect(null);
              }}
              type="button"
            >
              <span className="truncate">{option.label}</span>
              {option.value === value ? <CheckIcon /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActiveViewChips({
  filters,
  onFiltersChange,
  onSortsChange,
  sorts,
}: {
  filters: IdentityFilterRule[];
  onFiltersChange: React.Dispatch<React.SetStateAction<IdentityFilterRule[]>>;
  onSortsChange: React.Dispatch<React.SetStateAction<IdentitySortRule[]>>;
  sorts: IdentitySortRule[];
}) {
  const filterChips = filters.flatMap((filter) => {
    const label = getFilterChipLabel(filter);

    return label ? [{ id: filter.id, label }] : [];
  });

  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {filterChips.map((chip) => (
        <ViewChip
          key={chip.id}
          label={chip.label}
          onRemove={() =>
            onFiltersChange((current) =>
              current.filter((filter) => filter.id !== chip.id),
            )
          }
        />
      ))}
      {sorts.map((sort) => (
        <ViewChip
          key={sort.id}
          label={`Sort: ${getSortFieldLabel(sort.field)} ${
            sort.direction === "asc" ? "ascending" : "descending"
          }`}
          onRemove={() =>
            onSortsChange((current) =>
              current.filter((currentSort) => currentSort.id !== sort.id),
            )
          }
        />
      ))}
    </div>
  );
}

function ViewChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-[#f1f1ef] px-2.5 text-[15px] font-medium text-[#78746e]">
      <span className="truncate">{label}</span>
      <button
        aria-label={`Remove ${label}`}
        className="rounded-[4px] p-0.5 text-[#aaa7a2] hover:bg-[#e5e3df] hover:text-[#37352f]"
        onClick={onRemove}
        type="button"
      >
        <CloseIcon />
      </button>
    </span>
  );
}

function getSortFieldLabel(field: IdentitySortField): string {
  return SORT_FIELD_OPTIONS.find((option) => option.value === field)?.label ?? field;
}

function getFilterPropertyLabel(property: IdentityFilterProperty): string {
  return (
    FILTER_PROPERTY_OPTIONS.find((option) => option.value === property)?.label ??
    property
  );
}

function getFilterValueOptions(
  property: Exclude<IdentityFilterProperty, "application">,
): Array<{ label: string; value: string }> {
  if (property === "identityMode") {
    return IDENTITY_MODE_FILTER_OPTIONS;
  }

  if (property === "confidence") {
    return CONFIDENCE_FILTER_OPTIONS;
  }

  if (property === "pricing") {
    return PRICING_FILTER_OPTIONS;
  }

  return UTILIZATION_FILTER_OPTIONS;
}

function getFilterChipLabel(filter: IdentityFilterRule): string | null {
  if (filter.property === "application") {
    const value = filter.value.trim();

    return value ? `Application contains "${value}"` : null;
  }

  return `${getFilterPropertyLabel(filter.property)} ${getFilterOperatorLabel(
    filter.operator,
  ).toLowerCase()} ${getFilterValueLabel(filter.property, filter.value)}`;
}

function getFilterOperatorLabel(operator: IdentityFilterOperator): string {
  if (operator === "is_not") {
    return "Is not";
  }

  if (operator === "contains") {
    return "Contains";
  }

  return "Is";
}

function getFilterValueLabel(
  property: Exclude<IdentityFilterProperty, "application">,
  value: string,
): string {
  return getFilterValueOptions(property).find((option) => option.value === value)?.label ?? value;
}

function getNextSortField(sorts: IdentitySortRule[]): IdentitySortField {
  const usedFields = new Set(sorts.map((sort) => sort.field));
  const option = SORT_FIELD_OPTIONS.find(
    (candidate) => !usedFields.has(candidate.value as IdentitySortField),
  );

  return (option?.value ?? "application") as IdentitySortField;
}

function getColumnLabel(
  column: IdentityColumnConfig,
  columnSettings: IdentityColumnSettings,
): string {
  const label = columnSettings[column.id]?.label.trim();

  return label || column.defaultLabel;
}

function SortIcon() {
  return <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />;
}

function FilterIcon() {
  return <ListFilter aria-hidden="true" className="h-3.5 w-3.5" />;
}

function SearchIcon({ className = "" }: { className?: string }) {
  return <Search aria-hidden="true" className={`h-3.5 w-3.5 ${className}`} />;
}

function DragHandleIcon() {
  return <GripVertical aria-hidden="true" className="h-4 w-4 text-[#b9b6b0]" />;
}

function EyeIcon() {
  return <Eye aria-hidden="true" className="h-4 w-4" />;
}

function EyeOffIcon() {
  return <EyeOff aria-hidden="true" className="h-4 w-4" />;
}

function PlusIcon() {
  return <Plus aria-hidden="true" className="h-3.5 w-3.5" />;
}

function ChevronDownIcon() {
  return (
    <ChevronDown
      aria-hidden="true"
      className="h-3 w-3 shrink-0 text-zinc-400"
    />
  );
}

function CheckIcon() {
  return (
    <Check
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 text-blue-600"
    />
  );
}

function CloseIcon() {
  return <X aria-hidden="true" className="h-3 w-3" />;
}

function UsageDashboardRow({
  columns,
  supplier,
}: {
  columns: IdentityColumnConfig[];
  supplier: IdentitySupplierRow;
}) {
  const hasSamlLoginSignals = supplier.identityMode === "saml";
  const utilization = computeUtilization(
    hasSamlLoginSignals ? supplier.usersWithSignal90d : 0,
    hasSamlLoginSignals ? supplier.paidSeats : null,
  );
  const loginFrequency = getLoginFrequency(
    supplier.usersWithSignal30d,
    supplier.usersWithSignal90d,
    supplier.usersWithSignal180d,
  );

  return (
    <tr className="bg-white">
      {columns.map((column) => (
        <IdentityDashboardCell
          columnId={column.id}
          hasSamlLoginSignals={hasSamlLoginSignals}
          key={column.id}
          loginFrequency={loginFrequency}
          supplier={supplier}
          utilization={utilization}
        />
      ))}
    </tr>
  );
}

function IdentityDashboardCell({
  columnId,
  hasSamlLoginSignals,
  loginFrequency,
  supplier,
  utilization,
}: {
  columnId: IdentityColumnId;
  hasSamlLoginSignals: boolean;
  loginFrequency: LoginFrequency;
  supplier: IdentitySupplierRow;
  utilization: ReturnType<typeof computeUtilization>;
}) {
  if (columnId === "application") {
    return (
      <td className="px-3 py-4 align-top">
        <div className="flex min-w-0 items-start gap-3">
          <ApplicationLogo
            domain={supplier.supplierDomain}
            logoUrl={supplier.logoUrl}
            supplierName={supplier.supplierName}
          />
          <div className="min-w-0">
            <Link
              className="break-words font-medium text-zinc-950 hover:underline"
              href={`/app/suppliers/${supplier.supplierId}`}
            >
              {supplier.supplierName}
            </Link>
            <div className="mt-0.5 break-all text-xs text-zinc-500">
              {supplier.supplierDomain ?? "No domain"}
            </div>
            <div className="mt-2">
              <IdentityModeBadge identityMode={supplier.identityMode} />
            </div>
          </div>
        </div>
      </td>
    );
  }

  if (columnId === "pricingType") {
    return (
      <td className="px-3 py-4 align-top text-zinc-700">
        <PricingTypeCell
          monthlySpend={supplier.monthlySpend}
          paidSeats={supplier.paidSeats}
          pricingSource={supplier.pricingSource}
        />
      </td>
    );
  }

  if (columnId === "unitPrice") {
    return (
      <td className="px-3 py-4 align-top text-zinc-700">
        <UnitPriceCell
          monthlySpend={supplier.monthlySpend}
          paidSeats={supplier.paidSeats}
        />
      </td>
    );
  }

  if (columnId === "totalPricing") {
    return (
      <td className="px-3 py-4 align-top text-zinc-700">
        <TotalPricingCell monthlySpend={supplier.monthlySpend} />
      </td>
    );
  }

  if (columnId === "lastSignalAt") {
    return (
      <td className="px-3 py-4 align-top text-zinc-700">
        {formatRelativeLastUsed(supplier.lastSignalAt)}
      </td>
    );
  }

  if (columnId === "loginUsers") {
    return (
      <td className="px-3 py-4 align-top text-zinc-700">
        {supplier.paidSeats
          ? `${supplier.usersWithSignal90d} / ${supplier.paidSeats}`
          : `${supplier.usersWithSignal90d} login users`}
      </td>
    );
  }

  if (columnId === "utilization") {
    return (
      <td className="px-3 py-4 align-top">
        <UsageProgressBar
          unavailableLabel={
            hasSamlLoginSignals ? undefined : "Needs SAML/app usage"
          }
          utilization={utilization}
        />
      </td>
    );
  }

  if (columnId === "loginFrequency") {
    return (
      <td className="px-3 py-4 align-top">
        <LoginFrequencyBar frequency={loginFrequency} />
      </td>
    );
  }

  return (
    <td className="px-3 py-4 align-top">
      <UsageConfidenceBadge confidence={supplier.confidence} />
    </td>
  );
}

function PricingTypeCell({
  monthlySpend,
  paidSeats,
  pricingSource,
}: {
  monthlySpend: number | null;
  paidSeats: number | null;
  pricingSource: IdentitySupplierRow["pricingSource"];
}) {
  if (monthlySpend === null) {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-medium text-zinc-500">Unknown</span>
        <span className="text-xs text-zinc-500">No pricing</span>
      </div>
    );
  }

  const hasSeatCount = paidSeats !== null && paidSeats > 0;

  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-zinc-950">
        {hasSeatCount ? "Per seat" : "Contract"}
      </span>
      <span className="text-xs text-zinc-500">
        {hasSeatCount ? `${paidSeats} seats` : formatPricingSource(pricingSource)}
      </span>
      {pricingSource === "shared_contract" ? (
        <span className="w-fit rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          Shared
        </span>
      ) : null}
    </div>
  );
}

function UnitPriceCell({
  monthlySpend,
  paidSeats,
}: {
  monthlySpend: number | null;
  paidSeats: number | null;
}) {
  if (monthlySpend === null) {
    return <span className="text-zinc-500">-</span>;
  }

  if (paidSeats !== null && paidSeats > 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="whitespace-nowrap font-medium text-zinc-950">
          {formatMoney(monthlySpend / paidSeats)}
        </span>
        <span className="whitespace-nowrap text-xs text-zinc-500">
          / seat / mo
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="whitespace-nowrap font-medium text-zinc-950">
        {formatMoney(monthlySpend)}
      </span>
      <span className="whitespace-nowrap text-xs text-zinc-500">
        / contract / mo
      </span>
    </div>
  );
}

function TotalPricingCell({ monthlySpend }: { monthlySpend: number | null }) {
  if (monthlySpend === null) {
    return <span className="text-zinc-500">-</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="whitespace-nowrap font-medium text-zinc-950">
        {formatMoney(monthlySpend)}
        <span className="font-normal text-zinc-500"> / mo</span>
      </span>
      <span className="whitespace-nowrap text-xs text-zinc-500">
        {formatMoney(monthlySpend * 12)} / yr
      </span>
    </div>
  );
}

function formatPricingSource(
  pricingSource: IdentitySupplierRow["pricingSource"],
): string {
  if (pricingSource === "contract") {
    return "Linked contract";
  }

  if (pricingSource === "shared_contract") {
    return "Shared contract";
  }

  if (pricingSource === "supplier") {
    return "Supplier spend";
  }

  return "Pricing source";
}

function ApplicationLogo({
  domain,
  logoUrl,
  supplierName,
}: {
  domain: string | null;
  logoUrl: string | null;
  supplierName: string;
}) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const displayLogoUrl = logoUrl ?? buildLogoUrl(domain);

  if (displayLogoUrl && failedLogoUrl !== displayLogoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${supplierName} logo`}
        className="h-10 w-10 shrink-0 rounded-md bg-white object-contain"
        height={40}
        onError={() => setFailedLogoUrl(displayLogoUrl)}
        src={displayLogoUrl}
        width={40}
      />
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-600">
      {supplierName.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function IdentityModeBadge({
  identityMode,
}: {
  identityMode: IdentitySupplierRow["identityMode"];
}) {
  const className =
    identityMode === "saml"
      ? "bg-indigo-50 text-indigo-700"
      : identityMode === "oauth"
        ? "bg-blue-50 text-blue-700"
        : identityMode === "authorized_app"
          ? "bg-cyan-50 text-cyan-700"
          : "bg-zinc-100 text-zinc-600";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {formatEnum(identityMode)}
    </span>
  );
}

export function UsageProgressBar({
  unavailableLabel = "Needs seat data",
  utilization,
}: {
  unavailableLabel?: string;
  utilization: ReturnType<typeof computeUtilization>;
}) {
  const status = getUtilizationStatus(utilization.utilization);

  if (status === "needs_seat_data" || utilization.percentage === null) {
    return (
      <span className="block max-w-full break-words text-sm text-zinc-500">
        {unavailableLabel}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="h-2 rounded-full bg-zinc-100">
        <div
          className={`h-2 rounded-full ${getUtilizationBarClassName(status)}`}
          style={{ width: `${Math.min(utilization.percentage, 100)}%` }}
        />
      </div>
      <span className={`text-xs font-medium ${getUtilizationTextClassName(status)}`}>
        {formatUtilizationLabel(utilization.percentage, status)}
      </span>
    </div>
  );
}

export function LoginFrequencyBar({
  frequency,
}: {
  frequency: LoginFrequency;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="flex shrink-0 gap-0.5">
        {[0, 1, 2].map((index) => (
          <span
            className={`h-2 w-4 rounded-full ${getLoginFrequencySegmentClassName(
              frequency,
              index,
            )}`}
            key={index}
          />
        ))}
      </div>
      <span className={`text-xs font-medium ${getLoginFrequencyTextClassName(frequency)}`}>
        {formatEnum(frequency)}
      </span>
    </div>
  );
}

export function SupplierIdentitySignalBadge({
  visibleViaGoogle,
}: {
  visibleViaGoogle: boolean;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        visibleViaGoogle
          ? "bg-emerald-50 text-emerald-700"
          : "bg-zinc-100 text-zinc-600"
      }`}
    >
      {visibleViaGoogle
        ? "Visible via Google"
        : "No recent Google identity signal"}
    </span>
  );
}

export function UsageConfidenceBadge({
  confidence,
}: {
  confidence: IdentitySupplierRow["confidence"];
}) {
  const className =
    confidence === "high"
      ? "bg-emerald-50 text-emerald-700"
      : confidence === "medium"
        ? "bg-blue-50 text-blue-700"
        : confidence === "low"
          ? "bg-amber-50 text-amber-700"
          : "bg-zinc-100 text-zinc-600";

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {formatEnum(confidence)}
    </span>
  );
}

function PermissionList({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
      <ul className="mt-3 flex flex-col gap-2 text-sm text-zinc-700">
        {items.map((item) => (
          <li className="flex gap-2" key={item}>
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-zinc-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusPill({ status }: { status: GoogleFrontendStatus }) {
  const className =
    status === "connected"
      ? "bg-emerald-50 text-emerald-700"
      : status === "syncing"
        ? "bg-blue-50 text-blue-700"
        : status === "error"
          ? "bg-red-50 text-red-700"
          : "bg-zinc-100 text-zinc-600";

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {formatEnum(status)}
    </span>
  );
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt>
      <dd className="mt-1 font-medium text-zinc-950">{value}</dd>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-zinc-950">{value}</div>
    </div>
  );
}

function getDashboardMetrics(data: IdentitySignalsData) {
  const utilizationMetrics = data.suppliers.map((supplier) =>
    supplier.identityMode === "saml"
      ? computeUtilization(supplier.usersWithSignal90d, supplier.paidSeats)
      : computeUtilization(0, null),
  );

  return {
    appsDiscovered:
      data.summary.oauthAppsDiscovered +
      data.summary.samlAppsDiscovered +
      data.summary.authorizedAppsDiscovered,
    estimatedWastedSeats: utilizationMetrics.reduce(
      (total, metric) => total + (metric.wastedSeats ?? 0),
      0,
    ),
    needsAppUsage: data.suppliers.filter(
      (supplier) => supplier.identityMode !== "saml",
    ).length,
    underutilizedApps: utilizationMetrics.filter(
      (metric) => metric.utilization !== null && metric.utilization < 0.5,
    ).length,
  };
}

function formatUtilizationLabel(
  percentage: number,
  status: UtilizationStatus,
): string {
  if (status === "overutilized") {
    return `${percentage}% Overutilized`;
  }

  if (status === "underutilized" || status === "severe_underutilized") {
    return `${percentage}% Underutilized`;
  }

  return `${percentage}% Utilized`;
}

function getUtilizationBarClassName(status: UtilizationStatus): string {
  if (status === "overutilized") {
    return "bg-violet-500";
  }

  if (status === "healthy") {
    return "bg-emerald-500";
  }

  if (status === "moderate" || status === "underutilized") {
    return "bg-amber-500";
  }

  return "bg-red-500";
}

function getUtilizationTextClassName(status: UtilizationStatus): string {
  if (status === "overutilized") {
    return "text-violet-700";
  }

  if (status === "healthy") {
    return "text-emerald-700";
  }

  if (status === "moderate" || status === "underutilized") {
    return "text-amber-700";
  }

  return "text-red-700";
}

function getLoginFrequencySegmentClassName(
  frequency: LoginFrequency,
  index: number,
): string {
  const activeSegments = frequency === "high" ? 3 : frequency === "average" ? 2 : 1;

  if (index >= activeSegments) {
    return "bg-zinc-200";
  }

  return frequency === "high"
    ? "bg-emerald-500"
    : frequency === "average"
      ? "bg-amber-500"
      : "bg-red-500";
}

function getLoginFrequencyTextClassName(frequency: LoginFrequency): string {
  if (frequency === "high") {
    return "text-emerald-700";
  }

  if (frequency === "average") {
    return "text-amber-700";
  }

  return "text-red-700";
}

function EmptyState({
  action,
  suggestions,
  title,
}: {
  action?: React.ReactNode;
  suggestions?: string[];
  title: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex max-w-3xl flex-col gap-4">
        <p className="text-sm leading-6 text-zinc-700">{title}</p>
        {suggestions?.length ? (
          <ul className="flex flex-col gap-2 text-sm text-zinc-600">
            {suggestions.map((suggestion) => (
              <li className="flex gap-2" key={suggestion}>
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-zinc-400" />
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {action ? <div>{action}</div> : null}
      </div>
    </section>
  );
}

function formatNullableDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "EUR",
    style: "currency",
  }).format(value);
}

function formatEnum(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
