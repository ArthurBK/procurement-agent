import Link from "next/link";
import { connection } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  SupplierRulesTable,
  type SupplierRuleRow,
} from "./SupplierRulesTable";

export default async function SupplierRulesPage() {
  await connection();

  const { rules, error } = await loadSupplierRules();

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            className="text-sm font-medium text-zinc-500"
            href="/app/usage/identity"
          >
            Identity signals
          </Link>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-normal">
              Supplier rules
            </h1>
            <p className="text-sm text-zinc-500">
              User-curated rules for supplier classification and review.
            </p>
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Unable to load supplier rules: {error}
          </div>
        ) : (
          <SupplierRulesTable rules={rules} />
        )}
      </div>
    </main>
  );
}

async function loadSupplierRules(): Promise<{
  rules: SupplierRuleRow[];
  error: string | null;
}> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
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
          "updated_at",
        ].join(", "),
      )
      .order("updated_at", { ascending: false });

    if (error) {
      return { error: error.message, rules: [] };
    }

    return {
      error: null,
      rules: (data ?? []) as unknown as SupplierRuleRow[],
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to load supplier rules.",
      rules: [],
    };
  }
}
