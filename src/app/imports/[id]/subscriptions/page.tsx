import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  SubscriptionsTable,
  type SubscriptionRow,
  type SupplierProfileRow,
} from "./SubscriptionsTable";

type ImportRow = {
  id: string;
  file_name: string;
};

export default async function ImportSubscriptionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const { id } = await params;
  const supabaseAdminResult = getSupabaseAdminClient();

  if (!supabaseAdminResult.ok) {
    return <SubscriptionsError message={supabaseAdminResult.error} />;
  }

  const { supabaseAdmin } = supabaseAdminResult;
  const [importResult, subscriptionsResult] = await Promise.all([
    supabaseAdmin
      .from("imports")
      .select("id, file_name")
      .eq("id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("subscriptions")
      .select(
        [
          "id",
          "supplier",
          "supplier_key",
          "next_payment",
          "payment_method",
          "frequency",
          "billing_model",
          "business_category",
          "amount_cents",
          "currency",
          "confidence",
          "evidence",
        ].join(", "),
      )
      .eq("import_id", id)
      .order("next_payment", { ascending: true, nullsFirst: false }),
  ]);

  if (importResult.error) {
    return (
      <SubscriptionsError
        message={`Unable to load import: ${importResult.error.message}`}
      />
    );
  }

  if (!importResult.data) {
    notFound();
  }

  if (subscriptionsResult.error) {
    return (
      <SubscriptionsError
        message={`Unable to load subscriptions: ${subscriptionsResult.error.message}`}
      />
    );
  }

  const importRow = importResult.data as ImportRow;
  const subscriptions = (subscriptionsResult.data ??
    []) as unknown as SubscriptionRow[];
  const supplierKeys = Array.from(
    new Set(subscriptions.map((subscription) => subscription.supplier_key)),
  );
  const profilesResult =
    supplierKeys.length > 0
      ? await supabaseAdmin
          .from("supplier_profiles")
          .select(
            [
              "id",
              "supplier_key",
              "display_name",
              "domain",
              "logo_url",
              "logo_source",
            ].join(", "),
          )
          .in("supplier_key", supplierKeys)
      : { data: [], error: null };

  if (profilesResult.error) {
    return (
      <SubscriptionsError
        message={`Unable to load supplier profiles: ${profilesResult.error.message}`}
      />
    );
  }

  const profiles = (profilesResult.data ?? []) as unknown as SupplierProfileRow[];

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            className="text-sm font-medium text-zinc-500"
            href={`/imports/${importRow.id}`}
          >
            Import detail
          </Link>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-normal">
              Subscriptions
            </h1>
            <p className="break-all text-sm text-zinc-500">
              Detected from import: {importRow.file_name}
            </p>
            <p className="text-sm text-zinc-500">
              These are accepted subscriptions derived from recurring payment
              candidates.
            </p>
          </div>
        </header>

        <SubscriptionsTable
          importId={importRow.id}
          profiles={profiles}
          subscriptions={subscriptions}
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

function SubscriptionsError({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {message}
      </div>
    </main>
  );
}
