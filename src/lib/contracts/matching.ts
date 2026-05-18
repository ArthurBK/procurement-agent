import {
  diceCoefficient,
  extractDomainFromText,
  normalizeContractVendorName,
} from "./normalization.ts";
import { reviewContractMatchWithAi } from "./aiMatching.ts";
import {
  getKnownAliasTarget,
  isSameIdentitySupplier,
} from "../integrations/google/matching.ts";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type ContractForMatching = {
  id: string;
  normalized_vendor_name: string;
  vendor_name: string;
  status:
    | "active"
    | "inactive"
    | "needs_review"
    | "ignored"
    | "possibly_cancelled";
};

export type SsoSupplierForMatching = {
  id: string;
  source?: string | null;
  supplier_domain: string | null;
  supplier_name: string;
  identity_mode?: string | null;
  last_signal_at?: string | null;
  users_with_signal_90d?: number | null;
};

export type VendorAliasForMatching = {
  alias: string;
  canonical_name: string;
  domain: string | null;
  normalized_alias: string;
};

export type ContractSsoMatch = {
  matchedAppDomain: string | null;
  matchedAppName: string | null;
  matchReason: string;
  matchScore: number;
  matchStatus: "matched" | "possible_match" | "orphan_contract";
  ssoSupplierId: string | null;
};

export type ContractAppLinkInsert = {
  contract_id: string | null;
  matched_app_domain: string | null;
  matched_app_name: string | null;
  match_reason: string;
  match_score: number;
  match_status:
    | "matched"
    | "possible_match"
    | "missing_contract"
    | "orphan_contract";
  matched_by: "automatic";
  organization_id: string;
  sso_supplier_id: string | null;
  updated_at: string;
};

type ExistingManualLink = {
  contract_id: string | null;
  match_status: string;
  sso_supplier_id: string | null;
};

