import { connection } from "next/server";
import Link from "next/link";
import { AppShell } from "@/app/app/_components/app-shell";
import { ContractReviewActions } from "@/app/app/contracts/_components/contract-review-actions";
import { ContractsPipeline } from "@/app/app/contracts/_components/contracts-pipeline";
import { SyncPennylaneButton } from "@/app/app/contracts/_components/sync-pennylane-button";
import {
  loadCachedContractGaps,
  loadCachedContracts,
  loadCachedPennylaneStatus,
} from "@/lib/frontend-cache";
import {
  buildContractSummary,
  getUsageContext,
  type ContractRow,
  type ContractGapRow,
} from "@/lib/contracts/frontendData";
import { getIntegrationRequestContext } from "@/lib/integrations/context";

export default async function ContractsPage() {
  await connection();

  const { organizationId } = await getIntegrationRequestContext();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const [contracts, gaps, pennylaneStatus] = await Promise.all([
    loadCachedContracts({ organizationId }),
    loadCachedContractGaps({ organizationId }),
    loadCachedPennylaneStatus({ organizationId }),
  ]);
  const matchedContracts = contracts.filter((contract) => contract.linkedSsoAppName);
  const visibleGaps = { ...gaps, orphanContracts: [] };
  const reviewRows = gaps.possibleMatches;
  const pipelineReviewRows = [...reviewRows, ...gaps.usageReviewContracts];
  const pipelineItems = buildPipelineItems({
    contracts: matchedContracts,
    reviewRows: pipelineReviewRows,
    today: todayIso,
  });
  const summary = buildContractSummary({
    contracts: matchedContracts,
    gaps: visibleGaps,
    today: todayIso,
  });

  return (
    <AppShell
      eyebrow="Contracts"
      helper="Pennylane gives us what is paid and renewed. Google Workspace gives us identity visibility. This view joins both signals without claiming app-level usage."
      title="Contracts / Renewals"
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label="Active contracts"
          value={String(summary.activeContracts)}
        />
        <SummaryCard
          label="Renewals next 90d"
          value={String(summary.renewalsNext90Days)}
        />
        <SummaryCard
          label="Needs review"
          value={String(summary.needsReview)}
        />
        <SummaryCard
          label="Missing contracts"
          value={String(summary.missingContracts)}
        />
        <SummaryCard
          label="Estimated monthly spend"
          value={formatMoney(summary.estimatedMonthlySpendCents, "EUR")}
        />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">
              Pennylane sync
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Runtime database: {pennylaneStatus.invoicesSynced} invoice
              {pennylaneStatus.invoicesSynced === 1 ? "" : "s"} synced,{" "}
              {pennylaneStatus.contractsInferred} contract
              {pennylaneStatus.contractsInferred === 1 ? "" : "s"} inferred.
              {pennylaneStatus.lastSyncCompletedAt
                ? ` Last completed ${formatNullableDateTime(
                    pennylaneStatus.lastSyncCompletedAt,
                  )}.`
                : ""}
            </p>
          </div>
          <SyncPennylaneButton disabled={pennylaneStatus.status === "syncing"} />
        </div>
      </section>

      <MatchedContractsTable
        contracts={contracts}
        matchedContractsCount={matchedContracts.length}
      />

      <ContractsPipeline renewals={pipelineItems} />

      <section className="grid gap-6 xl:grid-cols-2">
        <GapTable
          empty="No SSO apps missing contracts right now."
          minimal
          rows={gaps.missingContracts}
          title="Missing contracts"
        />
        <GapTable
          empty="No contract matches need review right now."
          rows={pipelineReviewRows}
          title="Needs review"
        />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-600 shadow-sm">
        Contracts are only shown when Pennylane data can be linked back to an app
        already visible through Google Workspace. Generic expenses and unmatched
        supplier invoices are kept out of the review flow.
      </section>
    </AppShell>
  );
}

type PipelineItem = ContractRow & {
  dateLabel?: string;
  monthKey?: string;
  timelineDate?: string | null;
};

function buildPipelineItems({
  contracts,
  reviewRows,
  today,
}: {
  contracts: ContractRow[];
  reviewRows: ContractGapRow[];
  today: string;
}): PipelineItem[] {
  const itemByContractId = new Map<string, PipelineItem>(
    contracts.map((contract) => [contract.contractId, contract]),
  );
  const contractById = new Map(
    contracts.map((contract) => [contract.contractId, contract]),
  );

  for (const row of reviewRows) {
    if (!row.contractId || itemByContractId.has(row.contractId)) {
      continue;
    }

    const contract = contractById.get(row.contractId);

    if (!contract) {
      continue;
    }

    itemByContractId.set(row.contractId, {
      ...contract,
      dateLabel: buildPipelineReviewDateLabel(contract.nextRenewalDate),
      timelineDate: contract.nextRenewalDate ?? today,
    });
  }

  return Array.from(itemByContractId.values());
}

