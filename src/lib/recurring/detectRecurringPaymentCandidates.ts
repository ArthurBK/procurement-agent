import { normalizeSupplierKey } from "./normalizeSupplierKey.ts";

export type RawTransactionForRecurringDetection = {
  id: string;
  row_number: number;
  transaction_date: string | null;
  raw_supplier: string;
  amount_cents: number | null;
  currency: string;
  bank_account: string | null;
  description: string | null;
  source_row: Record<string, unknown>;
};

export type RecurringPaymentCandidateBase = {
  candidateKey: string;
  supplier: string;
  supplierKey: string;
  paymentMethod: string | null;
  frequency: "weekly" | "monthly" | "quarterly" | "annually" | "unknown";
  billingModel: "fixed" | "variable" | "unknown";
  amountCents: number;
  currency: string;
  lastPayment: string | null;
  nextPayment: string | null;
  transactionsCount: number;
  recurrenceConfidence: number;
  evidence: Record<string, unknown>;
};

type Frequency = RecurringPaymentCandidateBase["frequency"];
type BillingModel = RecurringPaymentCandidateBase["billingModel"];

type DetectionTransaction = RawTransactionForRecurringDetection & {
  amount_cents: number;
  supplierKey: string;
  transactionDate: string;
};

const ANNUAL_KEYWORDS = [
  "annual",
  "annually",
  "yearly",
  "year",
  "12 months",
  "12 mois",
];

const SOURCE_CATEGORY_KEY_PATTERNS = [
  "category",
  "categorie",
  "catégorie",
  "suivi de tresorerie",
  "suivi de trésorerie",
  "treasury",
  "tracking",
  "accounting",
  "compte comptable",
  "expense type",
  "type",
];