export async function rebuildContractAppLinks({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<{
  matched: number;
  missingContracts: number;
  orphanContracts: number;
  possibleMatches: number;
}> {
  const [contractsResult, suppliersResult, aliasesResult, manualLinksResult] =
    await Promise.all([
      supabaseAdmin
        .from("contracts")
        .select("id, vendor_name, normalized_vendor_name, status")
        .eq("organization_id", organizationId)
        .in("status", ["active", "needs_review", "possibly_cancelled"]),
      supabaseAdmin
        .from("saas_suppliers")
        .select(
          [
            "id",
            "supplier_name",
            "supplier_domain",
            "source",
            "supplier_identity_matches(identity_mode,last_signal_at,users_with_signal_90d)",
          ].join(", "),
        )
        .eq("organization_id", organizationId),
      supabaseAdmin
        .from("vendor_aliases")
        .select("canonical_name, alias, normalized_alias, domain")
        .eq("organization_id", organizationId),
      supabaseAdmin
        .from("contract_app_links")
        .select("contract_id, sso_supplier_id, match_status")
        .eq("organization_id", organizationId)
        .eq("matched_by", "manual"),
    ]);

  for (const result of [
    contractsResult,
    suppliersResult,
    aliasesResult,
    manualLinksResult,
  ]) {
    if (result.error) {
      throw new Error(`Unable to rebuild contract app links: ${result.error.message}`);
    }
  }

  const contracts = (contractsResult.data ?? []) as ContractForMatching[];
  const suppliers = ((suppliersResult.data ?? []) as unknown as Array<
    Omit<SsoSupplierForMatching, "identity_mode" | "last_signal_at" | "users_with_signal_90d"> & {
      supplier_identity_matches?: Array<{
        identity_mode: string | null;
        last_signal_at: string | null;
        users_with_signal_90d: number | null;
      }>;
    }
  >).map((supplier) => {
    const identity = supplier.supplier_identity_matches?.[0];

    return {
      id: supplier.id,
      identity_mode: identity?.identity_mode ?? null,
      last_signal_at: identity?.last_signal_at ?? null,
      source: supplier.source,
      supplier_domain: supplier.supplier_domain,
      supplier_name: supplier.supplier_name,
      users_with_signal_90d: identity?.users_with_signal_90d ?? 0,
    };
  });
  const aliases = (aliasesResult.data ?? []) as VendorAliasForMatching[];
  const manualLinks = (manualLinksResult.data ?? []) as ExistingManualLink[];
  const now = new Date().toISOString();
  const deterministicLinks = buildContractAppLinkRows({
    aliases,
    contracts,
    manualLinks,
    organizationId,
    suppliers,
    updatedAt: now,
  });
  const links = await reviewPossibleMatchesWithAi({
    contracts,
    links: deterministicLinks,
    suppliers,
  });

  await supabaseAdmin
    .from("contract_app_links")
    .delete()
    .eq("organization_id", organizationId)
    .eq("matched_by", "automatic");

  if (links.length > 0) {
    const { error } = await supabaseAdmin.from("contract_app_links").insert(links);

    if (error) {
      throw new Error(`Unable to save contract app links: ${error.message}`);
    }
  }

  return {
    matched: links.filter((link) => link.match_status === "matched").length,
    missingContracts: links.filter((link) => link.match_status === "missing_contract")
      .length,
    orphanContracts: links.filter((link) => link.match_status === "orphan_contract")
      .length,
    possibleMatches: links.filter((link) => link.match_status === "possible_match")
      .length,
  };
}

async function reviewPossibleMatchesWithAi({
  contracts,
  links,
  suppliers,
}: {
  contracts: ContractForMatching[];
  links: ContractAppLinkInsert[];
  suppliers: SsoSupplierForMatching[];
}): Promise<ContractAppLinkInsert[]> {
  if (!process.env.OPENAI_API_KEY) {
    return links;
  }

  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const reviewedLinks: ContractAppLinkInsert[] = [];

  for (const link of links) {
    if (
      link.match_status !== "possible_match" ||
      !link.contract_id ||
      !link.sso_supplier_id
    ) {
      reviewedLinks.push(link);
      continue;
    }

    const contract = contractById.get(link.contract_id);
    const supplier = supplierById.get(link.sso_supplier_id);

    if (!contract || !supplier) {
      reviewedLinks.push(link);
      continue;
    }

    try {
      const review = await reviewContractMatchWithAi({
        contract,
        deterministicReason: link.match_reason,
        deterministicScore: link.match_score,
        supplier,
      });

      if (
        review.fields.isSameVendorOrProduct &&
        review.fields.confidence === "high"
      ) {
        reviewedLinks.push({
          ...link,
          match_reason: buildAiMatchReason(
            "AI confirmed possible match",
            review.fields.reason,
          ),
          match_score: Math.max(link.match_score, 0.88),
          match_status: "matched",
        });
        continue;
      }

      if (review.fields.isSameVendorOrProduct) {
        reviewedLinks.push({
          ...link,
          match_reason: buildAiMatchReason(
            "AI supported possible match",
            review.fields.reason,
          ),
          match_score: Math.max(link.match_score, 0.84),
        });
        continue;
      }

      reviewedLinks.push({
        ...link,
        match_reason: buildAiMatchReason(
          "AI could not confirm possible match",
          review.fields.reason,
        ),
      });
    } catch {
      reviewedLinks.push(link);
    }
  }

  return reviewedLinks;
}

function buildAiMatchReason(prefix: string, reason: string): string {
  return `${prefix}: ${reason}`.slice(0, 500);
}

export function buildContractAppLinkRows({
  aliases,
  contracts,
  manualLinks = [],
  organizationId,
  suppliers,
  updatedAt = new Date().toISOString(),
}: {
  aliases: VendorAliasForMatching[];
  contracts: ContractForMatching[];
  manualLinks?: ExistingManualLink[];
  organizationId: string;
  suppliers: SsoSupplierForMatching[];
  updatedAt?: string;
}): ContractAppLinkInsert[] {
  const links: ContractAppLinkInsert[] = [];
  const linkedSupplierIds = new Set<string>();

  for (const contract of contracts) {
    const match = matchContractToSsoSupplier({ aliases, contract, suppliers });

    if (
      match.ssoSupplierId &&
      hasManualLink(manualLinks, contract.id, match.ssoSupplierId)
    ) {
      markSupplierAndKnownEquivalentsAsLinked({
        linkedSupplierIds,
        supplierId: match.ssoSupplierId,
        suppliers,
      });
      continue;
    }

    if (match.ssoSupplierId) {
      markSupplierAndKnownEquivalentsAsLinked({
        linkedSupplierIds,
        supplierId: match.ssoSupplierId,
        suppliers,
      });
    }

    links.push({
      contract_id: contract.id,
      matched_app_domain: match.matchedAppDomain,
      matched_app_name: match.matchedAppName,
      matched_by: "automatic",
      match_reason: match.matchReason,
      match_score: match.matchScore,
      match_status: match.matchStatus,
      organization_id: organizationId,
      sso_supplier_id: match.ssoSupplierId,
      updated_at: updatedAt,
    });
  }

  for (const supplier of suppliers) {
    if (
      linkedSupplierIds.has(supplier.id) ||
      hasManualMissingDecision(manualLinks, supplier.id) ||
      !isMissingContractCandidate(supplier)
    ) {
      continue;
    }

    links.push({
      contract_id: null,
      matched_app_domain: supplier.supplier_domain,
      matched_app_name: supplier.supplier_name,
      matched_by: "automatic",
      match_reason: buildMissingContractReason(supplier),
      match_score: 0,
      match_status: "missing_contract",
      organization_id: organizationId,
      sso_supplier_id: supplier.id,
      updated_at: updatedAt,
    });
  }

  return links;
}

export function matchContractToSsoSupplier({
  aliases,
  contract,
  suppliers,
}: {
  aliases: VendorAliasForMatching[];
  contract: ContractForMatching;
  suppliers: SsoSupplierForMatching[];
}): ContractSsoMatch {
  const contractName = contract.normalized_vendor_name ||
    normalizeContractVendorName(contract.vendor_name);
  const contractDomain = extractDomainFromText(contract.vendor_name) ??
    aliases.find((alias) => isAliasForContract(alias, contractName))?.domain ??
    null;
  const scoredSuppliers = suppliers
    .map((supplier) => ({
      supplier,
      ...scoreSupplierMatch({ aliases, contractDomain, contractName, supplier }),
    }))
    .sort((left, right) => right.score - left.score);
  const best = scoredSuppliers[0];

  if (!best || best.score < 0.68) {
    return {
      matchedAppDomain: null,
      matchedAppName: null,
      matchReason: "No SSO app matched this contract supplier.",
      matchScore: 0,
      matchStatus: "orphan_contract",
      ssoSupplierId: null,
    };
  }

  return {
    matchedAppDomain: best.supplier.supplier_domain,
    matchedAppName: best.supplier.supplier_name,
    matchReason: best.reason,
    matchScore: best.score,
    matchStatus: best.score >= 0.86 ? "matched" : "possible_match",
    ssoSupplierId: best.supplier.id,
  };
}

function scoreSupplierMatch({
  aliases,
  contractDomain,
  contractName,
  supplier,
}: {
  aliases: VendorAliasForMatching[];
  contractDomain: string | null;
  contractName: string;
  supplier: SsoSupplierForMatching;
}): { reason: string; score: number } {
  const supplierName = normalizeContractVendorName(supplier.supplier_name);
  const supplierDomain = supplier.supplier_domain?.toLowerCase() ?? null;

  if (contractDomain && supplierDomain && contractDomain === supplierDomain) {
    return { reason: "Exact domain match", score: 1 };
  }

  if (
    aliases.some((alias) =>
      isAliasMatch({
        alias,
        contractName,
        supplierDomain,
        supplierName,
      }),
    )
  ) {
    return { reason: "Manual vendor alias match", score: 0.95 };
  }

  if (contractName && supplierName && contractName === supplierName) {
    return { reason: "Normalized supplier name match", score: 0.96 };
  }

  const contractAliasTarget = getKnownAliasTarget(contractName);
  const supplierAliasTarget = getKnownAliasTarget(supplierName);

  if (
    contractAliasTarget &&
    supplierAliasTarget &&
    contractAliasTarget === supplierAliasTarget
  ) {
    return { reason: "Known alias match", score: 0.94 };
  }

  if (
    contractName &&
    supplierName &&
    (contractName.includes(supplierName) || supplierName.includes(contractName))
  ) {
    return { reason: "Supplier name contains SSO app name", score: 0.82 };
  }

  const similarity = diceCoefficient(contractName, supplierName);

  if (similarity >= 0.68) {
    return {
      reason: "Fuzzy supplier name match",
      score: Number(similarity.toFixed(2)),
    };
  }

  return { reason: "No match", score: 0 };
}

function isAliasMatch({
  alias,
  contractName,
  supplierDomain,
  supplierName,
}: {
  alias: VendorAliasForMatching;
  contractName: string;
  supplierDomain: string | null;
  supplierName: string;
}): boolean {
  const normalizedCanonical = normalizeContractVendorName(alias.canonical_name);
  const normalizedAlias = alias.normalized_alias ||
    normalizeContractVendorName(alias.alias);

  if (
    [normalizedCanonical, normalizedAlias].includes(contractName) &&
    [normalizedCanonical, normalizedAlias].includes(supplierName)
  ) {
    return true;
  }

  return Boolean(alias.domain && supplierDomain && alias.domain === supplierDomain);
}

function isAliasForContract(
  alias: VendorAliasForMatching,
  contractName: string,
): boolean {
  return (
    normalizeContractVendorName(alias.canonical_name) === contractName ||
    alias.normalized_alias === contractName
  );
}

function markSupplierAndKnownEquivalentsAsLinked({
  linkedSupplierIds,
  supplierId,
  suppliers,
}: {
  linkedSupplierIds: Set<string>;
  supplierId: string;
  suppliers: SsoSupplierForMatching[];
}): void {
  const linkedSupplier = suppliers.find((supplier) => supplier.id === supplierId);

  if (!linkedSupplier) {
    linkedSupplierIds.add(supplierId);
    return;
  }

  for (const supplier of suppliers) {
    if (
      isSameIdentitySupplier(
        toIdentitySupplier(linkedSupplier),
        toIdentitySupplier(supplier),
      )
    ) {
      linkedSupplierIds.add(supplier.id);
    }
  }
}

function toIdentitySupplier(supplier: SsoSupplierForMatching): {
  supplierDomain: string | null;
  supplierName: string;
} {
  return {
    supplierDomain: supplier.supplier_domain,
    supplierName: supplier.supplier_name,
  };
}

function hasManualLink(
  links: ExistingManualLink[],
  contractId: string,
  supplierId: string,
): boolean {
  return links.some(
    (link) =>
      link.contract_id === contractId &&
      link.sso_supplier_id === supplierId &&
      link.match_status !== "ignored",
  );
}

function hasManualMissingDecision(
  links: ExistingManualLink[],
  supplierId: string,
): boolean {
  return links.some(
    (link) =>
      link.contract_id === null &&
      link.sso_supplier_id === supplierId &&
      link.match_status === "ignored",
  );
}

function isVisibleViaGoogle(supplier: SsoSupplierForMatching): boolean {
  return Boolean(supplier.identity_mode && supplier.identity_mode !== "unknown");
}

function isMissingContractCandidate(supplier: SsoSupplierForMatching): boolean {
  return isVisibleViaGoogle(supplier) && supplier.source !== "google_workspace";
}

function buildMissingContractReason(supplier: SsoSupplierForMatching): string {
  if ((supplier.users_with_signal_90d ?? 0) > 0) {
    return "Google SSO usage signal exists but no Pennylane contract or invoice matched.";
  }

  return "Google identity visibility exists but no Pennylane contract or invoice matched.";
}
