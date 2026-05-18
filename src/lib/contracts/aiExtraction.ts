import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  BillingFrequency,
  ContractConfidence,
  InferredContract,
  PennylaneInvoiceForContractExtraction,
} from "./extraction.ts";

export const AI_CONTRACT_EXTRACTION_PROMPT_VERSION = "2026-05-15.v1";
export const AI_CONTRACT_EXTRACTION_RAW_JSON_KEY = "ai_contract_extraction";

const ContractDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const AiContractExtractionSchema = z
  .object({
    vendorName: z.string().trim().min(1).nullable(),
    canonicalVendorName: z.string().trim().min(1).nullable(),
    productName: z.string().trim().min(1).nullable(),
    planName: z.string().trim().min(1).nullable(),
    billingFrequency: z
      .enum(["monthly", "quarterly", "annual", "unknown"])
      .nullable(),
    currentPeriodStart: ContractDate,
    currentPeriodEnd: ContractDate,
    nextRenewalDate: ContractDate,
    recurringAmountCents: z.number().int().positive().nullable(),
    lastInvoiceAmountCents: z.number().int().positive().nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    seats: z.number().int().positive().nullable(),
    quantity: z.number().int().positive().nullable(),
    isProrata: z.boolean(),
    confidence: z.enum(["high", "medium", "low"]),
    confidenceReason: z.string().trim().min(1),
    missingFields: z.array(z.string().trim().min(1)),
  })
  .strict();

export type AiContractExtractionFields = z.infer<typeof AiContractExtractionSchema>;

export type AiContractExtractionMetadata = {
  error?: string;
  extracted_at: string;
  extracted_fields: AiContractExtractionFields | null;
  model: string;
  prompt_version: string;
  provider: "openai";
  source_text_hash: string;
};

export type AiContractExtractionResult = {
  fields: AiContractExtractionFields;
  metadata: AiContractExtractionMetadata;
};

export type AiExtractionDecision = {
  reason: string;
  shouldAttempt: boolean;
};

export function isAiContractExtractionEnabled(): boolean {
  return isTruthy(process.env.AI_CONTRACT_EXTRACTION_ENABLED);
}

export function getAiContractExtractionModel(): string {
  return process.env.OPENAI_CONTRACT_EXTRACTION_MODEL?.trim() || "gpt-5-mini";
}

export function getAiContractExtractionMetadata(
  rawJson: Record<string, unknown>,
): AiContractExtractionMetadata | null {
  const raw = rawJson[AI_CONTRACT_EXTRACTION_RAW_JSON_KEY];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const parsed = AiContractExtractionMetadataSchema.safeParse(raw);

  return parsed.success ? parsed.data : null;
}

export function buildAiContractSourceText(
  invoice: PennylaneInvoiceForContractExtraction,
): string {
  return [
    `Supplier: ${invoice.supplierName}`,
    invoice.invoiceNumber ? `Invoice number: ${invoice.invoiceNumber}` : null,
    invoice.invoiceDate ? `Invoice date: ${invoice.invoiceDate}` : null,
    invoice.dueDate ? `Due date: ${invoice.dueDate}` : null,
    invoice.currency ? `Currency: ${invoice.currency}` : null,
    invoice.amountCents !== null
      ? `Invoice total cents: ${invoice.amountCents}`
      : null,
    invoice.amountExcludingTaxCents !== null
      ? `Invoice excluding tax cents: ${invoice.amountExcludingTaxCents}`
      : null,
    invoice.label ? `Label: ${invoice.label}` : null,
    "Invoice text and metadata:",
    collectStrings(invoice.rawJson).join("\n"),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 24_000);
}

export function buildAiContractSourceTextHash(
  invoice: PennylaneInvoiceForContractExtraction,
): string {
  return createHash("sha256")
    .update(buildAiContractSourceText(invoice))
    .digest("hex");
}

