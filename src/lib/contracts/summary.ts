import {
  addDaysIsoDate,
  buildRenewalOccurrences,
} from "./renewalOccurrences.ts";

type ContractSummaryContract = {
  billingFrequency: string;
  contractId?: string;
  nextRenewalDate: string | null;
  recurringAmountCents: number | null;
  status: string;
};

type ContractSummaryGap = {
  contractStatus?: string | null;
  contractId?: string | null;
  linkId?: string;
};

type ContractSummaryGaps = {
  missingContracts: ContractSummaryGap[];
  orphanContracts: ContractSummaryGap[];
  possibleMatches: ContractSummaryGap[];
  usageReviewContracts?: ContractSummaryGap[];
};

export function buildContractSummary({
  contracts,
  gaps,
  today = new Date().toISOString().slice(0, 10),
}: {
  contracts: ContractSummaryContract[];
  gaps: ContractSummaryGaps;
  today?: string;
}) {
  const activeContracts = contracts.filter(isCountedActiveContract);
  const renewalsNext90Days = buildRenewalOccurrences({
    renewals: activeContracts.map((contract, index) => ({
      ...contract,
      contractId: contract.contractId ?? `contract-${index}`,
    })),
    windowEnd: addDaysIsoDate(today, 90),
    windowStart: today,
  });

  return {
    activeContracts: activeContracts.length,
    estimatedMonthlySpendCents: activeContracts.reduce(
      (sum, contract) =>
        sum + toMonthlyAmount(contract.recurringAmountCents, contract.billingFrequency),
      0,
    ),
    missingContracts: gaps.missingContracts.length,
    needsReview: countReviewItems(gaps),
    renewalsNext90Days: renewalsNext90Days.length,
  };
}

function countReviewItems(gaps: ContractSummaryGaps): number {
  const reviewKeys = new Set<string>();

  for (const gap of [...gaps.possibleMatches, ...gaps.orphanContracts]) {
    reviewKeys.add(
      gap.contractId
        ? `contract:${gap.contractId}`
        : `link:${gap.linkId ?? reviewKeys.size}`,
    );
  }

  return reviewKeys.size;
}

function isCountedActiveContract(contract: ContractSummaryContract): boolean {
  return (
    contract.status === "active" ||
    contract.status === "needs_review" ||
    contract.status === "possibly_cancelled"
  );
}

function toMonthlyAmount(amountCents: number | null, frequency: string): number {
  if (amountCents === null) {
    return 0;
  }

  if (frequency === "annual") {
    return Math.round(amountCents / 12);
  }

  if (frequency === "quarterly") {
    return Math.round(amountCents / 3);
  }

  return amountCents;
}
