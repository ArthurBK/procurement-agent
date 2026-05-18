import { rebuildSubscriptionsForImport } from "@/lib/recurring/rebuildSubscriptionsForImport";
import { parseRecurringCandidatePatchBody } from "@/lib/recurring/validateRecurringCandidatePatch";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; candidateId: string }> },
) {
  const { candidateId, id: importId } = await params;

  try {
    const body = await request.json();
    const parsedBody = parseRecurringCandidatePatchBody(body);

    if (!parsedBody.ok) {
      return Response.json({ errors: parsedBody.errors }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const decisionUpdate = parsedBody.hasUserDecision
      ? getDecisionUpdate(parsedBody.update.user_decision ?? null)
      : {};
    const { data: candidate, error: updateError } = await supabaseAdmin
      .from("recurring_payment_candidates")
      .update({
        ...parsedBody.update,
        ...decisionUpdate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidateId)
      .eq("import_id", importId)
      .select("*")
      .maybeSingle();

    if (updateError) {
      return Response.json(
        { errors: [`Unable to update candidate: ${updateError.message}`] },
        { status: 500 },
      );
    }

    if (!candidate) {
      return Response.json(
        { errors: ["Recurring payment candidate not found."] },
        { status: 404 },
      );
    }

    try {
      await rebuildSubscriptionsForImport(importId);
    } catch (rebuildError) {
      return Response.json(
        {
          errors: [
            rebuildError instanceof Error
              ? rebuildError.message
              : "Unable to rebuild subscriptions.",
          ],
        },
        { status: 500 },
      );
    }

    return Response.json({ candidate });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected recurring candidate update error.";

    return Response.json({ errors: [message] }, { status: 500 });
  }
}

function getDecisionUpdate(
  userDecision: "confirmed" | "ignored" | null,
): {
  auto_decided_at: null;
  decision_reason: string | null;
  decision_source: "user" | null;
} {
  if (userDecision === "confirmed") {
    return {
      auto_decided_at: null,
      decision_reason: "User confirmed",
      decision_source: "user",
    };
  }

  if (userDecision === "ignored") {
    return {
      auto_decided_at: null,
      decision_reason: "User ignored",
      decision_source: "user",
    };
  }

  return {
    auto_decided_at: null,
    decision_reason: null,
    decision_source: null,
  };
}
