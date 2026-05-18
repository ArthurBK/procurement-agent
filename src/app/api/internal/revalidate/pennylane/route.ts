import { revalidatePennylaneFrontendCache } from "@/lib/frontend-cache";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const configuredSecret = process.env.INTERNAL_REVALIDATE_SECRET?.trim();

  if (!configuredSecret) {
    return Response.json(
      { errors: ["INTERNAL_REVALIDATE_SECRET is not configured."] },
      { status: 501 },
    );
  }

  const providedSecret = request.headers.get("x-internal-revalidate-secret");

  if (providedSecret !== configuredSecret) {
    return Response.json({ errors: ["Unauthorized."] }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    organizationId?: unknown;
  } | null;
  const organizationId = body?.organizationId;

  if (typeof organizationId !== "string" || !organizationId.trim()) {
    return Response.json(
      { errors: ["organizationId is required."] },
      { status: 400 },
    );
  }

  revalidatePennylaneFrontendCache(organizationId);

  return Response.json({ status: "ok" });
}
