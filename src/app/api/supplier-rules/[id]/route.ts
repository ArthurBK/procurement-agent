import type { SupplierRule } from "@/lib/supplierRules/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type PatchSupplierRuleBody = {
  canonicalSupplier?: string;
  businessCategory?: string;
  defaultDecision?: string;
  notes?: string | null;
  active?: boolean;
};

const BUSINESS_CATEGORIES: SupplierRule["business_category"][] = [
  "software",
  "cloud",
  "ai",
  "telecom",
  "banking",
  "workspace",
  "professional_service",
  "marketing",
  "food",
  "transport",
  "travel",
  "retail",
  "income",
  "unknown",
];

const DEFAULT_DECISIONS: SupplierRule["default_decision"][] = [
  "auto_subscription",
  "needs_review",
  "excluded",
];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = (await request.json()) as PatchSupplierRuleBody;
    const validation = validateBody(body);

    if (!validation.ok) {
      return Response.json({ errors: [validation.error] }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: rule, error } = await supabaseAdmin
      .from("supplier_rules")
      .update({
        ...validation.value,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      return Response.json(
        { errors: [`Unable to update supplier rule: ${error.message}`] },
        { status: 500 },
      );
    }

    if (!rule) {
      return Response.json(
        { errors: ["Supplier rule not found."] },
        { status: 404 },
      );
    }

    return Response.json({ rule });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected supplier rule update error.";

    return Response.json({ errors: [message] }, { status: 500 });
  }
}

function validateBody(
  body: PatchSupplierRuleBody,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } {
  const update: Record<string, unknown> = {};

  if (body.canonicalSupplier !== undefined) {
    const canonicalSupplier = body.canonicalSupplier.trim();

    if (!canonicalSupplier) {
      return { error: "canonicalSupplier cannot be empty.", ok: false };
    }

    update.canonical_supplier = canonicalSupplier;
  }

  if (body.businessCategory !== undefined) {
    if (!isBusinessCategory(body.businessCategory)) {
      return { error: "businessCategory is invalid.", ok: false };
    }

    update.business_category = body.businessCategory;
  }

  if (body.defaultDecision !== undefined) {
    if (!isDefaultDecision(body.defaultDecision)) {
      return { error: "defaultDecision is invalid.", ok: false };
    }

    update.default_decision = body.defaultDecision;
  }

  if (body.notes !== undefined) {
    update.notes = body.notes;
  }

  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return { error: "active must be a boolean.", ok: false };
    }

    update.active = body.active;
  }

  if (Object.keys(update).length === 0) {
    return { error: "No valid fields to update.", ok: false };
  }

  return { ok: true, value: update };
}

function isBusinessCategory(
  value: unknown,
): value is SupplierRule["business_category"] {
  return (
    typeof value === "string" &&
    BUSINESS_CATEGORIES.includes(value as SupplierRule["business_category"])
  );
}

function isDefaultDecision(
  value: unknown,
): value is SupplierRule["default_decision"] {
  return (
    typeof value === "string" &&
    DEFAULT_DECISIONS.includes(value as SupplierRule["default_decision"])
  );
}
