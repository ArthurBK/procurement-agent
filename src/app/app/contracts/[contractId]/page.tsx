import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/app/app/_components/app-shell";
import { loadCachedContractDetail } from "@/lib/frontend-cache";
import type { ContractDetail } from "@/lib/contracts/frontendData";
import { getIntegrationRequestContext } from "@/lib/integrations/context";

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  await connection();

  const { contractId } = await params;
  const { organizationId } = await getIntegrationRequestContext();
  const contract = await loadCachedContractDetail({
    contractId,
    organizationId,
  });

  if (!contract) {
    notFound();
  }

  return (
    <AppShell
      eyebrow="Contract"
      helper={contract.linkedSsoAppName ?? contract.sourceSystem}
      title={contract.vendorName}
    >
      <div>
        <Link
          className="text-sm font-medium text-zinc-600 hover:text-zinc-950 hover:underline"
          href="/app/contracts"
        >
          Back to contracts
        </Link>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <ContractLogo contract={contract} />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-zinc-950">
                {contract.vendorName}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                {[contract.productName, contract.planName].filter(Boolean).join(", ") ||
                  "Contract"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{formatEnum(contract.status)}</Badge>
            <Badge>{formatEnum(contract.billingFrequency)}</Badge>
            <Badge>{formatEnum(contract.confidence)} confidence</Badge>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Next renewal"
          value={formatNullableDate(contract.nextRenewalDate)}
        />
        <MetricCard
          label="Recurring amount"
          value={formatMoney(contract.recurringAmountCents, contract.currency)}
        />
        <MetricCard
          label="Last invoice"
          value={formatMoney(contract.lastInvoiceAmountCents, contract.currency)}
        />
        <MetricCard
          label="Seats"
          value={formatNullableNumber(contract.seats ?? contract.quantity)}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <DetailCard title="Contract terms">
          <MetadataGrid
            items={[
              ["Current period start", formatNullableDate(contract.currentPeriodStart)],
              ["Current period end", formatNullableDate(contract.currentPeriodEnd)],
              ["Cancellation deadline", formatNullableDate(contract.cancellationDeadline)],
              [
                "Notice period",
                contract.noticePeriodDays === null
                  ? "-"
                  : `${contract.noticePeriodDays} days`,
              ],
              ["Auto-renew", formatBoolean(contract.autoRenew)],
              ["Owner", contract.ownerEmail ?? "-"],
              ["Source", formatEnum(contract.sourceSystem)],
              ["Source external ID", contract.sourceExternalId ?? "-"],
            ]}
          />
        </DetailCard>

        <DetailCard title="SSO match">
          {contract.appLink ? (
            <MetadataGrid
              items={[
                ["App", contract.appLink.matchedAppName ?? "-"],
                ["Domain", contract.appLink.matchedAppDomain ?? "-"],
                ["Status", formatEnum(contract.appLink.matchStatus)],
                ["Score", `${Math.round(contract.appLink.matchScore * 100)}%`],
                ["Matched by", formatEnum(contract.appLink.matchedBy)],
                ["Reason", contract.appLink.matchReason],
              ]}
            />
          ) : (
            <p className="text-sm text-zinc-500">No SSO app is linked yet.</p>
          )}
        </DetailCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <DetailCard title="Pennylane invoice">
          {contract.sourceInvoice ? (
            <MetadataGrid
              items={[
                ["Supplier", contract.sourceInvoice.supplierName],
                ["Invoice number", contract.sourceInvoice.invoiceNumber ?? "-"],
                ["Invoice date", formatNullableDate(contract.sourceInvoice.invoiceDate)],
                ["Due date", formatNullableDate(contract.sourceInvoice.dueDate)],
                [
                  "Amount excl. tax",
                  formatMoney(
                    contract.sourceInvoice.amountExcludingTaxCents,
                    contract.sourceInvoice.currency,
                  ),
                ],
                [
                  "Amount",
                  formatMoney(
                    contract.sourceInvoice.amountCents,
                    contract.sourceInvoice.currency,
                  ),
                ],
                ["Paid", formatBoolean(contract.sourceInvoice.isPaid)],
                ["Label", contract.sourceInvoice.label ?? "-"],
              ]}
            />
          ) : (
            <p className="text-sm text-zinc-500">
              No Pennylane invoice is attached to this contract.
            </p>
          )}
        </DetailCard>

        <DetailCard title="Extraction">
          <p className="text-sm leading-6 text-zinc-700">
            {contract.confidenceReason}
          </p>
          {contract.aiAssisted ? (
            <Badge className="mt-4">AI assisted extraction</Badge>
          ) : null}
          <p className="mt-4 text-xs text-zinc-500">
            Last synced: {formatNullableDateTime(contract.lastSyncedAt)}
          </p>
        </DetailCard>
      </section>
    </AppShell>
  );
}

function ContractLogo({ contract }: { contract: ContractDetail }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {contract.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${contract.vendorName} logo`}
          className="h-10 w-10 object-contain"
          height={40}
          src={contract.logoUrl}
          width={40}
        />
      ) : (
        <span className="text-sm font-semibold text-zinc-500">
          {contract.vendorName.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </div>
  );
}

function DetailCard({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

function MetadataGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt>
          <dd className="mt-1 break-words text-zinc-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Badge({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 ${className}`}
    >
      {children}
    </span>
  );
}

function formatMoney(valueCents: number | null, currency: string): string {
  if (valueCents === null) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    currency,
    style: "currency",
  }).format(valueCents / 100);
}

function formatNullableDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatNullableDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "-" : new Intl.NumberFormat("en-US").format(value);
}

function formatBoolean(value: boolean | null): string {
  if (value === null) {
    return "-";
  }

  return value ? "Yes" : "No";
}

function formatEnum(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
