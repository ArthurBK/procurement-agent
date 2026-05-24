import { searchLogoDevBrandsForName } from "@/lib/suppliers/logoDevSearch";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (query === null) {
    return Response.json({ error: "q is required" }, { status: 400 });
  }

  if (query.trim().length < 2) {
    return Response.json({ results: [] });
  }

  try {
    const results = await searchLogoDevBrandsForName(query);

    return Response.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to search Logo.dev.";
    const status =
      message === "LOGO_DEV_SECRET_KEY is not configured" ? 500 : 502;

    return Response.json({ error: message }, { status });
  }
}
