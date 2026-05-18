import { parseAccountingFile } from "@/lib/imports/parseAccountingFile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return Response.json(
        {
          columns: [],
          rows: [],
          errors: ["Upload a CSV, XLSX, or XLS file using the file field."],
        },
        { status: 400 },
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const preview = parseAccountingFile(fileBuffer, file.name);
    const status =
      preview.rows.length === 0 && preview.errors.length > 0 ? 400 : 200;

    return Response.json(preview, { status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected import preview error.";

    return Response.json(
      {
        columns: [],
        rows: [],
        errors: [message],
      },
      { status: 500 },
    );
  }
}
