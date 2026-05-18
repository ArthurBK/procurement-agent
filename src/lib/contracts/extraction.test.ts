import assert from "node:assert/strict";
import test from "node:test";
import { AI_CONTRACT_EXTRACTION_RAW_JSON_KEY } from "./aiExtraction.ts";
import {
  inferContractsFromPennylaneInvoices,
  inferFrequencyFromInvoiceHistory,
  type PennylaneInvoiceForContractExtraction,
} from "./extraction.ts";

test("infers monthly contract from explicit service period", () => {
  const [contract] = inferContractsFromPennylaneInvoices([
    invoice({
      externalId: "notion-1",
      invoiceDate: "2026-01-01",
      rawJson: {
        lines: [
          {
            label: "Business plan 2026-01-01 to 2026-02-01",
            period_end: "2026-02-01",
            period_start: "2026-01-01",
          },
        ],
      },
      supplierName: "Notion Labs Inc.",
    }),
    invoice({
      externalId: "notion-2",
      invoiceDate: "2026-02-01",
      rawJson: {
        lines: [
          {
            period_end: "2026-03-01",
            period_start: "2026-02-01",
          },
        ],
      },
      supplierName: "Notion Labs Inc.",
    }),
  ]);

  assert.equal(contract.billingFrequency, "monthly");
  assert.equal(contract.currentPeriodStart, "2026-02-01");
  assert.equal(contract.currentPeriodEnd, "2026-03-01");
  assert.equal(contract.nextRenewalDate, "2026-03-01");
  assert.equal(contract.confidence, "high");
});

test("infers annual contract from explicit service period", () => {
  const [contract] = inferContractsFromPennylaneInvoices([
    invoice({
      externalId: "vercel-annual",
      invoiceDate: "2026-01-01",
      rawJson: {
        period_end: "2027-01-01",
        period_start: "2026-01-01",
      },
      supplierName: "Vercel Inc.",
    }),
  ]);

  assert.equal(contract.billingFrequency, "annual");
  assert.equal(contract.nextRenewalDate, "2027-01-01");
});

test("extracts textual invoice periods from PDF text", () => {
  const [contract] = inferContractsFromPennylaneInvoices([
    invoice({
      externalId: "vercel-1",
      invoiceDate: "2026-04-26",
      rawJson: {
        pdf_text:
          "Vercel Inc. Description Pro Apr 26–May 25, 2026 Additional Team Seats",
      },
      supplierName: "Vercel Inc.",
    }),
  ]);

  assert.equal(contract.billingFrequency, "monthly");
  assert.equal(contract.currentPeriodStart, "2026-04-26");
  assert.equal(contract.currentPeriodEnd, "2026-05-25");
});

test("extracts French textual invoice periods from PDF text", () => {
  const [contract] = inferContractsFromPennylaneInvoices([
    invoice({
      amountCents: 10123,
      externalId: "aircall-1",
      invoiceDate: "2025-07-22",
      rawJson: {
        pdf_text:
          "Standard User License Essentials 22 juil. 2025 - 21 août 2025 3 28,00 € 1 84,00 €",
      },
      supplierName: "Aircall SAS",
    }),
  ]);

  assert.equal(contract.billingFrequency, "monthly");
  assert.equal(contract.currentPeriodStart, "2025-07-22");
  assert.equal(contract.currentPeriodEnd, "2025-08-21");
  assert.equal(contract.nextRenewalDate, "2025-08-21");
});

test("detects prorata as low confidence without certain recurring amount", () => {
  const [contract] = inferContractsFromPennylaneInvoices([
    invoice({
      label: "Prorata adjustment for plan upgrade",
      rawJson: {
        period_end: "2026-02-01",
        period_start: "2026-01-01",
      },
    }),
  ]);

  assert.equal(contract.billingFrequency, "monthly");
  assert.equal(contract.confidence, "low");
  assert.equal(contract.recurringAmountCents, null);
});

test("keeps missing period contracts low confidence", () => {
  const [contract] = inferContractsFromPennylaneInvoices([
    invoice({
      invoiceDate: "2026-05-09",
      rawJson: { label: "Consulting invoice" },
    }),
  ]);

  assert.equal(contract.billingFrequency, "unknown");
  assert.equal(contract.confidence, "low");
  assert.equal(contract.currentPeriodEnd, null);
  assert.equal(contract.currentPeriodStart, null);
  assert.equal(contract.nextRenewalDate, "2026-05-09");
  assert.equal(
    contract.extractedFields.next_renewal_date_source,
    "invoice_payment_date",
  );
});

