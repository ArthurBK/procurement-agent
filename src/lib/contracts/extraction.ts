import {
  addMonths,
  addQuarters,
  addYears,
  differenceInCalendarDays,
  parseISO,
} from "date-fns";
import { createHash } from "node:crypto";
import {
  AI_CONTRACT_EXTRACTION_RAW_JSON_KEY,
  getAiContractExtractionMetadata,
  normalizeAiBillingFrequency,
  normalizeAiConfidence,
  type AiContractExtractionFields,
} from "./aiExtraction.ts";
import { diceCoefficient, normalizeContractVendorName } from "./normalization.ts";

export type BillingFrequency = "monthly" | "quarterly" | "annual" | "unknown";
export type ContractConfidence = "high" | "medium" | "low";

export type PennylaneInvoiceForContractExtraction = {
  externalId: string;
  id?: string;
  invoiceDate: string | null;
  issueDate: string | null;
  dueDate: string | null;
  supplierExternalId: string | null;
  supplierName: string;
  invoiceNumber: string | null;
  amountCents: number | null;
  amountExcludingTaxCents: number | null;
  currency: string;
  label: string | null;
  rawJson: Record<string, unknown>;
  sourceHash?: string;
};

export type InferredContract = {
  vendorName: string;
  normalizedVendorName: string;
  productName: string | null;
  planName: string | null;
  status: "active" | "needs_review" | "possibly_cancelled";
  sourceSystem: "pennylane";
  sourceDocumentExternalId: string;
  sourceExternalId: string;
  billingFrequency: BillingFrequency;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextRenewalDate: string | null;
  recurringAmountCents: number | null;
  lastInvoiceAmountCents: number | null;
  currency: string;
  quantity: number | null;
  seats: number | null;
  confidence: ContractConfidence;
  confidenceReason: string;
  extractedFields: Record<string, unknown>;
};

type Period = {
  start: string;
  end: string;
  source: string;
};

export function inferContractsFromPennylaneInvoices(
  invoices: PennylaneInvoiceForContractExtraction[],
): InferredContract[] {
  const groups = new Map<string, PennylaneInvoiceForContractExtraction[]>();

  for (const invoice of invoices) {
    const vendorKey = normalizeContractVendorName(
      getInvoiceGroupingVendorName(invoice),
    );

    if (!vendorKey) {
      continue;
    }

    const productKey =
      normalizeContractVendorName(getInvoiceGroupingProductName(invoice)) ||
      "default";
    const groupKey = [
      vendorKey,
      productKey,
      invoice.currency.toUpperCase(),
    ].join("|");
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), invoice]);
  }

  return mergeSimilarContractProductVariants(
    Array.from(groups.values()).flatMap(inferContractForInvoiceGroup),
  );
}

