import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/app/app/_components/app-shell";
import {
  SupplierIdentitySignalBadge,
  UsageConfidenceBadge,
} from "@/app/app/_components/google-workspace";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import {
  loadIdentitySignals,
  loadSupplierIdentityLogs,
  loadSupplierInventory,
} from "@/lib/integrations/google/frontendData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  await connection();

  const { supplierId } = await params;
  const { organizationId } = await getIntegrationRequestContext();
  const supabaseAdmin = createSupabaseAdminClient();
  const [suppliers, identitySignals] = await Promise.all([
    loadSupplierInventory({ organizationId, supabaseAdmin }),
    loadIdentitySignals({ organizationId, supabaseAdmin }),
  ]);
  const supplier = suppliers.find((row) => row.supplierId === supplierId);

  if (!supplier) {
    notFound();
  }

  const signal = identitySignals.suppliers.find(
    (row) => row.supplierId === supplierId,
  );
  const identityLogs = await loadSupplierIdentityLogs({
    organizationId,
    supplier,
    supabaseAdmin,
  });

  return (
    <AppShell
      eyebrow="Supplier"
      helper={supplier.supplierDomain ?? undefined}
      title={supplier.supplierName}
    >
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <MetadataItem label="Identity source" value="Google Workspace" />
          <MetadataItem label="Identity mode" value={formatEnum(supplier.identityMode)} />
          <MetadataItem
            label="Usage data status"
            value={supplier.usageDataStatus}
          />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-zinc-950">
              Google identity signals
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-zinc-600">
              Google confirms identity visibility, not product usage. To
              quantify real usage, connect the app-specific API.
            </p>
          </div>

          {signal ? (
            <>
              <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Visible via Google
                  </dt>
                  <dd className="mt-2">
                    <SupplierIdentitySignalBadge
                      visibleViaGoogle={signal.visibleViaGoogle}
                    />
                  </dd>
                </div>
                <MetadataItem
                  label="Identity mode"
                  value={formatEnum(signal.identityMode)}
                />
                <MetadataItem
                  label="Users 30d"
                  value={String(signal.usersWithSignal30d)}
                />
                <MetadataItem
                  label="Users 90d"
                  value={String(signal.usersWithSignal90d)}
                />
                <MetadataItem
                  label="Users 180d"
                  value={String(signal.usersWithSignal180d)}
                />
                <MetadataItem
                  label="Last signal"
                  value={formatNullableDate(signal.lastSignalAt)}
                />
                <MetadataItem
                  label="Suspended users with signal"
                  value={String(signal.suspendedUsersWithSignal)}
                />
                <div>
                  <dt className="text-xs font-medium uppercase text-zinc-500">
                    Confidence
                  </dt>
                  <dd className="mt-2">
                    <UsageConfidenceBadge confidence={signal.confidence} />
                  </dd>
                </div>
              </div>

              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
                <h3 className="text-sm font-semibold text-zinc-950">
                  Interpretation
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-700">
                  {signal.visibleViaGoogle
                    ? "Google confirms this supplier is visible through OAuth/SAML signals. This is not product usage. To quantify real usage, connect the app-specific API."
                    : "No recent Google identity signal was found for this supplier. Validate with app-level usage data before making decisions."}
                </p>
                <h3 className="mt-4 text-sm font-semibold text-zinc-950">
                  Recommended next step
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-700">
                  {signal.recommendedNextAction}
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
              No Google identity signal has been computed for this supplier yet.
              <Link className="ml-1 font-medium underline" href="/app/usage/identity">
                View the identity dashboard.
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">
            Google event details
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">
            Normalized OAuth, SAML, and authorized app signals matched to this
            supplier. Raw Google event payloads stay hidden by default.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1160px] border-collapse text-left text-sm">
            <thead className="bg-zinc-100 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-semibold">User email</th>
                <th className="px-5 py-3 font-semibold">Source</th>
                <th className="px-5 py-3 font-semibold">App</th>
                <th className="px-5 py-3 font-semibold">Connection/event</th>
                <th className="px-5 py-3 font-semibold">Date</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">OAuth client</th>
                <th className="px-5 py-3 font-semibold">Scopes</th>
                <th className="px-5 py-3 text-right font-semibold">Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {identityLogs.length > 0 ? (
                identityLogs.map((log) => (
                  <tr className="bg-white" key={log.id}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-zinc-950">
                        {log.userEmail ?? "-"}
                      </div>
                      {log.suspendedUser ? (
                        <div className="mt-1 text-xs font-medium text-red-700">
                          Suspended Google user
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-zinc-700">
                      {formatEnum(log.source)}
                    </td>
                    <td className="px-5 py-3 text-zinc-700">{log.appName}</td>
                    <td className="px-5 py-3 text-zinc-700">
                      {formatEnum(log.eventName)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-zinc-700">
                      {formatNullableDate(log.eventTime)}
                    </td>
                    <td className="px-5 py-3 text-zinc-700">
                      {formatLogStatus(log)}
                    </td>
                    <td className="max-w-[180px] truncate px-5 py-3 font-mono text-xs text-zinc-600">
                      {log.oauthClientId ?? "-"}
                    </td>
                    <td className="max-w-[260px] px-5 py-3 text-xs text-zinc-600">
                      {formatScopes(log.scopes)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-zinc-700">
                      {Math.round(log.matchConfidence * 100)}%{" "}
                      <span className="text-xs text-zinc-500">
                        {formatEnum(log.matchSource)}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-5 py-6 text-center text-zinc-500" colSpan={9}>
                    No matched Google event details for this supplier yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
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

function formatNullableDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatEnum(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatScopes(scopes: string[]): string {
  if (scopes.length === 0) {
    return "-";
  }

  const visibleScopes = scopes.slice(0, 2).map((scope) =>
    scope.replace("https://www.googleapis.com/auth/", ""),
  );
  const suffix = scopes.length > visibleScopes.length
    ? ` +${scopes.length - visibleScopes.length}`
    : "";

  return `${visibleScopes.join(", ")}${suffix}`;
}

function formatLogStatus(log: {
  source: string;
  success: boolean | null;
  usersCount: number | null;
}): string {
  if (log.source === "authorized_app") {
    return log.usersCount === null ? "-" : `${log.usersCount} users`;
  }

  if (log.success === null) {
    return "-";
  }

  return log.success ? "Success" : "Failure";
}