function MatchedContractsTable({
  contracts,
  matchedContractsCount,
}: {
  contracts: ContractRow[];
  matchedContractsCount: number;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">
              Pennylane contracts
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {matchedContractsCount} matched to Google-visible apps out of{" "}
              {contracts.length} Pennylane contract
              {contracts.length === 1 ? "" : "s"}.
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
            Runtime count: {contracts.length}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          SSO matching is shown as metadata; the contract list itself is not hidden by
          identity signals.
        </p>
      </div>
      <div className="divide-y divide-zinc-100">
        {contracts.length > 0 ? (
          contracts.map((contract) => (
            <Link
              className="grid gap-3 px-5 py-4 text-sm transition hover:bg-zinc-50 md:grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))] md:items-center"
              href={`/app/contracts/${contract.contractId}`}
              key={contract.contractId}
            >
              <div className="flex min-w-0 items-center gap-3">
                <GapLogo logoUrl={contract.logoUrl} name={contract.vendorName} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-950">
                    {contract.vendorName}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {contract.linkedSsoAppName ?? "No Google app match"}
                  </p>
                </div>
              </div>
              <TableMetric label="Next" value={formatNullableDate(contract.nextRenewalDate)} />
              <TableMetric label="Frequency" value={formatEnum(contract.billingFrequency)} />
              <TableMetric
                label="Amount"
                value={formatMoney(
                  contract.recurringAmountCents ?? contract.lastInvoiceAmountCents,
                  contract.currency,
                )}
              />
              <TableMetric label="Status" value={formatEnum(contract.status)} />
              <TableMetric
                label="SSO match"
                value={contract.linkedSsoAppName ? "Matched" : "Not matched"}
              />
            </Link>
          ))
        ) : (
          <EmptyState value="No Pennylane contracts are currently available." />
        )}
      </div>
    </section>
  );
}

function TableMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase text-zinc-400 md:hidden">
        {label}
      </p>
      <p className="truncate text-zinc-700">{value}</p>
    </div>
  );
}

function buildPipelineReviewDateLabel(value: string | null): string {
  if (!value) {
    return "Renewal date needs review";
  }

  return formatNullableDate(value);
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

function GapTable({
  empty,
  minimal = false,
  rows,
  title,
}: {
  empty: string;
  minimal?: boolean;
  rows: ContractGapRow[];
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
      </div>
      <div className="divide-y divide-zinc-100">
        {rows.length > 0 ? (
          rows.slice(0, 8).map((row) => (
            <div className="grid gap-4 px-5 py-4 text-sm" key={row.linkId}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <GapLogo
                    logoUrl={row.logoUrl}
                    name={row.vendorName ?? row.appName}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-950">
                      {row.vendorName ?? row.appName}
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      {row.appDomain ?? row.appName}
                    </p>
                  </div>
                </div>
                <span
                  className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${getGapStatusClassName(row)}`}
                >
                  {row.contractStatus === "possibly_cancelled"
                    ? "Possible cancellation"
                    : formatEnum(row.matchStatus)}
                </span>
              </div>
              {!minimal ? (
                <p className="leading-6 text-zinc-600">
                  {getCompactReviewReason(row)}
                </p>
              ) : null}
              {!minimal ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <ReviewMetric
                      label="Users 90d"
                      value={String(row.usersWithSignal90d)}
                    />
                    <ReviewMetric label="Usage" value={getUsageContext(row)} />
                    <ReviewMetric
                      label="Match"
                      value={`${Math.round(row.matchScore * 100)}%`}
                    />
                  </div>
                  <ContractReviewActions
                    contractId={row.contractId}
                    linkId={row.linkId}
                    matchScore={row.matchScore}
                    reviewKind={getReviewActionKind(row)}
                  />
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500">
                  <span>{row.usersWithSignal90d} users 90d</span>
                  {row.matchScore > 0 ? (
                    <span>{Math.round(row.matchScore * 100)}% match</span>
                  ) : null}
                  <ContractReviewActions
                    contractId={row.contractId}
                    linkId={row.linkId}
                    matchScore={row.matchScore}
                    reviewKind={getReviewActionKind(row)}
                  />
                </div>
              )}
            </div>
          ))
        ) : (
          <EmptyState value={empty} />
        )}
      </div>
    </section>
  );
}

function ReviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase text-zinc-400">{label}</p>
      <p className="mt-1 truncate text-xs font-medium text-zinc-700">{value}</p>
    </div>
  );
}

function getReviewActionKind(
  row: ContractGapRow,
): "missing_contract" | "possible_cancellation" | "possible_match" {
  if (row.contractStatus === "possibly_cancelled") {
    return "possible_cancellation";
  }

  if (row.matchStatus === "missing_contract") {
    return "missing_contract";
  }

  return "possible_match";
}

function getGapStatusClassName(row: ContractGapRow): string {
  if (row.contractStatus === "possibly_cancelled") {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  }

  if (row.matchStatus === "missing_contract") {
    return "bg-red-50 text-red-700 ring-1 ring-red-200";
  }

  if (row.matchStatus === "matched") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  }

  return "bg-zinc-100 text-zinc-600";
}

function getCompactReviewReason(row: ContractGapRow): string {
  if (row.contractStatus === "possibly_cancelled") {
    return compactPossibleCancellationReason(row.matchReason);
  }

  if (row.matchStatus === "missing_contract") {
    return "Google identity signal found, but no Pennylane contract is linked.";
  }

  return row.matchReason;
}

function compactPossibleCancellationReason(reason: string): string {
  const expectedDate = reason.match(/around (\d{4}-\d{2}-\d{2})/)?.[1];
  const lastInvoiceDate = reason.match(/Last invoice was (\d{4}-\d{2}-\d{2})/)?.[1];

  if (!expectedDate && !lastInvoiceDate) {
    return reason;
  }

  return [
    lastInvoiceDate ? `Last invoice ${formatNullableDate(lastInvoiceDate)}.` : null,
    expectedDate ? `Expected next invoice ${formatNullableDate(expectedDate)}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function GapLogo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-white">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Logo.dev handles remote logo fallback monograms through query parameters.
        <img
          alt={`${name} logo`}
          className="h-8 w-8 object-contain"
          height="32"
          src={logoUrl}
          width="32"
        />
      ) : (
        <span className="text-xs font-semibold text-zinc-500">
          {getInitials(name)}
        </span>
      )}
    </div>
  );
}

function getInitials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function EmptyState({ value }: { value: string }) {
  return <div className="px-5 py-6 text-sm text-zinc-500">{value}</div>;
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

function formatEnum(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
