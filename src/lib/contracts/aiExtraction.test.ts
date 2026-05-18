import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONTRACT_EXTRACTION_PROMPT_VERSION,
  AI_CONTRACT_EXTRACTION_RAW_JSON_KEY,
  buildAiContractSourceTextHash,
  shouldAttemptAiContractExtraction,
} from "./aiExtraction.ts";
import type {
  InferredContract,
  PennylaneInvoiceForContractExtraction,
} from "./extraction.ts";

test("AI extraction is attempted for low-confidence invoice text", () => {
  const decision = shouldAttemptAiContractExtraction({
    deterministicContract: contract({ confidence: "low" }),
    invoice: invoice(),
  });

  assert.equal(decision.shouldAttempt, true);
  assert.equal(decision.reason, "low_deterministic_confidence");
});

test("AI extraction is skipped when fresh metadata is already present", () => {
  const baseInvoice = invoice();
  const cachedInvoice = {
    ...baseInvoice,
    rawJson: {
      ...baseInvoice.rawJson,
      [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: {
        extracted_at: "2026-05-15T00:00:00.000Z",
        extracted_fields: {
          billingFrequency: "monthly",
          canonicalVendorName: "Notion",
          confidence: "high",
          confidenceReason: "Exact period found.",
          currency: "EUR",
          currentPeriodEnd: "2026-06-01",
          currentPeriodStart: "2026-05-01",
          isProrata: false,
          lastInvoiceAmountCents: 2400,
          missingFields: [],
          nextRenewalDate: "2026-06-01",
          planName: "Business",
          productName: "Notion",
          quantity: null,
          recurringAmountCents: 2400,
          seats: null,
          vendorName: "Notion Labs, Inc.",
        },
        model: "gpt-5-mini",
        prompt_version: AI_CONTRACT_EXTRACTION_PROMPT_VERSION,
        provider: "openai",
        source_text_hash: buildAiContractSourceTextHash(baseInvoice),
      },
    },
  } satisfies PennylaneInvoiceForContractExtraction;
  const decision = shouldAttemptAiContractExtraction({
    deterministicContract: contract({ confidence: "low" }),
    invoice: cachedInvoice,
  });

  assert.equal(decision.shouldAttempt, false);
  assert.equal(decision.reason, "fresh_ai_extraction_already_present");
});

test("AI extraction is skipped for strong deterministic contracts", () => {
  const decision = shouldAttemptAiContractExtraction({
    deterministicContract: contract({
      billingFrequency: "monthly",
      confidence: "high",
      currentPeriodEnd: "2026-06-01",
      currentPeriodStart: "2026-05-01",
      extractedFields: { missing_fields: [] },
      planName: "Business",
      productName: "Notion",
      recurringAmountCents: 2400,
    }),
    invoice: invoice(),
  });

  assert.equal(decision.shouldAttempt, false);
  assert.equal(decision.reason, "deterministic_extraction_sufficient");
});

function invoice(
  overrides: Partial<PennylaneInvoiceForContractExtraction> = {},
): PennylaneInvoiceForContractExtraction {
  return {
    amountCents: 2400,
    amountExcludingTaxCents: 2000,
    currency: "EUR",
    dueDate: null,
    externalId: "invoice-1",
    invoiceDate: "2026-05-01",
    invoiceNumber: "INV-1",
    issueDate: "2026-05-01",
    label: "Business subscription invoice",
    rawJson: {
      pdf_text:
        "Notion Labs, Inc. Business subscription invoice for workspace seats. Service terms and billing details are listed in this attached supplier invoice.",
    },
    supplierExternalId: "supplier-1",
    supplierName: "Notion",
    ...overrides,
  };
}

function contract(overrides: Partial<InferredContract> = {}): InferredContract {
  return {
    billingFrequency: "unknown",
    confidence: "low",
    confidenceReason: "Not enough invoice metadata.",
    currency: "EUR",
    currentPeriodEnd: null,
    currentPeriodStart: null,
    extractedFields: { missing_fields: ["period"] },
    lastInvoiceAmountCents: 2400,
    nextRenewalDate: null,
    normalizedVendorName: "notion",
    planName: null,
    productName: null,
    quantity: null,
    recurringAmountCents: null,
    seats: null,
    sourceDocumentExternalId: "invoice-1",
    sourceExternalId: "pennylane:notion:EUR:unknown",
    sourceSystem: "pennylane",
    status: "needs_review",
    vendorName: "Notion",
    ...overrides,
  };
}
