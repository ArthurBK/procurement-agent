import Link from "next/link";
import { connection } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ImportSummary = {
  id: string;
  created_at: string;
  file_name: string;
  rows_count: number;
  status: string;
};

export default async function ImportsPage() {
  await connection();

  const { imports, error } = await loadImports();

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-zinc-500">Imports</p>
            <h1 className="text-3xl font-semibold tracking-normal">
              Recent imports
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="text-sm font-medium text-zinc-700 hover:underline"
              href="/app/settings/integrations"
            >
              Google Workspace
            </Link>
            <Link
              className="text-sm font-medium text-zinc-700 hover:underline"
              href="/supplier-rules"
            >
              View supplier rules
            </Link>
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
              href="/imports/new"
            >
              New import
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Unable to load imports: {error}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-zinc-100 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">File name</th>
                  <th className="px-5 py-3 font-semibold">Created at</th>
                  <th className="px-5 py-3 text-right font-semibold">
                    Rows count
                  </th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {imports.length > 0 ? (
                  imports.map((importRow) => (
                    <tr className="bg-white" key={importRow.id}>
                      <td className="px-5 py-3 font-medium text-zinc-950">
                        <Link
                          className="hover:underline"
                          href={`/imports/${importRow.id}`}
                        >
                          {importRow.file_name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-zinc-700">
                        {formatDateTime(importRow.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-zinc-700">
                        {importRow.rows_count}
                      </td>
                      <td className="px-5 py-3 text-zinc-700">
                        {importRow.status}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      className="px-5 py-6 text-center text-zinc-500"
                      colSpan={4}
                    >
                      No imports saved yet.
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

async function loadImports(): Promise<{
  imports: ImportSummary[];
  error: string | null;
}> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("imports")
      .select("id, created_at, file_name, rows_count, status")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return { imports: [], error: error.message };
    }

    return { imports: (data ?? []) as ImportSummary[], error: null };
  } catch (error) {
    return {
      imports: [],
      error: error instanceof Error ? error.message : "Unable to load imports.",
    };
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
