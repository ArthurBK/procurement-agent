import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  RecurringCandidatesReview,
  type RecurringCandidateRow,
  type SupplierProfileRow,
} from "./RecurringCandidatesReview";

type ImportRow = {
  id: string;
  file_name: string;
};

export default async function ImportRecurringCandidatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const { id } = await params;
  const supabaseAdminResult = getSupabaseAdminClient();

  if (!supabaseAdminResult.ok) {
    return <RecurringCandidatesError message={supabaseAdminResult.error} />;
  }

  const { supabaseAdmin } = supabaseAdminResult;
  const [importResult, candidatesResult] = await Promise.all([
    supabaseAdmin
      .from("imports")
      .select("id, file_name")
      .eq("id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("recurring_payment_candidates")
      .select(
        [
          "id",
          "supplier",
          "supplier_key",
          "business_category",
          "system_decision",
          "user_decision",
          "review_bucket",
          "decision_source",
          "decision_reason",
          "frequency",
          "billing_model",
          "amount_cents",
          "currency",
          "next_payment",
          "payment_method",
          "recurrence_confidence",
          "classification_confidence",
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
      .eq("import_id", id)
      .order("review_bucket", { ascending: true })
      .order("supplier", { ascending: true }),
  ]);

  if (importResult.error) {
    return (
      <RecurringCandidatesError
        message={`Unable to load import: ${importResult.error.message}`}
      />
    );
  }

  if (!importResult.data) {
    notFound();
  }

  if (candidatesResult.error) {
    return (
      <RecurringCandidatesError
        message={`Unable to load recurring candidates: ${candidatesResult.error.message}`}
      />
    );
  }

  const importRow = importResult.data as ImportRow;
  const candidates = (candidatesResult.data ??
    []) as unknown as RecurringCandidateRow[];
  const supplierKeys = Array.from(
    new Set(
      candidates
        .map((candidate) => candidate.supplier_key)
        .filter((supplierKey) => supplierKey.trim().length > 0),
    ),
  );

  const profilesResult =
    supplierKeys.length > 0
      ? await supabaseAdmin
          .from("supplier_profiles")
          .select(
            "id, supplier_key, display_name, domain, logo_url, logo_source",
          )
          .in("supplier_key", supplierKeys)
      : { data: [], error: null };

  if (profilesResult.error) {
    return (
      <RecurringCandidatesError
        message={`Unable to load supplier profiles: ${profilesResult.error.message}`}
      />
    );
  }

  const supplierProfiles = (profilesResult.data ??
    []) as unknown as SupplierProfileRow[];

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <Link
              className="text-sm font-medium text-zinc-500"
              href={`/imports/${importRow.id}`}
            >
              Import detail
            </Link>
            <Link
              className="text-sm font-medium text-zinc-500"
              href="/supplier-rules"
            >
              View supplier rules
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-normal">
              Recurring payment candidates
            </h1>
            <p className="text-sm text-zinc-500">
              Detected from import: {importRow.file_name}
            </p>
          </div>
        </header>

        <RecurringCandidatesReview
          candidates={candidates}
          importId={importRow.id}
          supplierProfiles={supplierProfiles}
        />
      </div>
    </main>
  );
}

function getSupabaseAdminClient():
  | {
      ok: true;
      supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
    }
  | { ok: false; error: string } {
  try {
    return { ok: true, supabaseAdmin: createSupabaseAdminClient() };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to configure Supabase admin client.",
    };
  }
}

function RecurringCandidatesError({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {message}
      </div>
    </main>
  );
}
