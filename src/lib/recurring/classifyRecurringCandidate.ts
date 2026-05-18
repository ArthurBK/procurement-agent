import type { RecurringPaymentCandidateBase } from "./detectRecurringPaymentCandidates";
import type { SupplierRule } from "../supplierRules/types.ts";

export type BusinessCategory =
  | "software"
  | "cloud"
  | "ai"
  | "telecom"
  | "banking"
  | "workspace"
  | "professional_service"
  | "marketing"
  | "food"
  | "transport"
  | "travel"
  | "retail"
  | "income"
  | "unknown";

export type SystemDecision = "auto_subscription" | "needs_review" | "excluded";

export type CandidateClassification = {
  businessCategory: BusinessCategory;
  classificationConfidence: number;
  systemDecision: SystemDecision;
  reason: string;
  signals: Record<string, unknown>;
};

type ClassificationRule = {
  id: string;
  category: BusinessCategory;
  decision: SystemDecision;
  confidence: number;
  patterns: RegExp[];
};

const ACCOUNTING_CATEGORY_RULES: ClassificationRule[] = [
  {
    category: "software",
    confidence: 0.95,
    decision: "auto_subscription",
    id: "accounting_software",
    patterns: [/logiciels?/, /services web/, /software/],
  },
  {
    category: "telecom",
    confidence: 0.9,
    decision: "auto_subscription",
    id: "accounting_telecom",
    patterns: [/telephone/, /internet/],
  },
  {
    category: "banking",
    confidence: 0.9,
    decision: "auto_subscription",
    id: "accounting_banking",
    patterns: [/frais bancaires/, /banque/, /bank/],
  },
  {
    category: "workspace",
    confidence: 0.85,
    decision: "auto_subscription",
    id: "accounting_workspace",
    patterns: [/bureau/, /coworking/, /loyer/],
  },
  {
    category: "food",
    confidence: 0.9,
    decision: "excluded",
    id: "accounting_food",
    patterns: [/restaurant/, /repas/, /cafe/, /alimentation/, /courses/],
  },
  {
    category: "transport",
    confidence: 0.9,
    decision: "excluded",
    id: "accounting_transport",
    patterns: [/transport/, /train/, /taxi/, /deplacement/],
  },
  {
    category: "travel",
    confidence: 0.9,
    decision: "excluded",
    id: "accounting_travel",
    patterns: [/voyage/],
  },
];

const MERCHANT_RULES: ClassificationRule[] = [
  {
    category: "software",
    confidence: 0.9,
    decision: "auto_subscription",
    id: "merchant_software",
    patterns: [
      /\bopenai\b/,
      /\bopen ai\b/,
      /\bchatgpt\b/,
      /\bgoogle workspace\b/,
      /\bgsuite\b/,
      /\bnotion\b/,
      /\bslack\b/,
      /\bfigma\b/,
      /\bvercel\b/,
      /\bneon\b/,
      /\bfly(?:\.|\s)?io\b/,
      /\btrigger(?:\.|\s)?dev\b/,
      /\bn8n\b/,
      /\bgithub\b/,
      /\bgitlab\b/,
      /\bdatadog\b/,
      /\bhubspot\b/,
      /\bintercom\b/,
      /\bzoom\b/,
      /\bdropbox\b/,
      /\bcanva\b/,
      /\baws\b/,
      /\bamazon web services\b/,
      /\bmicrosoft\b/,
      /\bstripe atlas\b/,
    ],
  },
  {
    category: "banking",
    confidence: 0.9,
    decision: "auto_subscription",
    id: "merchant_banking",
    patterns: [
      /\bqonto\b/,
      /\brevolut business\b/,
      /\bmercury\b/,
      /\bramp\b/,
      /\bbrex\b/,
    ],
  },
  {
    category: "workspace",
    confidence: 0.85,
    decision: "auto_subscription",
    id: "merchant_workspace",
    patterns: [/\bwework\b/, /\bcoworking\b/],
  },
  {
    category: "telecom",
    confidence: 0.9,
    decision: "auto_subscription",
    id: "merchant_telecom",
    patterns: [
      /\baircall\b/,
      /\btwilio\b/,
      /\borange\b/,
      /\bfree mobile\b/,
      /\bbouygues telecom\b/,
    ],
  },
  {
    category: "food",
    confidence: 0.9,
    decision: "excluded",
    id: "merchant_food",
    patterns: [
      /\brestaurant\b/,
      /\bcafe\b/,
      /\bcafé\b/,
      /\bcoffee\b/,
      /\bboulangerie\b/,
      /\bbakery\b/,
      /\bgrocery\b/,
      /\bsupermarche\b/,
      /\bsupermarché\b/,
      /\bsupermarket\b/,
      /\bmonoprix\b/,
      /\bfranprix\b/,
      /\bcarrefour\b/,
    ],
  },
  {
    category: "transport",
    confidence: 0.9,
    decision: "excluded",
    id: "merchant_transport",
    patterns: [/\bsncf\b/, /\bratp\b/, /\btaxi\b/, /\buber\b/, /\blime\b/],
  },
  {
    category: "travel",
    confidence: 0.9,
    decision: "excluded",
    id: "merchant_travel",
    patterns: [/\bhotel\b/, /\bairline\b/, /\bairbnb\b/],
  },
];

