"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatAmountCents } from "@/lib/imports/formatAmount";
import type {
  ParsedTransactionPreview,
  ParsedTransactionPreviewResult,
} from "@/lib/imports/parseAccountingFile";

type SaveImportResponse = {
  importId?: string;
  rowsCount?: number;
  errors?: string[];
};

export default function NewImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] =
    useState<ParsedTransactionPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const previewRows = useMemo(() => preview?.rows.slice(0, 50) ?? [], [preview]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Choose a CSV, XLSX, or XLS file.");
      return;
    }

    setError(null);
    setIsLoading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/imports/preview", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as ParsedTransactionPreviewResult;

      if (!response.ok) {
        setPreview(null);
        setError(result.errors[0] ?? "The file could not be parsed.");
        return;
      }

      setPreview(result);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The file could not be uploaded.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveImport() {
    if (!file) {
      setError("Choose a CSV, XLSX, or XLS file.");
      return;
    }

    setError(null);
    setIsSaving(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as SaveImportResponse;

      if (!response.ok || !result.importId) {
        setError(result.errors?.[0] ?? "The import could not be saved.");
        return;
      }

      router.push(`/imports/${result.importId}`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The import could not be saved.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="text-sm font-medium text-zinc-500">Imports</p>
          <h1 className="text-3xl font-semibold tracking-normal">
            Accounting import
          </h1>
        </header>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
            File
            <input
              accept=".csv,.xlsx,.xls"
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700"
              disabled={isLoading || isSaving}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setError(null);
              }}
              type="file"
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!file || isLoading || isSaving}
              type="submit"
            >
              {isLoading ? "Uploading..." : "Upload"}
            </button>
            {preview && preview.rows.length > 0 ? (
              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                disabled={isLoading || isSaving}
                onClick={handleSaveImport}
                type="button"
              >
                {isSaving ? "Saving..." : "Save import"}
              </button>
            ) : null}
            {file ? (
              <span className="truncate text-sm text-zinc-500">{file.name}</span>
            ) : null}
          </div>
        </form>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {preview?.errors.length ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <h2 className="font-semibold">Parsing errors</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {preview.errors.map((previewError) => (
                <li key={previewError}>{previewError}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {preview ? (
          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <h2 className="text-base font-semibold">Parsed preview</h2>
              <span className="text-sm text-zinc-500">
                Showing {previewRows.length} of {preview.rows.length} rows
              </span>
            </div>

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
                  {previewRows.length > 0 ? (
                    previewRows.map((row) => (
                      <PreviewRow key={row.rowNumber} row={row} />
                    ))
                  ) : (
                    <tr>
                      <td
                        className="px-5 py-6 text-center text-zinc-500"
                        colSpan={5}
                      >
                        No rows returned.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function PreviewRow({ row }: { row: ParsedTransactionPreview }) {
  return (
    <tr className="bg-white">
      <td className="whitespace-nowrap px-5 py-3 text-zinc-700">
        {row.date ?? "-"}
      </td>
      <td className="px-5 py-3 font-medium text-zinc-950">
        {row.rawSupplier || "-"}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-right font-medium text-zinc-950">
        {formatAmountCents(row.amountCents, row.currency)}
      </td>
      <td className="px-5 py-3 text-zinc-700">{row.bankAccount ?? "-"}</td>
      <td className="px-5 py-3 text-zinc-700">{row.description ?? "-"}</td>
    </tr>
  );
}
