import { autoCreateSupplierProfilesForImport } from "@/lib/suppliers/autoCreateSupplierProfilesForImport";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await autoCreateSupplierProfilesForImport({
      importId: id,
      supabaseAdmin: createSupabaseAdminClient(),
    });

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to search supplier logos.";
    const status = message.includes("not configured") ? 500 : 502;

    return Response.json({ errors: [message] }, { status });
  }
}