export function classifyRecurringCandidate(
  candidate: RecurringPaymentCandidateBase,
  options: {
    supplierRules?: SupplierRule[];
  } = {},
): CandidateClassification {
  const signsSummary = getSignsSummary(candidate.evidence);

  if (signsSummary.positive_count > signsSummary.negative_count) {
    return {
      businessCategory: "income",
      classificationConfidence: 0.95,
      reason: "majority_positive_transactions",
      signals: { signs_summary: signsSummary },
      systemDecision: "excluded",
    };
  }

  const supplierRule = findSupplierRule(candidate, options.supplierRules ?? []);

  if (supplierRule) {
    return {
      businessCategory: supplierRule.business_category,
      classificationConfidence: 0.99,
      reason: `supplier_rule:${supplierRule.id}`,
      signals: {
        supplier_rule_id: supplierRule.id,
        supplier_rule_match_type: supplierRule.match_type,
        supplier_rule_source: supplierRule.source,
      },
      systemDecision: supplierRule.default_decision,
    };
  }

  const accountingCategoryMatch = findAccountingCategoryMatch(candidate);

  if (accountingCategoryMatch) {
    return classificationFromRule(accountingCategoryMatch.rule, {
      matched_category: accountingCategoryMatch.category,
      matched_rule_id: accountingCategoryMatch.rule.id,
      signal: "accounting_category",
    });
  }

  const merchantRule = findMatchingRule(MERCHANT_RULES, getCandidateText(candidate));

  if (merchantRule) {
    return classificationFromRule(merchantRule, {
      matched_rule_id: merchantRule.id,
      signal: "merchant_rule",
    });
  }

  if (candidate.frequency === "weekly") {
    return {
      businessCategory: "unknown",
      classificationConfidence: 0.7,
      reason: "weekly_without_business_signal",
      signals: { frequency: candidate.frequency },
      systemDecision: "excluded",
    };
  }

  if (candidate.amountCents < 1500) {
    return {
      businessCategory: "unknown",
      classificationConfidence: 0.7,
      reason: "low_value_unknown_recurring_payment",
      signals: { amount_cents: candidate.amountCents },
      systemDecision: "excluded",
    };
  }

  if (candidate.recurrenceConfidence >= 0.75 && candidate.amountCents >= 1500) {
    return {
      businessCategory: "unknown",
      classificationConfidence: 0.6,
      reason: "high_recurrence_unknown_business_relevance",
      signals: {
        amount_cents: candidate.amountCents,
        recurrence_confidence: candidate.recurrenceConfidence,
      },
      systemDecision: "needs_review",
    };
  }

  return {
    businessCategory: "unknown",
    classificationConfidence: 0.6,
    reason: "insufficient_business_subscription_signals",
    signals: {
      amount_cents: candidate.amountCents,
      recurrence_confidence: candidate.recurrenceConfidence,
    },
    systemDecision: "excluded",
  };
}

function findSupplierRule(
  candidate: RecurringPaymentCandidateBase,
  supplierRules: SupplierRule[],
): SupplierRule | null {
  return (
    supplierRules.find(
      (rule) =>
        rule.active &&
        rule.match_type === "exact_supplier_key" &&
        rule.supplier_key === candidate.supplierKey,
    ) ?? null
  );
}

function classificationFromRule(
  rule: ClassificationRule,
  signals: Record<string, unknown>,
): CandidateClassification {
  return {
    businessCategory: rule.category,
    classificationConfidence: rule.confidence,
    reason: rule.id,
    signals,
    systemDecision: rule.decision,
  };
}

function findAccountingCategoryMatch(
  candidate: RecurringPaymentCandidateBase,
): { category: string; rule: ClassificationRule } | null {
  const categories = getSourceCategories(candidate.evidence);

  for (const category of categories) {
    const normalizedCategory = normalizeText(category);
    const rule = findMatchingRule(ACCOUNTING_CATEGORY_RULES, normalizedCategory);

    if (rule) {
      return { category, rule };
    }
  }

  return null;
}

function findMatchingRule(
  rules: ClassificationRule[],
  value: string,
): ClassificationRule | null {
  return rules.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(value)),
  ) ?? null;
}

function getCandidateText(candidate: RecurringPaymentCandidateBase): string {
  const rawSuppliers = getStringArray(candidate.evidence.raw_suppliers);

  return normalizeText(
    [candidate.supplier, candidate.supplierKey, ...rawSuppliers].join(" "),
  );
}

function getSourceCategories(evidence: Record<string, unknown>): string[] {
  return getStringArray(evidence.source_categories);
}

function getSignsSummary(evidence: Record<string, unknown>): {
  negative_count: number;
  positive_count: number;
} {
  const signsSummary = evidence.signs_summary;

  if (!isRecord(signsSummary)) {
    return { negative_count: 0, positive_count: 0 };
  }

  return {
    negative_count: toNumber(signsSummary.negative_count),
    positive_count: toNumber(signsSummary.positive_count),
  };
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
