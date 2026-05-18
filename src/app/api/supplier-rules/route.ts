import type { SupplierRule } from "@/lib/supplierRules/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type SupplierRuleExample = {
  candidateId?: string;
  supplier?: string;
  amountCents?: number;
  frequency?: string;
  paymentMethod?: string | null;
};

type CreateSupplierRuleBody = {
  supplierKey?: string;
  canonicalSupplier?: string;
  businessCategory?: string;
  defaultDecision?: string;
  notes?: string | null;
  example?: SupplierRuleExample;
};

type ExistingSupplierRule = SupplierRule & {
  examples: unknown;
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateSupplierRuleBody;
    const validation = validateBody(body);

    if (!validation.ok) {
      return Response.json({ errors: [validation.error] }, { status: 400 });
    }

    const now = new Date().toISOString();
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: existingRule, error: existingRuleError } = await supabaseAdmin
      .from("supplier_rules")
      .select("*")
      .eq("supplier_key", validation.value.supplierKey)
      .eq("match_type", "exact_supplier_key")
      .maybeSingle();

    if (existingRuleError) {
      return Response.json(
        {
          errors: [
            `Unable to load existing supplier rule: ${existingRuleError.message}`,
          ],
        },
        { status: 500 },
      );
    }

    const examples = appendExample(
      ((existingRule as ExistingSupplierRule | null)?.examples ?? []) as unknown,
      body.example,
    );

    if (existingRule) {
      const updatePayload = {
        active: true,
        business_category: validation.value.businessCategory,
        canonical_supplier: validation.value.canonicalSupplier,
        default_decision: validation.value.defaultDecision,
        examples,
        last_seen_at: now,
        notes:
          body.notes !== undefined
            ? body.notes
            : (existingRule as ExistingSupplierRule).notes,
        updated_at: now,
      };
      const { data: rule, error: updateError } = await supabaseAdmin
        .from("supplier_rules")
        .update(updatePayload)
        .eq("id", String(existingRule.id))
        .select("*")
        .single();

      if (updateError) {
        return Response.json(
          { errors: [`Unable to update supplier rule: ${updateError.message}`] },
          { status: 500 },
        );
      }

      return Response.json({ rule });
    }

    const { data: rule, error: insertError } = await supabaseAdmin
      .from("supplier_rules")
      .insert({
        active: true,
        business_category: validation.value.businessCategory,
        canonical_supplier: validation.value.canonicalSupplier,
        default_decision: validation.value.defaultDecision,
        examples,
        last_seen_at: now,
        match_type: "exact_supplier_key",
        notes: body.notes ?? null,
        source: "user",
        supplier_key: validation.value.supplierKey,
      })
      .select("*")
      .single();

    if (insertError) {
      return Response.json(
        { errors: [`Unable to create supplier rule: ${insertError.message}`] },
        { status: 500 },
      );
    }

    return Response.json({ rule });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected supplier rule creation error.";

    return Response.json({ errors: [message] }, { status: 500 });
  }
}

function validateBody(
  body: CreateSupplierRuleBody,
):
  | {
      ok: true;
      value: {
        supplierKey: string;
        canonicalSupplier: string;
        businessCategory: SupplierRule["business_category"];
        defaultDecision: SupplierRule["default_decision"];
      };
    }
  | { ok: false; error: string } {
  const supplierKey = body.supplierKey?.trim();
  const canonicalSupplier = body.canonicalSupplier?.trim();

  if (!supplierKey) {
    return { error: "supplierKey is required.", ok: false };
  }

  if (!canonicalSupplier) {
    return { error: "canonicalSupplier is required.", ok: false };
  }

  if (!isBusinessCategory(body.businessCategory)) {
    return { error: "businessCategory is invalid.", ok: false };
  }

  if (!isDefaultDecision(body.defaultDecision)) {
    return { error: "defaultDecision is invalid.", ok: false };
  }

  return {
    ok: true,
    value: {
      businessCategory: body.businessCategory,
      canonicalSupplier,
      defaultDecision: body.defaultDecision,
      supplierKey,
    },
  };
}

function appendExample(
  existingExamples: unknown,
  example: SupplierRuleExample | undefined,
): unknown[] {
  const examples = Array.isArray(existingExamples) ? [...existingExamples] : [];

  if (example) {
    examples.push(example);
  }

  return examples;
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
