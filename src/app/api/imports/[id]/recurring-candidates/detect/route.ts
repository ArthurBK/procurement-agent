import {
  classifyRecurringCandidate,
  type CandidateClassification,
} from "@/lib/recurring/classifyRecurringCandidate";
import {
  detectRecurringPaymentCandidates,
  type RawTransactionForRecurringDetection,
  type RecurringPaymentCandidateBase,
} from "@/lib/recurring/detectRecurringPaymentCandidates";
import { rebuildSubscriptionsForImport } from "@/lib/recurring/rebuildSubscriptionsForImport";
import {
  triageRecurringCandidate,
  type RecurringCandidateTriage,
} from "@/lib/recurring/triageRecurringCandidate";
import {
  autoCreateSupplierProfilesForImport,
  type AutoCreateSupplierProfilesResult,
} from "@/lib/suppliers/autoCreateSupplierProfilesForImport";
import type { SupplierRule } from "@/lib/supplierRules/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type ExistingCandidate = {
  id: string;
  candidate_key: string;
  decision_source: string | null;
  user_decision: "confirmed" | "ignored" | null;
};

type CandidateUpsert = {
  amount_cents: number;
  billing_model: RecurringPaymentCandidateBase["billingModel"];
  business_category: CandidateClassification["businessCategory"];
  candidate_key: string;
  classification_confidence: number;
  currency: string;
  evidence: Record<string, unknown>;
  frequency: RecurringPaymentCandidateBase["frequency"];
  import_id: string;
  last_payment: string | null;
  next_payment: string | null;
  payment_method: string | null;
  recurrence_confidence: number;
  auto_decided_at: string | null;
  decision_reason: string | null;
  decision_source: string | null;
  review_bucket: RecurringCandidateTriage["reviewBucket"];
  supplier: string;
  supplier_key: string;
  system_decision: CandidateClassification["systemDecision"];
  transactions_count: number;
  updated_at: string;
  user_decision: "confirmed" | "ignored" | null;
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: importId } = await params;

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: importRow, error: importError } = await supabaseAdmin
      .from("imports")
      .select("id")
      .eq("id", importId)
      .maybeSingle();

    if (importError) {
      return Response.json(
        { errors: [`Unable to load import: ${importError.message}`] },
        { status: 500 },
      );
    }

    if (!importRow) {
      return Response.json({ errors: ["Import not found."] }, { status: 404 });
    }

    const { data: rawTransactions, error: transactionError } = await supabaseAdmin
      .from("raw_transactions")
      .select(
        [
          "id",
          "row_number",
          "transaction_date",
          "raw_supplier",
          "amount_cents",
          "currency",
          "bank_account",
          "description",
          "source_row",
        ].join(", "),
      )
      .eq("import_id", importId)
      .order("row_number", { ascending: true });

    if (transactionError) {
      return Response.json(
        {
          errors: [
            `Unable to load raw transactions: ${transactionError.message}`,
          ],
        },
        { status: 500 },
      );
    }

    const [existingCandidatesResult, supplierRulesResult] = await Promise.all([
      supabaseAdmin
        .from("recurring_payment_candidates")
        .select("id, candidate_key, decision_source, user_decision")
        .eq("import_id", importId),
      supabaseAdmin
        .from("supplier_rules")
        .select(
          [
            "id",
            "supplier_key",
            "canonical_supplier",
            "business_category",
            "default_decision",
            "match_type",
            "source",
            "notes",
            "active",
          ].join(", "),
        )
        .eq("active", true),
    ]);
    const { data: existingCandidates, error: existingCandidatesError } =
      existingCandidatesResult;

    if (existingCandidatesError) {
      return Response.json(
        {
          errors: [
            `Unable to load existing candidates: ${existingCandidatesError.message}`,
          ],
        },
        { status: 500 },
      );
    }

    if (supplierRulesResult.error) {
      return Response.json(
        {
          errors: [
            `Unable to load supplier rules: ${supplierRulesResult.error.message}`,
          ],
        },
        { status: 500 },
      );
    }

    const existingCandidatesByKey = new Map(
      ((existingCandidates ?? []) as unknown as ExistingCandidate[]).map(
        (candidate) => [candidate.candidate_key, candidate],
      ),
    );
    const supplierRules = (supplierRulesResult.data ??
      []) as unknown as SupplierRule[];
    const candidateBases = detectRecurringPaymentCandidates(
      (rawTransactions ?? []) as unknown as RawTransactionForRecurringDetection[],
    );
    const now = new Date().toISOString();
    const triagedCandidates = candidateBases.map((candidate) => {
      const supplierRule = findMatchingSupplierRule(candidate, supplierRules);
      const classification = classifyRecurringCandidate(candidate, {
        supplierRules,
      });
      const triage = triageRecurringCandidate({
        candidate,
        classification,
        supplierRule,
      });

      return { candidate, classification, supplierRule, triage };
    });
    const upserts = triagedCandidates.map(
      ({ candidate, classification, triage }): CandidateUpsert => {
        const existingCandidate = existingCandidatesByKey.get(candidate.candidateKey);
        const preservedManualDecision = getPreservedManualDecision(
          existingCandidate,
        );
        const autoDecision = triage.shouldAutoAccept
          ? "confirmed"
          : triage.shouldAutoIgnore
            ? "ignored"
            : null;
        const userDecision = preservedManualDecision ?? autoDecision;
        const isManualDecision = preservedManualDecision !== null;
        const isAutoDecision = !isManualDecision && autoDecision !== null;

        return {
          auto_decided_at: isAutoDecision ? now : null,
          amount_cents: candidate.amountCents,
          billing_model: candidate.billingModel,
          business_category: classification.businessCategory,
          candidate_key: candidate.candidateKey,
          classification_confidence: classification.classificationConfidence,
          currency: candidate.currency,
          decision_reason: isManualDecision
            ? getManualDecisionReason(preservedManualDecision)
            : triage.decisionReason,
          decision_source: isManualDecision ? "user" : triage.decisionSource,
          evidence: buildEvidence(candidate.evidence, classification, triage),
          frequency: candidate.frequency,
          import_id: importId,
          last_payment: candidate.lastPayment,
          next_payment: candidate.nextPayment,
          payment_method: candidate.paymentMethod,
          recurrence_confidence: candidate.recurrenceConfidence,
          review_bucket: triage.reviewBucket,
          supplier: candidate.supplier,
          supplier_key: candidate.supplierKey,
          system_decision: classification.systemDecision,
          transactions_count: candidate.transactionsCount,
          updated_at: now,
          user_decision: userDecision,
        };
      },
    );

    if (upserts.length > 0) {
      const { error: upsertError } = await supabaseAdmin
        .from("recurring_payment_candidates")
        .upsert(upserts, { onConflict: "import_id,candidate_key" });

      if (upsertError) {
        return Response.json(
          { errors: [`Unable to save candidates: ${upsertError.message}`] },
          { status: 500 },
        );
      }
    }

    const currentCandidateKeys = new Set(
      candidateBases.map((candidate) => candidate.candidateKey),
    );
    const staleUndecidedCandidateIds = Array.from(
      existingCandidatesByKey.values(),
    )
      .filter(
        (candidate) =>
          candidate.user_decision === null &&
          !currentCandidateKeys.has(candidate.candidate_key),
      )
      .map((candidate) => candidate.id);

    if (staleUndecidedCandidateIds.length > 0) {
      const { error: staleDeleteError } = await supabaseAdmin
        .from("recurring_payment_candidates")
        .delete()
        .in("id", staleUndecidedCandidateIds);

      if (staleDeleteError) {
        return Response.json(
          {
            errors: [
              `Unable to remove stale candidates: ${staleDeleteError.message}`,
            ],
          },
          { status: 500 },
        );
      }
    }

    try {
      await rebuildSubscriptionsForImport(importId);
    } catch (rebuildError) {
      return Response.json(
        {
          errors: [
            rebuildError instanceof Error
              ? rebuildError.message
              : "Unable to rebuild subscriptions.",
          ],
        },
        { status: 500 },
      );
    }

    let autoLogoResult: AutoCreateSupplierProfilesResult | null = null;
    let autoLogoError: string | null = null;

    try {
      autoLogoResult = await autoCreateSupplierProfilesForImport({
        importId,
        supabaseAdmin,
      });
    } catch (logoError) {
      autoLogoError =
        logoError instanceof Error
          ? logoError.message
          : "Unable to search supplier logos.";
    }

    return Response.json({
      autoAcceptedCount: triagedCandidates.filter(
        ({ triage }) => triage.reviewBucket === "auto_accepted",
      ).length,
      autoIgnoredCount: triagedCandidates.filter(
        ({ triage }) => triage.reviewBucket === "auto_ignored",
      ).length,
      autoLogoCreatedCount: autoLogoResult?.createdCount ?? 0,
      autoLogoError,
      importId,
      candidatesCount: triagedCandidates.length,
      needsReviewCount: upserts.filter(
        (upsert) =>
          upsert.review_bucket === "needs_review" &&
          upsert.user_decision === null,
      ).length,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected recurring candidate detection error.";

    return Response.json({ errors: [message] }, { status: 500 });
  }
}

