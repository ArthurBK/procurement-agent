"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatAmountCents } from "@/lib/imports/formatAmount";
import type { LogoSource } from "@/lib/suppliers/types";

type BusinessCategory =
  | "software"
  | "cloud"
  | "ai"
  | "telecom"
  | "banking"
  | "workspace"
  | "professional_service"
  | "marketing"
  | "food"
  | "transport"
  | "travel"
  | "retail"
  | "income"
  | "unknown";

type Frequency = "weekly" | "monthly" | "quarterly" | "annually" | "unknown";
type BillingModel = "fixed" | "variable" | "unknown";
type ReviewBucket = "auto_accepted" | "needs_review" | "auto_ignored";
type ReviewTab = ReviewBucket | "all";
type UserDecision = "confirmed" | "ignored" | null;
type SupplierRuleDecision = "auto_subscription" | "excluded";

export type RecurringCandidateRow = {
  id: string;
  supplier: string;
  supplier_key: string;
  business_category: BusinessCategory;
  system_decision: "auto_subscription" | "needs_review" | "excluded";
  user_decision: UserDecision;
  review_bucket: ReviewBucket;
  decision_source: string | null;
  decision_reason: string | null;
  frequency: Frequency;
  billing_model: BillingModel;
  amount_cents: number;
  currency: string;
  next_payment: string | null;
  payment_method: string | null;
  recurrence_confidence: number;
  classification_confidence: number;
  evidence: Record<string, unknown>;
  corrected_supplier: string | null;
  corrected_frequency: Frequency | null;
  corrected_amount_cents: number | null;
  corrected_currency: string | null;
  corrected_next_payment: string | null;
  corrected_payment_method: string | null;
  corrected_billing_model: BillingModel | null;
  corrected_business_category: BusinessCategory | null;
  review_notes: string | null;
};

export type SupplierProfileRow = {
  id: string;
  supplier_key: string;
  display_name: string;
  domain: string | null;
  logo_url: string | null;
  logo_source: LogoSource;
};

type CandidateSummary = {
  all: number;
  autoAccepted: number;
  autoIgnored: number;
  needsReview: number;
};

const TABS: { id: ReviewTab; label: string }[] = [
  { id: "needs_review", label: "Needs review" },
  { id: "auto_accepted", label: "Auto-accepted" },
  { id: "auto_ignored", label: "Auto-ignored" },
  { id: "all", label: "All" },
];