export function detectRecurringPaymentCandidates(
  transactions: RawTransactionForRecurringDetection[],
): RecurringPaymentCandidateBase[] {
  const groupedTransactions = groupTransactions(
    transactions.flatMap((transaction) => {
      const detectionTransaction = toDetectionTransaction(transaction);

      return detectionTransaction ? [detectionTransaction] : [];
    }),
  );
  const candidates: RecurringPaymentCandidateBase[] = [];

  for (const group of groupedTransactions.values()) {
    const sortedGroup = [...group].sort((a, b) =>
      a.transactionDate.localeCompare(b.transactionDate),
    );
    const candidate =
      sortedGroup.length === 1
        ? detectSingleAnnualCandidate(sortedGroup[0])
        : detectRecurringCandidate(sortedGroup);

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates.sort((a, b) => a.supplier.localeCompare(b.supplier));
}

function toDetectionTransaction(
  transaction: RawTransactionForRecurringDetection,
): DetectionTransaction | null {
  if (
    !transaction.transaction_date ||
    transaction.amount_cents === null ||
    transaction.raw_supplier.trim().length === 0
  ) {
    return null;
  }

  const transactionDate = parseIsoDate(transaction.transaction_date);
  const supplierKey = normalizeSupplierKey(transaction.raw_supplier);

  if (!transactionDate || supplierKey.length === 0) {
    return null;
  }

  return {
    ...transaction,
    amount_cents: transaction.amount_cents,
    supplierKey,
    transactionDate,
  };
}

function groupTransactions(
  transactions: DetectionTransaction[],
): Map<string, DetectionTransaction[]> {
  const groups = new Map<string, DetectionTransaction[]>();

  for (const transaction of transactions) {
    const groupKey = [
      transaction.supplierKey,
      transaction.currency,
      transaction.bank_account ?? "",
    ].join("\u001f");
    const group = groups.get(groupKey) ?? [];

    group.push(transaction);
    groups.set(groupKey, group);
  }

  return groups;
}

function detectSingleAnnualCandidate(
  transaction: DetectionTransaction,
): RecurringPaymentCandidateBase | null {
  const searchableText = `${transaction.raw_supplier} ${
    transaction.description ?? ""
  }`.toLowerCase();

  if (!ANNUAL_KEYWORDS.some((keyword) => searchableText.includes(keyword))) {
    return null;
  }

  return buildCandidate({
    amountStable: true,
    billingModel: "fixed",
    frequency: "annually",
    medianDeltaDays: null,
    recurrenceConfidence: 0.45,
    transactions: [transaction],
  });
}

function detectRecurringCandidate(
  transactions: DetectionTransaction[],
): RecurringPaymentCandidateBase | null {
  const deltas = transactions
    .slice(1)
    .map((transaction, index) =>
      getDaysBetween(transactions[index].transactionDate, transaction.transactionDate),
    );
  const medianDeltaDays = median(deltas);
  const frequency = inferFrequency(medianDeltaDays);

  if (frequency === "unknown") {
    return null;
  }

  const absoluteAmounts = transactions.map((transaction) =>
    Math.abs(transaction.amount_cents),
  );
  const medianAmount = median(absoluteAmounts);
  const amountStable = areAmountsStable(absoluteAmounts, medianAmount);
  const billingModel: BillingModel = amountStable ? "fixed" : "variable";
  const recurrenceConfidence = scoreRecurrenceConfidence({
    amountStable,
    frequency,
    hasPaymentMethod: Boolean(transactions.at(-1)?.bank_account),
    transactionsCount: transactions.length,
  });

  return buildCandidate({
    amountStable,
    billingModel,
    frequency,
    medianDeltaDays,
    recurrenceConfidence,
    transactions,
  });
}

function buildCandidate({
  amountStable,
  billingModel,
  frequency,
  medianDeltaDays,
  recurrenceConfidence,
  transactions,
}: {
  amountStable: boolean;
  billingModel: BillingModel;
  frequency: Frequency;
  medianDeltaDays: number | null;
  recurrenceConfidence: number;
  transactions: DetectionTransaction[];
}): RecurringPaymentCandidateBase {
  const lastTransaction = transactions[transactions.length - 1];
  const absoluteAmounts = transactions.map((transaction) =>
    Math.abs(transaction.amount_cents),
  );
  const medianAmount = median(absoluteAmounts);
  const amountCents = amountStable
    ? Math.round(medianAmount)
    : absoluteAmounts.at(-1) ?? 0;
  const lastPayment = lastTransaction.transactionDate;
  const nextPayment = addFrequency(lastPayment, frequency);
  const paymentMethod = lastTransaction.bank_account;
  const candidateKey = [
    lastTransaction.supplierKey,
    lastTransaction.currency,
    paymentMethod ?? "unknown",
    frequency,
  ].join("|");

  return {
    amountCents,
    billingModel,
    candidateKey,
    currency: lastTransaction.currency,
    evidence: buildEvidence({
      amountStable,
      billingModel,
      medianDeltaDays,
      transactions,
    }),
    frequency,
    lastPayment,
    nextPayment,
    paymentMethod,
    recurrenceConfidence,
    supplier: lastTransaction.raw_supplier.trim(),
    supplierKey: lastTransaction.supplierKey,
    transactionsCount: transactions.length,
  };
}

function buildEvidence({
  amountStable,
  billingModel,
  medianDeltaDays,
  transactions,
}: {
  amountStable: boolean;
  billingModel: BillingModel;
  medianDeltaDays: number | null;
  transactions: DetectionTransaction[];
}): Record<string, unknown> {
  const amounts = transactions.map((transaction) => transaction.amount_cents);

  return {
    amount_stable: amountStable,
    amounts_cents: amounts,
    billing_model: billingModel,
    descriptions: transactions.map((transaction) => transaction.description),
    median_delta_days: medianDeltaDays,
    raw_suppliers: transactions.map((transaction) => transaction.raw_supplier),
    row_numbers: transactions.map((transaction) => transaction.row_number),
    signs_summary: {
      negative_count: amounts.filter((amount) => amount < 0).length,
      positive_count: amounts.filter((amount) => amount > 0).length,
    },
    source_categories: extractSourceCategories(transactions),
    transaction_dates: transactions.map(
      (transaction) => transaction.transactionDate,
    ),
    transaction_ids: transactions.map((transaction) => transaction.id),
  };
}

function extractSourceCategories(transactions: DetectionTransaction[]): string[] {
  const categories = new Set<string>();

  for (const transaction of transactions) {
    for (const [key, value] of Object.entries(transaction.source_row)) {
      const normalizedKey = normalizeEvidenceText(key);

      if (
        SOURCE_CATEGORY_KEY_PATTERNS.some((pattern) =>
          normalizedKey.includes(pattern),
        )
      ) {
        const category = stringifyPrimitive(value);

        if (category) {
          categories.add(category);
        }
      }
    }
  }

  return Array.from(categories);
}

function stringifyPrimitive(value: unknown): string | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const stringValue = String(value).trim();

    return stringValue.length > 0 ? stringValue : null;
  }

  return null;
}

