import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatAmountCents } from "@/lib/imports/formatAmount";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DetectRecurringPaymentsButton } from "./DetectRecurringPaymentsButton";
import { ViewSubscriptionsButton } from "./ViewSubscriptionsButton";

type ImportDetail = {
  id: string;
  created_at: string;
  file_name: string;
  status: string;
  rows_count: number;
  errors: unknown;
};

type RawTransaction = {
  id: string;
  row_number: number;
  transaction_date: string | null;
  raw_supplier: string;
  amount_cents: number | null;
  currency: string;
  bank_account: string | null;
  description: string | null;
};

export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const { id } = await params;
  const supabaseAdminResult = getSupabaseAdminClient();

  if (!supabaseAdminResult.ok) {
    return <ImportError message={supabaseAdminResult.error} />;
  }

  const { supabaseAdmin } = supabaseAdminResult;
  const [importResult, transactionResult] = await Promise.all([
    supabaseAdmin
      .from("imports")
      .select("id, created_at, file_name, status, rows_count, errors")
      .eq("id", id)
      .maybeSingle(),
    supabaseAdmin
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
        ].join(", "),
      )
      .eq("import_id", id)
      .order("row_number", { ascending: true }),
  ]);

  if (importResult.error) {
    return (
      <ImportError message={`Unable to load import: ${importResult.error.message}`} />
    );
  }

  if (!importResult.data) {
    notFound();
  }

  if (transactionResult.error) {
    return (
      <ImportError
        message={`Unable to load transactions: ${transactionResult.error.message}`}
      />
    );
  }

  const importRow = importResult.data as ImportDetail;
  const transactions = (transactionResult.data ?? []) as unknown as RawTransaction[];
  const errors = toStringArray(importRow.errors);

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-3">
            <Link className="text-sm font-medium text-zinc-500" href="/imports">
              Imports
            </Link>
          <h1 className="max-w-full break-all text-sm font-medium leading-6 tracking-normal text-zinc-700 sm:text-base">
            Import: {importRow.file_name}
          </h1>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <DetectRecurringPaymentsButton importId={importRow.id} />
            <Link
              className="text-sm font-medium text-zinc-700 hover:underline"
              href={`/imports/${importRow.id}/recurring-candidates`}
            >
              View recurring candidates
            </Link>
            <ViewSubscriptionsButton importId={importRow.id} />
          </div>
        </header>

        <dl className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm shadow-sm sm:grid-cols-4">
          <MetadataItem
            label="Created at"
            value={formatDateTime(importRow.created_at)}
          />
          <MetadataItem label="Rows count" value={String(importRow.rows_count)} />
          <MetadataItem label="Status" value={importRow.status} />
          <MetadataItem label="Errors" value={String(errors.length)} />
        </dl>

        {errors.length > 0 ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <h2 className="font-semibold">Parsing errors</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-zinc-100 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 font-semibold">Supplier</th>
                  <th className="px-5 py-3 text-right font-semibold">
                    Amount
                  </th>
                  <th className="px-5 py-3 font-semibold">Bank account</th>
                  <th className="px-5 py-3 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {transactions.length > 0 ? (
                  transactions.map((transaction) => (
                    <tr className="bg-white" key={transaction.id}>
                      <td className="whitespace-nowrap px-5 py-3 text-zinc-700">
                        {transaction.transaction_date ?? "-"}
                      </td>
                      <td className="px-5 py-3 font-medium text-zinc-950">
                        {transaction.raw_supplier || "-"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-medium text-zinc-950">
                        {formatAmountCents(
                          transaction.amount_cents,
                          transaction.currency,
                        )}
                      </td>
                      <td className="px-5 py-3 text-zinc-700">
                        {transaction.bank_account ?? "-"}
                      </td>
                      <td className="px-5 py-3 text-zinc-700">
                        {transaction.description ?? "-"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      className="px-5 py-6 text-center text-zinc-500"
                      colSpan={5}
                    >
                      No transactions saved for this import.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
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

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt>
      <dd className="text-sm font-medium text-zinc-950">{value}</dd>
    </div>
  );
}

function ImportError({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {message}
      </div>
    </main>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