export function RecurringCandidatesReview({
  candidates,
  importId,
  supplierProfiles,
}: {
  candidates: RecurringCandidateRow[];
  importId: string;
  supplierProfiles: SupplierProfileRow[];
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ReviewTab>("needs_review");
  const [pendingCandidateId, setPendingCandidateId] = useState<string | null>(
    null,
  );
  const [rememberedCandidateIds, setRememberedCandidateIds] = useState<
    Record<string, boolean>
  >({});
  const [error, setError] = useState<string | null>(null);
  const profilesByKey = useMemo(
    () => buildProfileMap(supplierProfiles),
    [supplierProfiles],
  );
  const summary = useMemo(() => summarizeCandidates(candidates), [candidates]);
  const visibleCandidates = useMemo(
    () => filterCandidates(candidates, activeTab),
    [activeTab, candidates],
  );

  async function updateUserDecision(
    candidate: RecurringCandidateRow,
    userDecision: UserDecision,
  ) {
    setError(null);
    setPendingCandidateId(candidate.id);

    try {
      const response = await fetch(
        `/api/imports/${importId}/recurring-candidates/${candidate.id}`,
        {
          body: JSON.stringify({ userDecision }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        },
      );
      const result = (await response.json()) as { errors?: string[] };

      if (!response.ok) {
        setError(result.errors?.[0] ?? "Unable to update candidate.");
        return;
      }

      if (userDecision && rememberedCandidateIds[candidate.id]) {
        const ruleResponse = await fetch("/api/supplier-rules", {
          body: JSON.stringify(buildSupplierRulePayload(candidate, userDecision)),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const ruleResult = (await ruleResponse.json()) as { errors?: string[] };

        if (!ruleResponse.ok) {
          setError(ruleResult.errors?.[0] ?? "Unable to save supplier rule.");
          return;
        }
      }

      setRememberedCandidateIds((currentValues) => ({
        ...currentValues,
        [candidate.id]: false,
      }));
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update candidate.",
      );
    } finally {
      setPendingCandidateId(null);
    }
  }

  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-5 py-6 text-center text-sm text-zinc-500 shadow-sm">
        No recurring payment candidates detected yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <CandidateSummaryCards summary={summary} />

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            className={`inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-zinc-950 bg-zinc-950 text-white"
                : "border-zinc-300 bg-white text-zinc-950 hover:bg-zinc-100"
            }`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label} ({getTabCount(summary, tab.id)})
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
            <thead className="bg-zinc-100 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Supplier</th>
                <th className="px-4 py-3 font-semibold">Reason</th>
                <th className="px-4 py-3 font-semibold">Frequency</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3 text-right font-semibold">
                  Confidence
                </th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visibleCandidates.length > 0 ? (
                visibleCandidates.map((candidate) => (
                  <CandidateRow
                    activeTab={activeTab}
                    candidate={candidate}
                    isPending={pendingCandidateId === candidate.id}
                    key={candidate.id}
                    onRememberChange={(checked) =>
                      setRememberedCandidateIds((currentValues) => ({
                        ...currentValues,
                        [candidate.id]: checked,
                      }))
                    }
                    onUpdateUserDecision={updateUserDecision}
                    rememberDecision={Boolean(
                      rememberedCandidateIds[candidate.id],
                    )}
                    supplierProfile={profilesByKey[candidate.supplier_key]}
                  />
                ))
              ) : (
                <tr>
                  <td
                    className="px-5 py-6 text-center text-zinc-500"
                    colSpan={6}
                  >
                    {activeTab === "needs_review"
                      ? "No candidates need review."
                      : "No candidates in this bucket."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CandidateSummaryCards({ summary }: { summary: CandidateSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <SummaryCard label="Auto-accepted" value={summary.autoAccepted} />
      <SummaryCard label="Needs review" value={summary.needsReview} />
      <SummaryCard label="Auto-ignored" value={summary.autoIgnored} />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-950">{value}</div>
    </div>
  );
}

function CandidateRow({
  activeTab,
  candidate,
  isPending,
  onRememberChange,
  onUpdateUserDecision,
  rememberDecision,
  supplierProfile,
}: {
  activeTab: ReviewTab;
  candidate: RecurringCandidateRow;
  isPending: boolean;
  onRememberChange: (checked: boolean) => void;
  onUpdateUserDecision: (
    candidate: RecurringCandidateRow,
    userDecision: UserDecision,
  ) => Promise<void>;
  rememberDecision: boolean;
  supplierProfile: SupplierProfileRow | undefined;
}) {
  const effectiveCandidate = getEffectiveCandidate(candidate);
  const displayName = supplierProfile?.display_name ?? effectiveCandidate.supplier;
  const canDecide = candidate.user_decision === null;
  const canReset = activeTab === "all" && candidate.user_decision !== null;

  return (
    <tr className="bg-white">
      <td className="px-4 py-3 text-zinc-950">
        <div className="flex min-w-[240px] items-start gap-3">
          <SupplierAvatar profile={supplierProfile} supplier={displayName} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-words font-medium">{displayName}</span>
              {candidateHasCorrections(candidate) ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                  Corrected
                </span>
              ) : null}
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                {formatEnumLabel(candidate.review_bucket)}
              </span>
            </div>
            {supplierProfile?.domain ? (
              <div className="mt-0.5 break-all text-xs text-zinc-500">
                {supplierProfile.domain}
              </div>
            ) : null}
          </div>
        </div>
      </td>
      <td className="max-w-[320px] px-4 py-3 text-zinc-700">
        {formatCandidateReason(candidate)}
      </td>
      <td className="px-4 py-3 text-zinc-700">
        {formatEnumLabel(effectiveCandidate.frequency)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-zinc-950">
        {formatAmountCents(
          effectiveCandidate.amountCents,
          effectiveCandidate.currency,
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
        {formatConfidence(getCandidateConfidence(candidate))}
      </td>
      <td className="px-4 py-3">
        {canDecide ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CandidateActionButton
                disabled={isPending}
                label="Confirm"
                onClick={() => onUpdateUserDecision(candidate, "confirmed")}
              />
              <CandidateActionButton
                disabled={isPending}
                label="Ignore"
                onClick={() => onUpdateUserDecision(candidate, "ignored")}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input
                checked={rememberDecision}
                className="h-3.5 w-3.5"
                disabled={isPending}
                onChange={(event) => onRememberChange(event.target.checked)}
                type="checkbox"
              />
              Remember this decision for this supplier
            </label>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-zinc-600">
              {candidate.user_decision
                ? formatEnumLabel(candidate.user_decision)
                : "-"}
            </span>
            {canReset ? (
              <CandidateActionButton
                disabled={isPending}
                label="Reset"
                onClick={() => onUpdateUserDecision(candidate, null)}
              />
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}

function CandidateActionButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function SupplierAvatar({
  profile,
  supplier,
}: {
  profile: SupplierProfileRow | undefined;
  supplier: string;
}) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const logoUrl = profile?.logo_url;

  if (logoUrl && failedLogoUrl !== logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${supplier} logo`}
        className="h-9 w-9 shrink-0 rounded-md border border-zinc-200 bg-white object-contain"
        height={36}
        onError={() => setFailedLogoUrl(logoUrl)}
        src={logoUrl}
        width={36}
      />
    );
  }

  return <FallbackAvatar supplier={supplier} />;
}

function FallbackAvatar({ supplier }: { supplier: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-600">
      {getInitial(supplier)}
    </div>
  );
}

function summarizeCandidates(candidates: RecurringCandidateRow[]): CandidateSummary {
  return {
    all: candidates.length,
    autoAccepted: candidates.filter(
      (candidate) => candidate.review_bucket === "auto_accepted",
    ).length,
    autoIgnored: candidates.filter(
      (candidate) => candidate.review_bucket === "auto_ignored",
    ).length,
    needsReview: candidates.filter(
      (candidate) =>
        candidate.review_bucket === "needs_review" &&
        candidate.user_decision === null,
    ).length,
  };
}

function filterCandidates(
  candidates: RecurringCandidateRow[],
  activeTab: ReviewTab,
): RecurringCandidateRow[] {
  if (activeTab === "all") {
    return candidates;
  }

  if (activeTab === "needs_review") {
    return candidates.filter(
      (candidate) =>
        candidate.review_bucket === "needs_review" &&
        candidate.user_decision === null,
    );
  }

  return candidates.filter(
    (candidate) => candidate.review_bucket === activeTab,
  );
}

function getTabCount(summary: CandidateSummary, tab: ReviewTab): number {
  if (tab === "auto_accepted") {
    return summary.autoAccepted;
  }

  if (tab === "auto_ignored") {
    return summary.autoIgnored;
  }

  if (tab === "needs_review") {
    return summary.needsReview;
  }

  return summary.all;
}

function buildProfileMap(
  profiles: SupplierProfileRow[],
): Record<string, SupplierProfileRow> {
  return Object.fromEntries(
    profiles.map((profile) => [profile.supplier_key, profile]),
  );
}

function getInitial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "?";
}

function buildSupplierRulePayload(
  candidate: RecurringCandidateRow,
  userDecision: Exclude<UserDecision, null>,
) {
  const effectiveCandidate = getEffectiveCandidate(candidate);
  const defaultDecision: SupplierRuleDecision =
    userDecision === "confirmed" ? "auto_subscription" : "excluded";

  return {
    businessCategory:
      defaultDecision === "auto_subscription"
        ? categoryForConfirmedRule(effectiveCandidate.businessCategory)
        : effectiveCandidate.businessCategory,
    canonicalSupplier: effectiveCandidate.supplier,
    defaultDecision,
    example: {
      amountCents: effectiveCandidate.amountCents,
      candidateId: candidate.id,
      frequency: effectiveCandidate.frequency,
      paymentMethod: effectiveCandidate.paymentMethod,
      supplier: effectiveCandidate.supplier,
    },
    supplierKey: candidate.supplier_key,
  };
}

function categoryForConfirmedRule(
  businessCategory: BusinessCategory,
): BusinessCategory {
  return businessCategory === "unknown"
    ? "professional_service"
    : businessCategory;
}

function getEffectiveCandidate(candidate: RecurringCandidateRow) {
  return {
    amountCents: candidate.corrected_amount_cents ?? candidate.amount_cents,
    billingModel: candidate.corrected_billing_model ?? candidate.billing_model,
    businessCategory:
      candidate.corrected_business_category ?? candidate.business_category,
    currency: candidate.corrected_currency ?? candidate.currency,
    frequency: candidate.corrected_frequency ?? candidate.frequency,
    nextPayment: candidate.corrected_next_payment ?? candidate.next_payment,
    paymentMethod:
      candidate.corrected_payment_method ?? candidate.payment_method,
    supplier: candidate.corrected_supplier ?? candidate.supplier,
  };
}

function candidateHasCorrections(candidate: RecurringCandidateRow): boolean {
  return (
    candidate.corrected_supplier !== null ||
    candidate.corrected_frequency !== null ||
    candidate.corrected_amount_cents !== null ||
    candidate.corrected_currency !== null ||
    candidate.corrected_next_payment !== null ||
    candidate.corrected_payment_method !== null ||
    candidate.corrected_billing_model !== null ||
    candidate.corrected_business_category !== null ||
    normalizeOptionalString(candidate.review_notes) !== null
  );
}

function formatCandidateReason(candidate: RecurringCandidateRow): string {
  if (candidate.decision_reason) {
    return candidate.decision_reason;
  }

  const classification = candidate.evidence.classification;

  if (
    typeof classification === "object" &&
    classification !== null &&
    !Array.isArray(classification) &&
    typeof (classification as Record<string, unknown>).reason === "string"
  ) {
    return formatEnumLabel((classification as Record<string, string>).reason);
  }

  return "-";
}

function getCandidateConfidence(candidate: RecurringCandidateRow): number {
  return Math.min(
    candidate.recurrence_confidence,
    candidate.classification_confidence,
  );
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeOptionalString(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}