export function inferContractForInvoiceGroup(
  invoices: PennylaneInvoiceForContractExtraction[],
): InferredContract[] {
  const orderedInvoices = invoices
    .filter((invoice) => invoice.supplierName.trim())
    .sort((left, right) =>
      getInvoiceDate(left).localeCompare(getInvoiceDate(right)),
    );
  const latestInvoice = orderedInvoices.at(-1);

  if (!latestInvoice) {
    return [];
  }

  const normalizedVendorName = normalizeContractVendorName(
    latestInvoice.supplierName,
  );
  const aiMetadata = getAiContractExtractionMetadata(latestInvoice.rawJson);
  const aiFields = aiMetadata?.extracted_fields ?? null;
  const explicitPeriod = findInvoicePeriod(latestInvoice);
  const aiPeriod = findAiPeriod(aiFields);
  const periodCandidate = explicitPeriod ?? aiPeriod;
  const frequencyFromPeriod = periodCandidate
    ? inferFrequencyFromPeriod(periodCandidate)
    : "unknown";
  const frequencyFromHistory = inferFrequencyFromInvoiceHistory(orderedInvoices);
  const frequencyFromAi = normalizeAiBillingFrequency(aiFields?.billingFrequency);
  const billingFrequency =
    frequencyFromPeriod !== "unknown"
      ? frequencyFromPeriod
      : frequencyFromHistory !== "unknown"
        ? frequencyFromHistory
        : frequencyFromAi;
  const invoiceDate = getInvoiceDate(latestInvoice);
  const explicitInvoiceDate = getExplicitInvoiceDate(latestInvoice);
  const period =
    periodCandidate ?? inferPeriodFromInvoiceDate(invoiceDate, billingFrequency);
  const nextRenewalDate = period?.end ?? explicitInvoiceDate;
  const nextRenewalDateSource = period
    ? "period_end"
    : explicitInvoiceDate
      ? "invoice_payment_date"
      : null;
  const prorata = isLikelyProrata(latestInvoice) || aiFields?.isProrata === true;
  const amountStable = hasStableAmounts(orderedInvoices);
  const deterministicRecurringAmountCents =
    prorata || billingFrequency === "unknown"
      ? null
      : amountStable || explicitPeriod
        ? latestInvoice.amountCents
        : null;
  const recurringAmountCents =
    deterministicRecurringAmountCents ??
    selectAiRecurringAmount({
      aiFields,
      billingFrequency,
      latestInvoiceAmountCents: latestInvoice.amountCents,
      prorata,
    });
  const deterministicConfidence = inferConfidence({
    billingFrequency,
    explicitPeriod: periodCandidate,
    invoiceCount: orderedInvoices.length,
    prorata,
    recurringAmountCents,
  });
  const usedAiFields = getUsedAiFields({
    aiFields,
    billingFrequency,
    deterministicRecurringAmountCents,
    explicitPeriod,
    period,
    recurringAmountCents,
  });
  const confidence = mergeConfidence({
    aiFields,
    deterministicConfidence,
    recurringAmountCents,
    usedAiFields,
  });
  const aiConflicts = buildAiConflicts({
    aiFields,
    deterministicRecurringAmountCents,
    explicitPeriod,
    frequencyFromHistory,
  });
  const vendorName = selectVendorName({ aiFields, latestInvoice });
  const normalizedSelectedVendorName = normalizeContractVendorName(vendorName);
  const productName =
    extractProductName(latestInvoice) ?? aiFields?.productName ?? null;
  const sourceExternalId = buildContractSourceExternalId({
    billingFrequency,
    currency: latestInvoice.currency,
    normalizedVendorName: normalizedSelectedVendorName || normalizedVendorName,
    productName,
  });

  return [
    {
      billingFrequency,
      confidence,
      confidenceReason: buildMergedConfidenceReason({
        aiFields,
        aiUsed: usedAiFields.length > 0,
        baseReason: buildConfidenceReason({
          amountStable,
          billingFrequency,
          explicitPeriod: periodCandidate,
          frequencyFromHistory,
          invoiceCount: orderedInvoices.length,
          prorata,
        }),
      }),
      currency: latestInvoice.currency.toUpperCase(),
      currentPeriodEnd: period?.end ?? null,
      currentPeriodStart: period?.start ?? null,
      extractedFields: {
        ai_confidence: aiFields?.confidence ?? null,
        ai_conflicts: aiConflicts,
        ai_extracted_fields: aiFields,
        ai_missing_fields: aiFields?.missingFields ?? [],
        ai_model: aiMetadata?.model ?? null,
        ai_prompt_version: aiMetadata?.prompt_version ?? null,
        ai_source_text_hash: aiMetadata?.source_text_hash ?? null,
        ai_used: usedAiFields.length > 0,
        ai_used_fields: usedAiFields,
        amount_stable: amountStable,
        invoice_external_ids: orderedInvoices.map((invoice) => invoice.externalId),
        invoice_dates: orderedInvoices.map(getInvoiceDate),
        latest_invoice_external_id: latestInvoice.externalId,
        missing_fields: getMissingFields({ billingFrequency, period }),
        next_renewal_date_source: nextRenewalDateSource,
        period_source: period?.source ?? null,
        prorata_detected: prorata,
      },
      lastInvoiceAmountCents: latestInvoice.amountCents,
      nextRenewalDate,
      normalizedVendorName: normalizedSelectedVendorName || normalizedVendorName,
      planName: extractPlanName(latestInvoice) ?? aiFields?.planName ?? null,
      productName,
      quantity: extractQuantity(latestInvoice) ?? aiFields?.quantity ?? null,
      recurringAmountCents,
      seats: extractSeats(latestInvoice) ?? aiFields?.seats ?? null,
      sourceDocumentExternalId: latestInvoice.externalId,
      sourceExternalId,
      sourceSystem: "pennylane",
      status: confidence === "high" ? "active" : "needs_review",
      vendorName,
    },
  ];
}