function buildEvidence(
  candidateEvidence: Record<string, unknown>,
  classification: CandidateClassification,
  triage: RecurringCandidateTriage,
): Record<string, unknown> {
  const evidence = {
    ...candidateEvidence,
    classification: {
      reason: classification.reason,
      signals: classification.signals,
    },
    classification_reason: classification.reason,
    decision_reason: triage.decisionReason,
    decision_source: triage.decisionSource,
    review_bucket: triage.reviewBucket,
  };

  if (classification.reason.startsWith("supplier_rule:")) {
    return {
      ...evidence,
      supplier_rule_business_category: classification.businessCategory,
      supplier_rule_default_decision: classification.systemDecision,
      supplier_rule_id: classification.signals.supplier_rule_id,
    };
  }

  return evidence;
}

function findMatchingSupplierRule(
  candidate: RecurringPaymentCandidateBase,
  supplierRules: SupplierRule[],
): SupplierRule | null {
  return (
    supplierRules.find(
      (rule) =>
        rule.active &&
        rule.match_type === "exact_supplier_key" &&
        rule.supplier_key === candidate.supplierKey,
    ) ?? null
  );
}

function getPreservedManualDecision(
  existingCandidate: ExistingCandidate | undefined,
): "confirmed" | "ignored" | null {
  if (
    !existingCandidate?.user_decision ||
    (existingCandidate.decision_source !== "user" &&
      existingCandidate.decision_source !== null)
  ) {
    return null;
  }

  return existingCandidate.user_decision;
}

function getManualDecisionReason(decision: "confirmed" | "ignored"): string {
  return decision === "confirmed" ? "User confirmed" : "User ignored";
}
