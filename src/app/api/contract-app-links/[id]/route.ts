import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { rebuildContractAppLinks } from "@/lib/contracts/matching";
import { revalidateContractsFrontendCache } from "@/lib/frontend-cache";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type PatchContractAppLinkBody = {
  matchStatus?: string;
  matchScore?: number;
  matchReason?: string;
};

const MATCH_STATUSES = [
  "matched",
  "possible_match",
  "missing_contract",
  "orphan_contract",
  "ignored",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as PatchContractAppLinkBody;
    const validation = validateBody(body);

    if (!validation.ok) {
      return Response.json({ errors: [validation.error] }, { status: 400 });
    }

    const { organizationId } = await getIntegrationRequestContext();
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("contract_app_links")
      .update({
        ...validation.value,
        matched_by: "manual",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select("*")
      .maybeSingle();

    if (error) {
      return Response.json(
        { errors: [`Unable to update contract app link: ${error.message}`] },
        { status: 500 },
      );
    }

    if (!data) {
      return Response.json(
        { errors: ["Contract app link not found."] },
        { status: 404 },
      );
    }

    await rebuildContractAppLinks({ organizationId, supabaseAdmin });
    revalidateContractsFrontendCache(organizationId);

    return Response.json({ link: data });
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    return Response.json(
      {
        errors: [
          error instanceof Error
            ? error.message
            : "Unable to update contract app link.",
        ],
      },
      { status: 500 },
    );
  }
}

function validateBody(
  body: PatchContractAppLinkBody,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const update: Record<string, unknown> = {};

  if (body.matchStatus !== undefined) {
    if (!MATCH_STATUSES.includes(body.matchStatus as (typeof MATCH_STATUSES)[number])) {
      return { error: "matchStatus is invalid.", ok: false };
    }

    update.match_status = body.matchStatus;
  }

  if (body.matchScore !== undefined) {
    if (
      typeof body.matchScore !== "number" ||
      !Number.isFinite(body.matchScore) ||
      body.matchScore < 0 ||
      body.matchScore > 1
    ) {
      return { error: "matchScore must be a number between 0 and 1.", ok: false };
    }

    update.match_score = body.matchScore;
  }

  if (body.matchReason !== undefined) {
    const reason = body.matchReason.trim();

    if (!reason) {
      return { error: "matchReason cannot be empty.", ok: false };
    }

    update.match_reason = reason;
  }

  if (Object.keys(update).length === 0) {
    return { error: "No valid fields to update.", ok: false };
  }

  return { ok: true, value: update };
}