test("uses AI extraction metadata to fill missing contract fields", () => {
  const [contract] = inferContractsFromPennylaneInvoices([
    invoice({
      amountCents: 1200,
      externalId: "notion-ai",
      invoiceDate: "2026-05-01",
      rawJson: {
        pdf_text: "Notion invoice with terse PDF text.",
        [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: {
          extracted_at: "2026-05-15T00:00:00.000Z",
          extracted_fields: {
            billingFrequency: "monthly",
            canonicalVendorName: "Notion",
            confidence: "high",
            confidenceReason: "The invoice states an exact monthly service period.",
            currency: "EUR",
            currentPeriodEnd: "2026-06-01",
            currentPeriodStart: "2026-05-01",
            isProrata: false,
            lastInvoiceAmountCents: 1200,
            missingFields: [],
            nextRenewalDate: "2026-06-01",
            planName: "Business",
            productName: "Notion",
            quantity: 3,
            recurringAmountCents: 1200,
            seats: 3,
            vendorName: "Notion Labs, Inc.",
          },
          model: "gpt-5-mini",
          prompt_version: "2026-05-15.v1",
          provider: "openai",
          source_text_hash: "hash",
        },
      },
      supplierName: "Notion Labs, Inc.",
    }),
  ]);

  assert.equal(contract.billingFrequency, "monthly");
  assert.equal(contract.currentPeriodStart, "2026-05-01");
  assert.equal(contract.currentPeriodEnd, "2026-06-01");
  assert.equal(contract.recurringAmountCents, 1200);
  assert.equal(contract.planName, "Business");
  assert.equal(contract.seats, 3);
  assert.equal(contract.extractedFields.ai_used, true);
});

test("keeps deterministic period over conflicting AI extraction metadata", () => {
  const [contract] = inferContractsFromPennylaneInvoices([
    invoice({
      rawJson: {
        period_end: "2026-06-01",
        period_start: "2026-05-01",
        [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: {
          extracted_at: "2026-05-15T00:00:00.000Z",
          extracted_fields: {
            billingFrequency: "annual",
            canonicalVendorName: "OpenAI",
            confidence: "high",
            confidenceReason: "Conflicting AI period.",
            currency: "EUR",
            currentPeriodEnd: "2027-05-01",
            currentPeriodStart: "2026-05-01",
            isProrata: false,
            lastInvoiceAmountCents: 2400,
            missingFields: [],
            nextRenewalDate: "2027-05-01",
            planName: null,
            productName: "OpenAI",
            quantity: null,
            recurringAmountCents: 2400,
            seats: null,
            vendorName: "OpenAI LLC",
          },
          model: "gpt-5-mini",
          prompt_version: "2026-05-15.v1",
          provider: "openai",
          source_text_hash: "hash",
        },
      },
    }),
  ]);
  const conflicts = contract.extractedFields.ai_conflicts;

  assert.equal(contract.billingFrequency, "monthly");
  assert.equal(contract.currentPeriodEnd, "2026-06-01");
  assert.equal(Array.isArray(conflicts), true);
  assert.equal((conflicts as Array<unknown>).length > 0, true);
});

test("groups invoices by AI extracted vendor and product when Pennylane supplier is generic", () => {
  const contracts = inferContractsFromPennylaneInvoices([
    invoice({
      amountCents: 8400,
      externalId: "aircall-1",
      invoiceDate: "2026-05-01",
      rawJson: {
        [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: aiExtractionFields({
          canonicalVendorName: "Aircall",
          productName: "Aircall Essentials",
          vendorName: "Aircall SAS",
        }),
      },
      supplierName: "SWIFTGUM",
    }),
    invoice({
      amountCents: 4990,
      externalId: "notion-calendar-1",
      invoiceDate: "2026-05-09",
      rawJson: {
        [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: aiExtractionFields({
          canonicalVendorName: "Notion",
          productName: "Notion Calendar",
          vendorName: "Notion Labs, Inc.",
        }),
      },
      supplierName: "SWIFTGUM",
    }),
  ]);

  assert.equal(contracts.length, 2);
  assert.deepEqual(
    contracts.map((contract) => contract.productName).sort(),
    ["Aircall Essentials", "Notion Calendar"],
  );
  assert.deepEqual(
    contracts.map((contract) => contract.sourceExternalId).sort(),
    [
      "pennylane:aircall:aircall essentials:EUR:monthly",
      "pennylane:notion:notion calendar:EUR:monthly",
    ],
  );
});

test("merges similar product variants for the same vendor amount and frequency", () => {
  const contracts = inferContractsFromPennylaneInvoices([
    invoice({
      amountCents: 8400,
      externalId: "aircall-1",
      invoiceDate: "2025-06-22",
      rawJson: {
        period_end: "2025-07-21",
        period_start: "2025-06-22",
        [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: aiExtractionFields({
          canonicalVendorName: "Aircall",
          productName: "Standard User License",
          vendorName: "Aircall SAS",
        }),
      },
      supplierName: "SWIFTGUM",
    }),
    invoice({
      amountCents: 8400,
      externalId: "aircall-2",
      invoiceDate: "2025-08-22",
      rawJson: {
        period_end: "2025-09-21",
        period_start: "2025-08-22",
        [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: aiExtractionFields({
          canonicalVendorName: "Aircall",
          productName: "Standard User License Essentials",
          vendorName: "Aircall SAS",
        }),
      },
      supplierName: "SWIFTGUM",
    }),
  ]);

  assert.equal(contracts.length, 1);
  assert.equal(contracts[0].productName, "Standard User License Essentials");
  assert.equal(contracts[0].nextRenewalDate, "2025-09-21");
  assert.equal(contracts[0].sourceExternalId, "pennylane:aircall:standard user license essentials:EUR:monthly");
  assert.deepEqual(
    contracts[0].extractedFields.product_name_variants,
    ["Standard User License", "Standard User License Essentials"],
  );
});

test("keeps distinct products separate for the same vendor", () => {
  const contracts = inferContractsFromPennylaneInvoices([
    invoice({
      amountCents: 4985,
      externalId: "notion-calendar-1",
      rawJson: {
        [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: aiExtractionFields({
          canonicalVendorName: "Notion",
          productName: "Notion Calendar",
          vendorName: "Notion Labs, Inc.",
        }),
      },
      supplierName: "SWIFTGUM",
    }),
    invoice({
      amountCents: 4985,
      externalId: "notion-mail-1",
      rawJson: {
        [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: aiExtractionFields({
          canonicalVendorName: "Notion",
          productName: "Notion Mail",
          vendorName: "Notion Labs, Inc.",
        }),
      },
      supplierName: "SWIFTGUM",
    }),
  ]);

  assert.equal(contracts.length, 2);
  assert.deepEqual(
    contracts.map((contract) => contract.productName).sort(),
    ["Notion Calendar", "Notion Mail"],
  );
});

test("infers monthly frequency from recurring invoice history", () => {
  assert.equal(
    inferFrequencyFromInvoiceHistory([
      invoice({ externalId: "openai-1", invoiceDate: "2026-01-01" }),
      invoice({ externalId: "openai-2", invoiceDate: "2026-02-01" }),
      invoice({ externalId: "openai-3", invoiceDate: "2026-03-01" }),
    ]),
    "monthly",
  );
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
    invoiceDate: "2026-01-01",
    invoiceNumber: "INV-1",
    issueDate: "2026-01-01",
    label: null,
    rawJson: {},
    supplierExternalId: "supplier-1",
    supplierName: "OpenAI LLC",
    ...overrides,
  };
}

function aiExtractionFields(
  fields: {
    canonicalVendorName: string;
    productName: string;
    vendorName: string;
  },
): Record<string, unknown> {
  return {
    extracted_at: "2026-05-15T00:00:00.000Z",
    extracted_fields: {
      billingFrequency: "monthly",
      canonicalVendorName: fields.canonicalVendorName,
      confidence: "high",
      confidenceReason: "The invoice states a monthly subscription.",
      currency: "EUR",
      currentPeriodEnd: "2026-06-01",
      currentPeriodStart: "2026-05-01",
      isProrata: false,
      lastInvoiceAmountCents: 8400,
      missingFields: [],
      nextRenewalDate: "2026-06-01",
      planName: null,
      productName: fields.productName,
      quantity: null,
      recurringAmountCents: 8400,
      seats: null,
      vendorName: fields.vendorName,
    },
    model: "gpt-5-mini",
    prompt_version: "2026-05-18.v2",
    provider: "openai",
    source_text_hash: "hash",
  };
}