export function shouldAttemptAiContractExtraction({
  deterministicContract,
  invoice,
}: {
  deterministicContract: InferredContract | null;
  invoice: PennylaneInvoiceForContractExtraction;
}): AiExtractionDecision {
  const sourceText = buildAiContractSourceText(invoice);

  if (sourceText.trim().length < 160) {
    return {
      reason: "not_enough_invoice_text",
      shouldAttempt: false,
    };
  }

  const cached = getAiContractExtractionMetadata(invoice.rawJson);

  if (
    cached?.source_text_hash === buildAiContractSourceTextHash(invoice) &&
    cached.prompt_version === AI_CONTRACT_EXTRACTION_PROMPT_VERSION &&
    cached.extracted_fields
  ) {
    return {
      reason: "fresh_ai_extraction_already_present",
      shouldAttempt: false,
    };
  }

  if (!deterministicContract) {
    return {
      reason: "no_deterministic_contract",
      shouldAttempt: true,
    };
  }

  const missingFields = deterministicContract.extractedFields.missing_fields;
  const missingFieldNames = Array.isArray(missingFields)
    ? missingFields.filter((field): field is string => typeof field === "string")
    : [];

  if (deterministicContract.confidence === "low") {
    return {
      reason: "low_deterministic_confidence",
      shouldAttempt: true,
    };
  }

  if (
    deterministicContract.billingFrequency === "unknown" ||
    !deterministicContract.currentPeriodEnd ||
    !deterministicContract.currentPeriodStart ||
    deterministicContract.recurringAmountCents === null ||
    missingFieldNames.length > 0
  ) {
    return {
      reason: "missing_contract_fields",
      shouldAttempt: true,
    };
  }

  if (
    (!deterministicContract.productName || !deterministicContract.planName) &&
    /\b(plan|subscription|abonnement|seat|license|licence|users?)\b/i.test(sourceText)
  ) {
    return {
      reason: "product_or_plan_missing_from_structured_fields",
      shouldAttempt: true,
    };
  }

  return {
    reason: "deterministic_extraction_sufficient",
    shouldAttempt: false,
  };
}

export async function extractContractFieldsWithAi({
  client,
  invoice,
  model = getAiContractExtractionModel(),
}: {
  client?: OpenAI;
  invoice: PennylaneInvoiceForContractExtraction;
  model?: string;
}): Promise<AiContractExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!client && !apiKey) {
    throw new Error("OPENAI_API_KEY is required when AI contract extraction is enabled.");
  }

  const openai = client ?? new OpenAI({ apiKey });
  const response = await openai.responses.parse({
    input: [
      {
        content: [
          "Extract SaaS contract and subscription fields from Pennylane supplier invoice text.",
          "Return only facts that are explicit in the invoice text, or conservative inferences from invoice period/date history.",
          "Do not invent cancellation terms, owners, or seat counts. Use null when a field is missing.",
          "Amounts must be integer cents in the invoice currency. Distinguish prorata invoice totals from recurring subscription amounts.",
          "Dates must be ISO YYYY-MM-DD. If a period end is the renewal boundary, use that same date as nextRenewalDate.",
        ].join(" "),
        role: "system",
      },
      {
        content: buildAiContractSourceText(invoice),
        role: "user",
      },
    ],
    model,
    text: {
      format: zodTextFormat(
        AiContractExtractionSchema,
        "contract_subscription_extraction",
      ),
    },
  });
  const fields = response.output_parsed;

  if (!fields) {
    throw new Error("OpenAI returned no structured contract extraction.");
  }

  return {
    fields,
    metadata: {
      extracted_at: new Date().toISOString(),
      extracted_fields: fields,
      model,
      prompt_version: AI_CONTRACT_EXTRACTION_PROMPT_VERSION,
      provider: "openai",
      source_text_hash: buildAiContractSourceTextHash(invoice),
    },
  };
}

export function normalizeAiBillingFrequency(
  value: string | null | undefined,
): BillingFrequency {
  return value === "monthly" ||
    value === "quarterly" ||
    value === "annual" ||
    value === "unknown"
    ? value
    : "unknown";
}

export function normalizeAiConfidence(
  value: string | null | undefined,
): ContractConfidence | null {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : null;
}

export function buildAiContractExtractionErrorMetadata({
  error,
  invoice,
  model = getAiContractExtractionModel(),
}: {
  error: unknown;
  invoice: PennylaneInvoiceForContractExtraction;
  model?: string;
}): AiContractExtractionMetadata {
  return {
    error: error instanceof Error ? error.message : "AI contract extraction failed.",
    extracted_at: new Date().toISOString(),
    extracted_fields: null,
    model,
    prompt_version: AI_CONTRACT_EXTRACTION_PROMPT_VERSION,
    provider: "openai",
    source_text_hash: buildAiContractSourceTextHash(invoice),
  };
}

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();

  return value === "1" || normalized === "true" || normalized === "yes";
}

const AiContractExtractionMetadataSchema = z
  .object({
    error: z.string().optional(),
    extracted_at: z.string(),
    extracted_fields: AiContractExtractionSchema.nullable(),
    model: z.string(),
    prompt_version: z.string(),
    provider: z.literal("openai"),
    source_text_hash: z.string(),
  })
  .strict();

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== AI_CONTRACT_EXTRACTION_RAW_JSON_KEY)
      .flatMap(([, child]) => collectStrings(child, depth + 1));
  }

  return [];
}
