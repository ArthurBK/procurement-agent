import type {
  BusinessCategory,
  SystemDecision,
} from "./classifyRecurringCandidate";
import type { RecurringPaymentCandidateBase } from "./detectRecurringPaymentCandidates";
import { applyCandidateCorrections } from "./applyCandidateCorrections.ts";
import type { ReviewBucket } from "./triageRecurringCandidate.ts";

type Frequency = RecurringPaymentCandidateBase["frequency"];
type BillingModel = RecurringPaymentCandidateBase["billingModel"];
type UserDecision = "confirmed" | "ignored" | null;

export type RecurringPaymentCandidateForSubscription = {
  id: string;
  import_id: string;
  supplier: string;
  supplier_key: string;
  payment_method: string | null;
  frequency: Frequency;
  billing_model: BillingModel;
  amount_cents: number;
  currency: string;
  last_payment: string | null;
  next_payment: string | null;
  transactions_count: number;
  recurrence_confidence: number;
  business_category: BusinessCategory;
  classification_confidence: number;
  system_decision: SystemDecision;
  user_decision: UserDecision;
  review_bucket: ReviewBucket;
  decision_source: string | null;
  decision_reason: string | null;
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

export type SubscriptionInsertFromCandidate = {
  amount_cents: number;
  billing_model: BillingModel;
  business_category: BusinessCategory;
  candidate_id: string;
  confidence: number;
  currency: string;
  evidence: Record<string, unknown>;
  frequency: Frequency;
  import_id: string;
  last_payment: string | null;
  next_payment: string | null;
  payment_method: string | null;
  supplier: string;
  supplier_key: string;
  transactions_count: number;
};

export async function rebuildSubscriptionsForImport(
  importId: string,
): Promise<void> {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabaseAdmin = createSupabaseAdminClient();
  const { error: deleteError } = await supabaseAdmin
    .from("subscriptions")
    .delete()
    .eq("import_id", importId);

  if (deleteError) {
    throw new Error(`Unable to clear subscriptions: ${deleteError.message}`);
  }

  const { data: candidates, error: candidatesError } = await supabaseAdmin
    .from("recurring_payment_candidates")
    .select(
      [
        "id",
        "import_id",
        "supplier",
        "supplier_key",
        "payment_method",
        "frequency",
        "billing_model",
        "amount_cents",
        "currency",
        "last_payment",
        "next_payment",
        "transactions_count",
        "recurrence_confidence",
        "business_category",
        "classification_confidence",
        "system_decision",
        "user_decision",
        "review_bucket",
        "decision_source",
        "decision_reason",
        "evidence",
        "corrected_supplier",
        "corrected_frequency",
        "corrected_amount_cents",
        "corrected_currency",
        "corrected_next_payment",
        "corrected_payment_method",
        "corrected_billing_model",
        "corrected_business_category",
        "review_notes",
      ].join(", "),
    )
    .eq("import_id", importId);

  if (candidatesError) {
    throw new Error(
      `Unable to load recurring payment candidates: ${candidatesError.message}`,
    );
  }

  const inserts = mapAcceptedCandidatesToSubscriptionInserts(
    (candidates ?? []) as unknown as RecurringPaymentCandidateForSubscription[],
  );

  if (inserts.length === 0) {
    return;
  }

  const { error: insertError } = await supabaseAdmin
    .from("subscriptions")
    .insert(inserts);

  if (insertError) {
    throw new Error(`Unable to save subscriptions: ${insertError.message}`);
  }
}

export function mapAcceptedCandidatesToSubscriptionInserts(
  candidates: RecurringPaymentCandidateForSubscription[],
): SubscriptionInsertFromCandidate[] {
  return candidates
    .filter((candidate) => isAcceptedCandidate(candidate))
    .map((candidate) => {
      const corrections = applyCandidateCorrections(candidate);
      const triageEvidence = {
        decision_reason: candidate.decision_reason,
        decision_source: candidate.decision_source,
        review_bucket: candidate.review_bucket,
      };
      const evidence =
        Object.keys(corrections.evidencePatch).length > 0
          ? {
              ...candidate.evidence,
              ...triageEvidence,
              ...corrections.evidencePatch,
            }
          : { ...candidate.evidence, ...triageEvidence };

      return {
        amount_cents: corrections.amountCents,
        billing_model: corrections.billingModel,
        business_category: corrections.businessCategory,
        candidate_id: candidate.id,
        confidence: Math.min(
          candidate.recurrence_confidence,
          candidate.classification_confidence,
        ),
        currency: corrections.currency,
        evidence,
        frequency: corrections.frequency,
        import_id: candidate.import_id,
        last_payment: candidate.last_payment,
        next_payment: corrections.nextPayment,
        payment_method: corrections.paymentMethod,
        supplier: corrections.supplier,
        supplier_key: candidate.supplier_key,
        transactions_count: candidate.transactions_count,
      };
    });
}

function isAcceptedCandidate(
  candidate: RecurringPaymentCandidateForSubscription,
): boolean {
  if (candidate.user_decision === "ignored") {
    return false;
  }

  if (candidate.user_decision === "confirmed") {
    return true;
  }

  return false;
}