function inferFrequency(medianDeltaDays: number): Frequency {
  if (medianDeltaDays >= 6 && medianDeltaDays <= 8) {
    return "weekly";
  }

  if (medianDeltaDays >= 25 && medianDeltaDays <= 35) {
    return "monthly";
  }

  if (medianDeltaDays >= 80 && medianDeltaDays <= 100) {
    return "quarterly";
  }

  if (medianDeltaDays >= 330 && medianDeltaDays <= 395) {
    return "annually";
  }

  return "unknown";
}

function areAmountsStable(amounts: number[], medianAmount: number): boolean {
  if (medianAmount === 0) {
    return amounts.every((amount) => amount === 0);
  }

  return amounts.every(
    (amount) => Math.abs(amount - medianAmount) / medianAmount <= 0.15,
  );
}

function scoreRecurrenceConfidence({
  amountStable,
  frequency,
  hasPaymentMethod,
  transactionsCount,
}: {
  amountStable: boolean;
  frequency: Frequency;
  hasPaymentMethod: boolean;
  transactionsCount: number;
}): number {
  let confidence = 0.35;

  confidence += transactionsCount === 2 ? 0.15 : 0.25;

  if (amountStable) {
    confidence += 0.1;
  }

  if (hasPaymentMethod) {
    confidence += 0.1;
  }

  if (frequency === "monthly" || frequency === "annually") {
    confidence += 0.1;
  }

  return Math.min(confidence, 0.95);
}

function median(values: number[]): number {
  const sortedValues = [...values].sort((a, b) => a - b);
  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[middleIndex];
  }

  return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
}

function parseIsoDate(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return formatIsoDate(date);
}

function getDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function addFrequency(date: string, frequency: Frequency): string | null {
  if (frequency === "weekly") {
    return addDays(date, 7);
  }

  if (frequency === "monthly") {
    return addMonths(date, 1);
  }

  if (frequency === "quarterly") {
    return addMonths(date, 3);
  }

  if (frequency === "annually") {
    return addMonths(date, 12);
  }

  return null;
}

function addDays(date: string, days: number): string {
  const nextDate = new Date(`${date}T00:00:00.000Z`);

  nextDate.setUTCDate(nextDate.getUTCDate() + days);

  return formatIsoDate(nextDate);
}

function addMonths(date: string, months: number): string {
  const currentDate = new Date(`${date}T00:00:00.000Z`);
  const year = currentDate.getUTCFullYear();
  const month = currentDate.getUTCMonth();
  const day = currentDate.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
  const targetMonthLastDay = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();

  targetMonthStart.setUTCDate(Math.min(day, targetMonthLastDay));

  return formatIsoDate(targetMonthStart);
}

function formatIsoDate(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function normalizeEvidenceText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
