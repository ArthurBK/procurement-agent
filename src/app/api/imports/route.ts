import { parseAccountingFile } from "@/lib/imports/parseAccountingFile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return Response.json(
        {
          errors: ["Upload a CSV, XLSX, or XLS file using the file field."],
        },
        { status: 400 },
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const preview = parseAccountingFile(fileBuffer, file.name);

    if (preview.rows.length === 0) {
      return Response.json(
        {
          errors:
            preview.errors.length > 0
              ? preview.errors
              : ["No transaction rows were parsed from the file."],
        },
        { status: 400 },
      );
    }

    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: importRow, error: importError } = await supabaseAdmin
      .from("imports")
      .insert({
        errors: preview.errors,
        file_name: file.name,
        raw_columns: preview.columns,
        rows_count: preview.rows.length,
        status: "completed",
      })
      .select("id")
      .single();

    if (importError || !importRow) {
      return Response.json(
        {
          errors: [
            `Unable to save import: ${
              importError?.message ?? "No import row was returned."
            }`,
          ],
        },
        { status: 500 },
      );
    }

    const importId = String(importRow.id);
    const rawTransactions = preview.rows.map((row) => ({
      amount_cents: row.amountCents,
      bank_account: row.bankAccount,
      currency: row.currency,
      description: row.description,
      import_id: importId,
      raw_supplier: row.rawSupplier,
      row_number: row.rowNumber,
      source_row: row.sourceRow,
      transaction_date: row.date,
    }));
    const { error: transactionError } = await supabaseAdmin
      .from("raw_transactions")
      .insert(rawTransactions);

    if (transactionError) {
      await supabaseAdmin.from("imports").delete().eq("id", importId);

      return Response.json(
        {
          errors: [
            `Unable to save raw transactions: ${transactionError.message}`,
          ],
        },
        { status: 500 },
      );
    }

    return Response.json({
      errors: preview.errors,
      importId,
      rowsCount: preview.rows.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected import save error.";

    return Response.json(
      {
        errors: [message],
      },
      { status: 500 },
    );
  }
}
