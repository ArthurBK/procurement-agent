import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getAiContractExtractionModel } from "./aiExtraction.ts";
import type { ContractForMatching, SsoSupplierForMatching } from "./matching.ts";

export const AI_CONTRACT_MATCHING_PROMPT_VERSION = "2026-05-15.v1";

const AiContractMatchSchema = z
  .object({
    confidence: z.enum(["high", "medium", "low"]),
    isSameVendorOrProduct: z.boolean(),
    reason: z.string().trim().min(1),
  })
  .strict();

export type AiContractMatchFields = z.infer<typeof AiContractMatchSchema>;

export type AiContractMatchResult = {
  fields: AiContractMatchFields;
  model: string;
  promptVersion: string;
};

export async function reviewContractMatchWithAi({
  client,
  contract,
  deterministicReason,
  deterministicScore,
  model = getAiContractExtractionModel(),
  supplier,
}: {
  client?: OpenAI;
  contract: ContractForMatching;
  deterministicReason: string;
  deterministicScore: number;
  model?: string;
  supplier: SsoSupplierForMatching;
}): Promise<AiContractMatchResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!client && !apiKey) {
    throw new Error("OPENAI_API_KEY is required for AI contract matching.");
  }

  const openai = client ?? new OpenAI({ apiKey });
  const response = await openai.responses.parse({
    input: [
      {
        content: [
          "Decide whether a paid Pennylane supplier contract and a Google Workspace-visible app refer to the same SaaS vendor, product, or first-party subproduct.",
          "Confirm exact vendor matches, known product aliases, and first-party subproducts that share the same vendor domain.",
          "Do not confirm if the app is only a generic word, a reseller, an unrelated product, or a weak name overlap.",
          "Return a conservative decision with a short reason.",
        ].join(" "),
        role: "system",
      },
      {
        content: buildAiContractMatchSourceText({
          contract,
          deterministicReason,
          deterministicScore,
          supplier,
        }),
        role: "user",
      },
    ],
    model,
    text: {
      format: zodTextFormat(AiContractMatchSchema, "contract_sso_match_review"),
    },
  });
  const fields = response.output_parsed;

  if (!fields) {
    throw new Error("OpenAI returned no structured contract match review.");
  }

  return {
    fields,
    model,
    promptVersion: AI_CONTRACT_MATCHING_PROMPT_VERSION,
  };
}

function buildAiContractMatchSourceText({
  contract,
  deterministicReason,
  deterministicScore,
  supplier,
}: {
  contract: ContractForMatching;
  deterministicReason: string;
  deterministicScore: number;
  supplier: SsoSupplierForMatching;
}): string {
  return [
    "Paid contract from Pennylane:",
    `Vendor name: ${contract.vendor_name}`,
    `Normalized vendor name: ${contract.normalized_vendor_name || "unknown"}`,
    `Contract status: ${contract.status}`,
    "",
    "Google Workspace-visible app:",
    `App name: ${supplier.supplier_name}`,
    `App domain: ${supplier.supplier_domain ?? "unknown"}`,
    `Identity mode: ${supplier.identity_mode ?? "unknown"}`,
    `Users with signal in last 90 days: ${supplier.users_with_signal_90d ?? 0}`,
    "",
    "Deterministic matcher:",
    `Reason: ${deterministicReason}`,
    `Score: ${deterministicScore}`,
  ].join("\n");
}
