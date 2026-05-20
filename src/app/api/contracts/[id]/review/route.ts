import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import {
  buildContractReviewUpdate,
  isContractReviewAction,
} from "@/lib/contracts/reviewActions";
import { revalidateContractsFrontendCache } from "@/lib/frontend-cache";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type ContractReviewBody = {
  action?: unknown;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [{ id }, body] = await Promise.all([
      params,
      request.json() as Promise<ContractReviewBody>,
    ]);

    if (!isContractReviewAction(body.action)) {
      return Response.json(
        { errors: ["Review action is invalid."] },
        { status: 400 },
      );
    }

    const { organizationId } = await getIntegrationRequestContext();
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: contract, error: contractError } = await supabaseAdmin
      .from("contracts")
      .select("id, confidence_reason, extracted_fields_json, status")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (contractError) {
      return Response.json(
        { errors: [`Unable to load contract: ${contractError.message}`] },
        { status: 500 },
      );
    }

    if (!contract) {
      return Response.json({ errors: ["Contract not found."] }, { status: 404 });
    }

    const update = buildContractReviewUpdate({
      action: body.action,
      currentReason:
        typeof contract.confidence_reason === "string"
          ? contract.confidence_reason
          : "",
      currentStatus: typeof contract.status === "string" ? contract.status : "",
      existingFields: isRecord(contract.extracted_fields_json)
        ? contract.extracted_fields_json
        : {},
      reviewedAt: new Date().toISOString(),
    });
    const { data: updatedContract, error: updateError } = await supabaseAdmin
      .from("contracts")
      .update({
        confidence_reason: update.confidenceReason,
        extracted_fields_json: update.extractedFields,
        status: update.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select("id, status, confidence_reason, extracted_fields_json")
      .maybeSingle();

    if (updateError) {
      return Response.json(
        { errors: [`Unable to update contract: ${updateError.message}`] },
        { status: 500 },
      );
    }

    revalidateContractsFrontendCache(organizationId);

    return Response.json({ contract: updatedContract });
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    return Response.json(
      {
        errors: [
          error instanceof Error ? error.message : "Unable to review contract.",
        ],
      },
      { status: 500 },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