export function buildInvoiceSourceHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");
}

export function inferFrequencyFromInvoiceHistory(
  invoices: PennylaneInvoiceForContractExtraction[],
): BillingFrequency {
  const dates = invoices
    .map(getInvoiceDate)
    .filter(Boolean)
    .sort()
    .map((date) => parseISO(date));
  const deltas = dates
    .slice(1)
    .map((date, index) => differenceInCalendarDays(date, dates[index]))
    .filter((delta) => delta > 0);

  if (deltas.length === 0) {
    return "unknown";
  }

  const medianDelta = median(deltas);

  if (medianDelta >= 25 && medianDelta <= 35) {
    return "monthly";
  }

  if (medianDelta >= 80 && medianDelta <= 100) {
    return "quarterly";
  }

  if (medianDelta >= 330 && medianDelta <= 395) {
    return "annual";
  }

  return "unknown";
}

function findInvoicePeriod(
  invoice: PennylaneInvoiceForContractExtraction,
): Period | null {
  const fieldPeriod = findPeriodFields(invoice.rawJson);

  if (fieldPeriod) {
    return fieldPeriod;
  }

  return findPeriodInText(collectInvoiceText(invoice));
}

function findAiPeriod(fields: AiContractExtractionFields | null): Period | null {
  if (!fields?.currentPeriodStart || !fields.currentPeriodEnd) {
    return null;
  }

  return {
    end: fields.currentPeriodEnd,
    source: "ai_contract_extraction",
    start: fields.currentPeriodStart,
  };
}

function findPeriodFields(value: unknown): Period | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const period = findPeriodFields(item);

      if (period) {
        return period;
      }
    }

    return null;
  }

  const record = value as Record<string, unknown>;
  const start = findDateValue(record, [
    "period_start",
    "periodStart",
    "current_period_start",
    "service_period_start",
    "start_date",
    "from",
  ]);
  const end = findDateValue(record, [
    "period_end",
    "periodEnd",
    "current_period_end",
    "service_period_end",
    "end_date",
    "to",
  ]);

  if (start && end) {
    return { end, source: "invoice_fields", start };
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === AI_CONTRACT_EXTRACTION_RAW_JSON_KEY) {
      continue;
    }

    const period = findPeriodFields(child);

    if (period) {
      return period;
    }
  }

  return null;
}

function findDateValue(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const raw = record[key];

    if (typeof raw === "string") {
      const date = normalizeDate(raw);

      if (date) {
        return date;
      }
    }
  }

  return null;
}

