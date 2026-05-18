import { addDays, subDays } from "date-fns";
import { connection } from "next/server";
import { AppShell } from "@/app/app/_components/app-shell";
import { ContractsPipeline } from "@/app/app/contracts/_components/contracts-pipeline";
import {
  buildContractSummary,
  getContractRecommendedAction,
  getUsageContext,
  loadContractGaps,
  loadContracts,
  loadRenewals,
  type ContractRow,
  type ContractGapRow,
  type RenewalRow,
} from "@/lib/contracts/frontendData";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function ContractsPage() {
  await connection();

  const { organizationId } = await getIntegrationRequestContext();
  const supabaseAdmin = createSupabaseAdminClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const from = subDays(today, 28).toISOString().slice(0, 10);
  const to = addDays(today, 119).toISOString().slice(0, 10);
  const [contracts, gaps, renewals] = await Promise.all([
    loadContracts({ organizationId, supabaseAdmin }),
    loadContractGaps({ organizationId, supabaseAdmin }),
    loadRenewals({ from, organizationId, supabaseAdmin, to }),
  ]);
  const reviewRows = [...gaps.possibleMatches, ...gaps.orphanContracts];
  const pipelineReviewRows = [...reviewRows, ...gaps.usageReviewContracts];
  const pipelineItems = buildPipelineItems({
    contracts,
    renewals,
    reviewRows: pipelineReviewRows,
    today: todayIso,
  });
  const summary = buildContractSummary({ contracts, gaps, today: todayIso });

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
  renewals,
  reviewRows,
  today,
}: {
  contracts: ContractRow[];
  renewals: RenewalRow[];
  reviewRows: ContractGapRow[];
  today: string;
}): PipelineItem[] {
  const itemByContractId = new Map<string, PipelineItem>(
    renewals.map((renewal) => [renewal.contractId, renewal]),
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
            <div className="grid gap-3 px-5 py-4 text-sm" key={row.linkId}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
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
                <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
                  {row.contractStatus === "possibly_cancelled"
                    ? "Possible cancellation"
                    : formatEnum(row.matchStatus)}
                </span>
              </div>
              {!minimal ? (
                <p className="leading-6 text-zinc-600">{row.matchReason}</p>
              ) : null}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span>{row.usersWithSignal90d} users 90d</span>
                {!minimal ? <span>{getUsageContext(row)}</span> : null}
                {!minimal || row.matchScore > 0 ? (
                  <span>{Math.round(row.matchScore * 100)}% match</span>
                ) : null}
              </div>
              {!minimal ? (
                <p className="text-sm font-medium text-zinc-700">
                  {getContractRecommendedAction(row)}
                </p>
              ) : null}
            </div>
          ))
        ) : (
          <EmptyState value={empty} />
        )}
      </div>
    </section>
  );
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

function formatEnum(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