function findPeriodInText(text: string): Period | null {
  const isoMatch = text.match(
    /(\d{4}-\d{2}-\d{2})\s*(?:to|au|-|–|—)\s*(\d{4}-\d{2}-\d{2})/i,
  );

  if (isoMatch) {
    return {
      end: isoMatch[2],
      source: "invoice_text",
      start: isoMatch[1],
    };
  }

  const europeanMatch = text.match(
    /(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:to|au|-|–|—)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  );

  if (europeanMatch) {
    const start = normalizeDate(europeanMatch[1]);
    const end = normalizeDate(europeanMatch[2]);

    if (start && end) {
      return {
        end,
        source: "invoice_text",
        start,
      };
    }
  }

  const textualMatch = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\s*(?:to|au|-|–|—)\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );

  if (textualMatch) {
    const [, startMonthRaw, startDayRaw, endMonthRaw, endDayRaw, endYearRaw] =
      textualMatch;
    const startMonth = monthIndex(startMonthRaw);
    const endMonth = monthIndex(endMonthRaw);
    const endYear = Number(endYearRaw);

    if (startMonth !== null && endMonth !== null && Number.isFinite(endYear)) {
      const startYear = startMonth > endMonth ? endYear - 1 : endYear;

      return {
        end: [
          endYear,
          String(endMonth + 1).padStart(2, "0"),
          endDayRaw.padStart(2, "0"),
        ].join("-"),
        source: "invoice_text",
        start: [
          startYear,
          String(startMonth + 1).padStart(2, "0"),
          startDayRaw.padStart(2, "0"),
        ].join("-"),
      };
    }
  }

  const dayMonthTextualMatch = text.match(
    /\b(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(\d{4})\s*(?:to|au|-|–|—)\s*(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(\d{4})\b/i,
  );

  if (dayMonthTextualMatch) {
    const [
      ,
      startDayRaw,
      startMonthRaw,
      startYearRaw,
      endDayRaw,
      endMonthRaw,
      endYearRaw,
    ] = dayMonthTextualMatch;
    const startMonth = monthIndex(startMonthRaw);
    const endMonth = monthIndex(endMonthRaw);
    const startYear = Number(startYearRaw);
    const endYear = Number(endYearRaw);

    if (
      startMonth !== null &&
      endMonth !== null &&
      Number.isFinite(startYear) &&
      Number.isFinite(endYear)
    ) {
      return {
        end: [
          endYear,
          String(endMonth + 1).padStart(2, "0"),
          endDayRaw.padStart(2, "0"),
        ].join("-"),
        source: "invoice_text",
        start: [
          startYear,
          String(startMonth + 1).padStart(2, "0"),
          startDayRaw.padStart(2, "0"),
        ].join("-"),
      };
    }
  }

  return null;
}

function monthIndex(value: string): number | null {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .toLowerCase();
  const aliases: Record<string, number> = {
    apr: 3,
    april: 3,
    aout: 7,
    aug: 7,
    august: 7,
    avril: 3,
    dec: 11,
    december: 11,
    decembre: 11,
    feb: 1,
    february: 1,
    fev: 1,
    fevrier: 1,
    jan: 0,
    january: 0,
    janvier: 0,
    jul: 6,
    juillet: 6,
    juil: 6,
    july: 6,
    jun: 5,
    june: 5,
    juin: 5,
    mar: 2,
    march: 2,
    mars: 2,
    may: 4,
    mai: 4,
    nov: 10,
    november: 10,
    novembre: 10,
    oct: 9,
    october: 9,
    octobre: 9,
    sep: 8,
    sept: 8,
    september: 8,
    septembre: 8,
  };

  return aliases[normalized] ?? null;
}

function inferFrequencyFromPeriod(period: Period): BillingFrequency {
  const days = differenceInCalendarDays(parseISO(period.end), parseISO(period.start));

  if (days >= 25 && days <= 35) {
    return "monthly";
  }

  if (days >= 80 && days <= 100) {
    return "quarterly";
  }

  if (days >= 330 && days <= 395) {
    return "annual";
  }

  return "unknown";
}

function inferPeriodFromInvoiceDate(
  invoiceDate: string,
  frequency: BillingFrequency,
): Period | null {
  if (frequency === "unknown" || !invoiceDate) {
    return null;
  }

  const startDate = parseISO(invoiceDate);
  const endDate =
    frequency === "monthly"
      ? addMonths(startDate, 1)
      : frequency === "quarterly"
        ? addQuarters(startDate, 1)
        : addYears(startDate, 1);

  return {
    end: toIsoDate(endDate),
    source: "invoice_history",
    start: invoiceDate,
  };
}

function inferConfidence({
  billingFrequency,
  explicitPeriod,
  invoiceCount,
  prorata,
  recurringAmountCents,
}: {
  billingFrequency: BillingFrequency;
  explicitPeriod: Period | null;
  invoiceCount: number;
  prorata: boolean;
  recurringAmountCents: number | null;
}): ContractConfidence {
  if (billingFrequency === "unknown" || prorata || recurringAmountCents === null) {
    return "low";
  }

  if (explicitPeriod && invoiceCount >= 2) {
    return "high";
  }

  if (explicitPeriod || invoiceCount >= 3) {
    return "medium";
  }

  return "low";
}

function mergeConfidence({
  aiFields,
  deterministicConfidence,
  recurringAmountCents,
  usedAiFields,
}: {
  aiFields: AiContractExtractionFields | null;
  deterministicConfidence: ContractConfidence;
  recurringAmountCents: number | null;
  usedAiFields: string[];
}): ContractConfidence {
  if (deterministicConfidence === "high" || usedAiFields.length === 0) {
    return deterministicConfidence;
  }

  const aiConfidence = normalizeAiConfidence(aiFields?.confidence);

  if (!aiConfidence || aiConfidence === "low") {
    return deterministicConfidence;
  }

  if (
    aiConfidence === "high" &&
    usedAiFields.includes("period") &&
    usedAiFields.includes("billing_frequency") &&
    recurringAmountCents !== null
  ) {
    return "high";
  }

  return deterministicConfidence === "low" ? "medium" : deterministicConfidence;
}

function buildConfidenceReason({
  amountStable,
  billingFrequency,
  explicitPeriod,
  frequencyFromHistory,
  invoiceCount,
  prorata,
}: {
  amountStable: boolean;
  billingFrequency: BillingFrequency;
  explicitPeriod: Period | null;
  frequencyFromHistory: BillingFrequency;
  invoiceCount: number;
  prorata: boolean;
}): string {
  if (prorata) {
    return "Possible prorata or adjustment detected; renewal and recurring amount need review.";
  }

  if (explicitPeriod && billingFrequency !== "unknown") {
    return "Service period found on Pennylane invoice.";
  }

  if (frequencyFromHistory !== "unknown" && invoiceCount >= 2) {
    return amountStable
      ? "Billing frequency inferred from recurring Pennylane invoices with stable amount."
      : "Billing frequency inferred from recurring Pennylane invoices with variable amount.";
  }

  return "Not enough invoice metadata to infer a reliable contract period.";
}

function buildMergedConfidenceReason({
  aiFields,
  aiUsed,
  baseReason,
}: {
  aiFields: AiContractExtractionFields | null;
  aiUsed: boolean;
  baseReason: string;
}): string {
  if (!aiUsed || !aiFields) {
    return baseReason;
  }

  return [
    baseReason,
    `AI extracted additional invoice fields: ${aiFields.confidenceReason}`,
  ].join(" ");
}

function selectVendorName({
  aiFields,
  latestInvoice,
}: {
  aiFields: AiContractExtractionFields | null;
  latestInvoice: PennylaneInvoiceForContractExtraction;
}): string {
  return (
    aiFields?.canonicalVendorName?.trim() ||
    aiFields?.vendorName?.trim() ||
    latestInvoice.supplierName
  );
}

function getInvoiceGroupingVendorName(
  invoice: PennylaneInvoiceForContractExtraction,
): string {
  const aiFields = getAiContractExtractionMetadata(invoice.rawJson)?.extracted_fields;

  return (
    aiFields?.canonicalVendorName?.trim() ||
    aiFields?.vendorName?.trim() ||
    invoice.supplierName
  );
}

function getInvoiceGroupingProductName(
  invoice: PennylaneInvoiceForContractExtraction,
): string | null {
  const aiFields = getAiContractExtractionMetadata(invoice.rawJson)?.extracted_fields;

  return aiFields?.productName?.trim() || extractProductName(invoice);
}

function buildContractSourceExternalId({
  billingFrequency,
  currency,
  normalizedVendorName,
  productName,
}: {
  billingFrequency: BillingFrequency;
  currency: string;
  normalizedVendorName: string;
  productName: string | null;
}): string {
  const normalizedProductName = normalizeContractVendorName(productName);
  const parts = [
    "pennylane",
    normalizedVendorName,
    ...(normalizedProductName ? [normalizedProductName] : []),
    currency.toUpperCase(),
    billingFrequency,
  ];

  return parts.join(":");
}

function mergeSimilarContractProductVariants(
  contracts: InferredContract[],
): InferredContract[] {
  return contracts.reduce<InferredContract[]>((mergedContracts, contract) => {
    const existingIndex = mergedContracts.findIndex((existingContract) =>
      shouldMergeProductVariantContracts(existingContract, contract),
    );

    if (existingIndex === -1) {
      return [...mergedContracts, contract];
    }

    const existingContract = mergedContracts[existingIndex];
    const updatedContracts = [...mergedContracts];
    updatedContracts[existingIndex] = mergeProductVariantContracts(
      existingContract,
      contract,
    );

    return updatedContracts;
  }, []);
}

function shouldMergeProductVariantContracts(
  left: InferredContract,
  right: InferredContract,
): boolean {
  if (
    left.normalizedVendorName !== right.normalizedVendorName ||
    left.currency !== right.currency ||
    left.billingFrequency !== right.billingFrequency
  ) {
    return false;
  }

  const leftAmount = left.recurringAmountCents ?? left.lastInvoiceAmountCents;
  const rightAmount = right.recurringAmountCents ?? right.lastInvoiceAmountCents;

  if (leftAmount === null || rightAmount === null || leftAmount !== rightAmount) {
    return false;
  }

  return areSimilarProductVariants(left.productName, right.productName);
}

function areSimilarProductVariants(
  leftProductName: string | null,
  rightProductName: string | null,
): boolean {
  const left = normalizeContractVendorName(leftProductName);
  const right = normalizeContractVendorName(rightProductName);

  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  const shorterTokenCount = shorter.split(" ").filter(Boolean).length;

  if (
    shorter.length >= 12 &&
    shorterTokenCount >= 3 &&
    longer.startsWith(`${shorter} `)
  ) {
    return true;
  }

  return diceCoefficient(left, right) >= 0.9;
}

function mergeProductVariantContracts(
  left: InferredContract,
  right: InferredContract,
): InferredContract {
  const winner = selectLatestContract(left, right);
  const other = winner === left ? right : left;
  const extractedFields = {
    ...other.extractedFields,
    ...winner.extractedFields,
    invoice_dates: uniqueStrings([
      ...getStringArray(other.extractedFields.invoice_dates),
      ...getStringArray(winner.extractedFields.invoice_dates),
    ]).sort(),
    invoice_external_ids: uniqueStrings([
      ...getStringArray(other.extractedFields.invoice_external_ids),
      ...getStringArray(winner.extractedFields.invoice_external_ids),
    ]),
    merged_product_variant: true,
    product_name_variants: uniqueStrings([
      ...getStringArray(other.extractedFields.product_name_variants),
      ...getStringArray(winner.extractedFields.product_name_variants),
      other.productName,
      winner.productName,
    ]),
  };

  return {
    ...winner,
    confidence:
      confidenceRank(other.confidence) < confidenceRank(winner.confidence)
        ? other.confidence
        : winner.confidence,
    extractedFields,
  };
}

function selectLatestContract(
  left: InferredContract,
  right: InferredContract,
): InferredContract {
  const leftDate =
    left.currentPeriodEnd ?? left.nextRenewalDate ?? left.currentPeriodStart ?? "";
  const rightDate =
    right.currentPeriodEnd ?? right.nextRenewalDate ?? right.currentPeriodStart ?? "";

  return rightDate.localeCompare(leftDate) > 0 ? right : left;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings(values: Array<string | null>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function confidenceRank(confidence: ContractConfidence): number {
  return { low: 0, medium: 1, high: 2 }[confidence];
}

function selectAiRecurringAmount({
  aiFields,
  billingFrequency,
  latestInvoiceAmountCents,
  prorata,
}: {
  aiFields: AiContractExtractionFields | null;
  billingFrequency: BillingFrequency;
  latestInvoiceAmountCents: number | null;
  prorata: boolean;
}): number | null {
  const aiAmount = aiFields?.recurringAmountCents ?? null;

  if (!aiAmount || billingFrequency === "unknown") {
    return null;
  }

  if (!prorata) {
    return aiAmount;
  }

  return latestInvoiceAmountCents !== null && aiAmount !== latestInvoiceAmountCents
    ? aiAmount
    : null;
}

function getUsedAiFields({
  aiFields,
  billingFrequency,
  deterministicRecurringAmountCents,
  explicitPeriod,
  period,
  recurringAmountCents,
}: {
  aiFields: AiContractExtractionFields | null;
  billingFrequency: BillingFrequency;
  deterministicRecurringAmountCents: number | null;
  explicitPeriod: Period | null;
  period: Period | null;
  recurringAmountCents: number | null;
}): string[] {
  if (!aiFields) {
    return [];
  }

  const fields = new Set<string>();

  if (!explicitPeriod && period?.source === "ai_contract_extraction") {
    fields.add("period");
  }

  if (
    billingFrequency !== "unknown" &&
    normalizeAiBillingFrequency(aiFields.billingFrequency) === billingFrequency
  ) {
    fields.add("billing_frequency");
  }

  if (
    deterministicRecurringAmountCents === null &&
    recurringAmountCents !== null &&
    aiFields.recurringAmountCents === recurringAmountCents
  ) {
    fields.add("recurring_amount_cents");
  }

  for (const [fieldName, value] of [
    ["vendor_name", aiFields.canonicalVendorName ?? aiFields.vendorName],
    ["product_name", aiFields.productName],
    ["plan_name", aiFields.planName],
    ["quantity", aiFields.quantity],
    ["seats", aiFields.seats],
  ] as const) {
    if (value !== null && value !== undefined && value !== "") {
      fields.add(fieldName);
    }
  }

  return Array.from(fields);
}

function buildAiConflicts({
  aiFields,
  deterministicRecurringAmountCents,
  explicitPeriod,
  frequencyFromHistory,
}: {
  aiFields: AiContractExtractionFields | null;
  deterministicRecurringAmountCents: number | null;
  explicitPeriod: Period | null;
  frequencyFromHistory: BillingFrequency;
}): Array<Record<string, unknown>> {
  if (!aiFields) {
    return [];
  }

  const conflicts: Array<Record<string, unknown>> = [];
  const aiFrequency = normalizeAiBillingFrequency(aiFields.billingFrequency);

  if (
    frequencyFromHistory !== "unknown" &&
    aiFrequency !== "unknown" &&
    frequencyFromHistory !== aiFrequency
  ) {
    conflicts.push({
      ai_value: aiFrequency,
      deterministic_value: frequencyFromHistory,
      field: "billing_frequency",
    });
  }

  if (
    explicitPeriod &&
    aiFields.currentPeriodStart &&
    explicitPeriod.start !== aiFields.currentPeriodStart
  ) {
    conflicts.push({
      ai_value: aiFields.currentPeriodStart,
      deterministic_value: explicitPeriod.start,
      field: "current_period_start",
    });
  }

  if (
    explicitPeriod &&
    aiFields.currentPeriodEnd &&
    explicitPeriod.end !== aiFields.currentPeriodEnd
  ) {
    conflicts.push({
      ai_value: aiFields.currentPeriodEnd,
      deterministic_value: explicitPeriod.end,
      field: "current_period_end",
    });
  }

  if (
    deterministicRecurringAmountCents !== null &&
    aiFields.recurringAmountCents !== null &&
    deterministicRecurringAmountCents !== aiFields.recurringAmountCents
  ) {
    conflicts.push({
      ai_value: aiFields.recurringAmountCents,
      deterministic_value: deterministicRecurringAmountCents,
      field: "recurring_amount_cents",
    });
  }

  return conflicts;
}

function hasStableAmounts(
  invoices: PennylaneInvoiceForContractExtraction[],
): boolean {
  const amounts = invoices
    .flatMap((invoice) =>
      invoice.amountCents === null ? [] : [Math.abs(invoice.amountCents)],
    )
    .filter((amount) => amount > 0);

  if (amounts.length <= 1) {
    return true;
  }

  const medianAmount = median(amounts);

  return amounts.every((amount) => Math.abs(amount - medianAmount) <= medianAmount * 0.15);
}

function isLikelyProrata(invoice: PennylaneInvoiceForContractExtraction): boolean {
  return /\b(prorata|pro rata|prorated|adjustment|avoir|credit|regularisation|régularisation)\b/i.test(
    collectInvoiceText(invoice),
  );
}

function collectInvoiceText(invoice: PennylaneInvoiceForContractExtraction): string {
  return [
    invoice.supplierName,
    invoice.invoiceNumber,
    invoice.label,
    ...collectStrings(invoice.rawJson),
  ]
    .filter(Boolean)
    .join(" ");
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    return [value];
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

function extractProductName(
  invoice: PennylaneInvoiceForContractExtraction,
): string | null {
  return firstStringByKey(invoice.rawJson, ["product", "product_name", "service"]);
}

function extractPlanName(
  invoice: PennylaneInvoiceForContractExtraction,
): string | null {
  return firstStringByKey(invoice.rawJson, ["plan", "plan_name", "subscription"]);
}

function extractQuantity(
  invoice: PennylaneInvoiceForContractExtraction,
): number | null {
  return firstNumberByKey(invoice.rawJson, ["quantity", "qty"]);
}

function extractSeats(invoice: PennylaneInvoiceForContractExtraction): number | null {
  return firstNumberByKey(invoice.rawJson, ["seats", "seat_count", "licenses", "licences"]);
}

function firstStringByKey(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = firstStringByKey(item, keys);

      if (result) {
        return result;
      }
    }

    return null;
  }

  const record = value as Record<string, unknown>;

  for (const [key, child] of Object.entries(record)) {
    if (keys.includes(key.toLowerCase()) && typeof child === "string" && child.trim()) {
      return child.trim();
    }
  }

  for (const child of Object.values(record)) {
    const result = firstStringByKey(child, keys);

    if (result) {
      return result;
    }
  }

  return null;
}

function firstNumberByKey(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = firstNumberByKey(item, keys);

      if (result !== null) {
        return result;
      }
    }

    return null;
  }

  const record = value as Record<string, unknown>;

  for (const [key, child] of Object.entries(record)) {
    if (!keys.includes(key.toLowerCase())) {
      continue;
    }

    const number = toNumber(child);

    if (number !== null && number > 0) {
      return Math.floor(number);
    }
  }

  for (const child of Object.values(record)) {
    const result = firstNumberByKey(child, keys);

    if (result !== null) {
      return result;
    }
  }

  return null;
}

function getMissingFields({
  billingFrequency,
  period,
}: {
  billingFrequency: BillingFrequency;
  period: Period | null;
}): string[] {
  return [
    ...(!period ? ["current_period_start", "current_period_end"] : []),
    ...(billingFrequency === "unknown" ? ["billing_frequency"] : []),
  ];
}

function getInvoiceDate(invoice: PennylaneInvoiceForContractExtraction): string {
  return (
    getExplicitInvoiceDate(invoice) ??
    new Date().toISOString().slice(0, 10)
  );
}

function getExplicitInvoiceDate(
  invoice: PennylaneInvoiceForContractExtraction,
): string | null {
  return (
    normalizeDate(invoice.invoiceDate) ??
    normalizeDate(invoice.issueDate) ??
    normalizeDate(invoice.dueDate)
  );
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);

  if (iso) {
    return iso[1];
  }

  const european = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (european) {
    const [, day, month, year] = european;

    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}
