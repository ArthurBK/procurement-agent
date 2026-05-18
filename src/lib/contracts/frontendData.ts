import "server-only";

import {
  getSupplierLogoUrl,
  loadSupplierLogoProfilesByName,
} from "@/lib/integrations/google/identityLogoEnrichment";
import { isSameIdentitySupplier } from "@/lib/integrations/google/matching";
import { normalizeSupplierKey } from "@/lib/recurring/normalizeSupplierKey";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
export { buildContractSummary } from "./summary.ts";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type ContractRow = {
  aiAssisted: boolean;
  billingFrequency: string;
  confidence: "high" | "medium" | "low";
  confidenceReason: string;
  contractId: string;
  currency: string;
  currentPeriodEnd: string | null;
  currentPeriodStart: string | null;
  lastInvoiceAmountCents: number | null;
  linkedSsoAppName: string | null;
  logoUrl: string | null;
  nextRenewalDate: string | null;
  planName: string | null;
  productName: string | null;
  recurringAmountCents: number | null;
  status: string;
  vendorName: string;
};

export type ContractDetail = ContractRow & {
  appLink: {
    matchedAppDomain: string | null;
    matchedAppName: string | null;
    matchedBy: string;
    matchReason: string;
    matchScore: number;
    matchStatus: string;
  } | null;
  autoRenew: boolean | null;
  cancellationDeadline: string | null;
  extractedFields: Record<string, unknown>;
  lastSyncedAt: string | null;
  noticePeriodDays: number | null;
  ownerEmail: string | null;
  quantity: number | null;
  seats: number | null;
  sourceExternalId: string | null;
  sourceInvoice: {
    amountCents: number | null;
    amountExcludingTaxCents: number | null;
    attachmentUrl: string | null;
    currency: string;
    dueDate: string | null;
    invoiceDate: string | null;
    invoiceNumber: string | null;
    isPaid: boolean | null;
    label: string | null;
    supplierName: string;
  } | null;
  sourceSystem: string;
};

export type RenewalRow = ContractRow & {
  monthKey: string;
};

export type ContractGapRow = {
  appDomain: string | null;
  appName: string;
  confidence: string | null;
  contractStatus: string | null;
  contractId: string | null;
  identityMode: string | null;
  lastSignalAt: string | null;
  linkId: string;
  logoUrl: string | null;
  matchReason: string;
  matchScore: number;
  matchStatus: string;
  monthlySpendCents: number | null;
  usersWithSignal90d: number;
  vendorName: string | null;
};

export type ContractGapsPayload = {
  missingContracts: ContractGapRow[];
  orphanContracts: ContractGapRow[];
  possibleMatches: ContractGapRow[];
  usageReviewContracts: ContractGapRow[];
};

type ContractDbRow = {
  billing_frequency: string;
  confidence: "high" | "medium" | "low";
  confidence_reason: string;
  currency: string;
  current_period_end: string | null;
  current_period_start: string | null;
  extracted_fields_json: Record<string, unknown>;
  id: string;
  last_invoice_amount_cents: number | null;
  next_renewal_date: string | null;
  plan_name: string | null;
  product_name: string | null;
  recurring_amount_cents: number | null;
  source_document_id: string | null;
  status: string;
  vendor_name: string;
};

type ContractDetailDbRow = ContractDbRow & {
  auto_renew: boolean | null;
  cancellation_deadline: string | null;
  last_synced_at: string | null;
  notice_period_days: number | null;
  owner_email: string | null;
  quantity: number | null;
  seats: number | null;
  source_external_id: string | null;
  source_system: string;
};

type InvoiceDateDbRow = {
  due_date: string | null;
  id: string;
  invoice_date: string | null;
  issue_date: string | null;
};

type SourceInvoiceDbRow = {
  amount_cents: number | null;
  amount_excluding_tax_cents: number | null;
  attachment_url: string | null;
  currency: string;
  due_date: string | null;
  invoice_date: string | null;
  invoice_number: string | null;
  is_paid: boolean | null;
  label: string | null;
  supplier_name: string;
};

type ContractLinkDbRow = {
  contract_id: string | null;
  id: string;
  matched_app_domain: string | null;
  matched_app_name: string | null;
  match_reason: string;
  match_score: number;
  match_status: string;
  sso_supplier_id: string | null;
};

type ContractDetailLinkDbRow = ContractLinkDbRow & {
  matched_by: string;
};

type SupplierDbRow = {
  id: string;
  monthly_spend: number | null;
  supplier_domain: string | null;
  supplier_identity_matches?: Array<{
    confidence?: string | null;
    identity_mode: string | null;
    last_signal_at: string | null;
    users_with_signal_90d: number | null;
  }>;
  supplier_name: string;
};

export async function loadContractDetail({
  contractId,
  organizationId,
  supabaseAdmin,
}: {
  contractId: string;
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<ContractDetail | null> {
  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select(
      [
        "id",
        "vendor_name",
        "product_name",
        "plan_name",
        "status",
        "source_system",
        "source_document_id",
        "source_external_id",
        "billing_frequency",
        "current_period_start",
        "current_period_end",
        "next_renewal_date",
        "cancellation_deadline",
        "notice_period_days",
        "auto_renew",
        "recurring_amount_cents",
        "last_invoice_amount_cents",
        "currency",
        "quantity",
        "seats",
        "confidence",
        "confidence_reason",
        "extracted_fields_json",
        "owner_email",
        "last_synced_at",
      ].join(", "),
    )
    .eq("organization_id", organizationId)
    .eq("id", contractId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load contract: ${error.message}`);
  }

  const contract = data as unknown as ContractDetailDbRow | null;

  if (!contract) {
    return null;
  }

  const [invoiceResult, linkResult, profilesBySupplierKey] = await Promise.all([
    contract.source_document_id
      ? supabaseAdmin
          .from("pennylane_supplier_invoices")
          .select(
            [
              "supplier_name",
              "invoice_number",
              "invoice_date",
              "due_date",
              "amount_cents",
              "amount_excluding_tax_cents",
              "currency",
              "is_paid",
              "label",
              "attachment_url",
            ].join(", "),
          )
          .eq("organization_id", organizationId)
          .eq("id", contract.source_document_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseAdmin
      .from("contract_app_links")
      .select(
        [
          "id",
          "contract_id",
          "sso_supplier_id",
          "matched_app_name",
          "matched_app_domain",
          "match_status",
          "match_score",
          "match_reason",
          "matched_by",
        ].join(", "),
      )
      .eq("organization_id", organizationId)
      .eq("contract_id", contract.id)
      .order("match_score", { ascending: false })
      .limit(1),
    loadSupplierLogoProfilesByName({
      supplierNames: [contract.vendor_name],
      supabaseAdmin,
    }),
  ]);

  if (invoiceResult.error) {
    throw new Error(`Unable to load source invoice: ${invoiceResult.error.message}`);
  }

  if (linkResult.error) {
    throw new Error(`Unable to load contract app link: ${linkResult.error.message}`);
  }

  const invoice = invoiceResult.data as unknown as SourceInvoiceDbRow | null;
  const link = ((linkResult.data ?? []) as unknown as ContractDetailLinkDbRow[])[0];
  const logoUrl = getSupplierLogoUrl({
    profile: profilesBySupplierKey.get(normalizeSupplierKey(contract.vendor_name)),
    supplierDomain: link?.matched_app_domain ?? null,
  });

  return {
    aiAssisted: contract.extracted_fields_json.ai_used === true,
    appLink: link
      ? {
          matchedAppDomain: link.matched_app_domain,
          matchedAppName: link.matched_app_name,
          matchedBy: link.matched_by,
          matchReason: link.match_reason,
          matchScore: link.match_score,
          matchStatus: link.match_status,
        }
      : null,
    autoRenew: contract.auto_renew,
    billingFrequency: contract.billing_frequency,
    cancellationDeadline: contract.cancellation_deadline,
    confidence: contract.confidence,
    confidenceReason: contract.confidence_reason,
    contractId: contract.id,
    currency: contract.currency,
    currentPeriodEnd: contract.current_period_end,
    currentPeriodStart: contract.current_period_start,
    extractedFields: contract.extracted_fields_json,
    lastInvoiceAmountCents: contract.last_invoice_amount_cents,
    lastSyncedAt: contract.last_synced_at,
    linkedSsoAppName: link?.matched_app_name ?? null,
    logoUrl,
    nextRenewalDate: contract.next_renewal_date,
    noticePeriodDays: contract.notice_period_days,
    ownerEmail: contract.owner_email,
    planName: contract.plan_name,
    productName: contract.product_name,
    quantity: contract.quantity,
    recurringAmountCents: contract.recurring_amount_cents,
    seats: contract.seats,
    sourceExternalId: contract.source_external_id,
    sourceInvoice: invoice
      ? {
          amountCents: invoice.amount_cents,
          amountExcludingTaxCents: invoice.amount_excluding_tax_cents,
          attachmentUrl: invoice.attachment_url,
          currency: invoice.currency,
          dueDate: invoice.due_date,
          invoiceDate: invoice.invoice_date,
          invoiceNumber: invoice.invoice_number,
          isPaid: invoice.is_paid,
          label: invoice.label,
          supplierName: invoice.supplier_name,
        }
      : null,
    sourceSystem: contract.source_system,
    status: contract.status,
    vendorName: contract.vendor_name,
  };
}

export async function loadContracts({
  confidence,
  from,
  organizationId,
  sourceSystem,
  status,
  supabaseAdmin,
  to,
  vendor,
}: {
  confidence?: string | null;
  from?: string | null;
  organizationId: string;
  sourceSystem?: string | null;
  status?: string | null;
  supabaseAdmin: SupabaseAdminClient;
  to?: string | null;
  vendor?: string | null;
}): Promise<ContractRow[]> {
  let query = supabaseAdmin
    .from("contracts")
    .select(
      [
        "id",
        "vendor_name",
        "product_name",
        "plan_name",
        "status",
        "billing_frequency",
        "current_period_start",
        "current_period_end",
        "next_renewal_date",
        "recurring_amount_cents",
        "last_invoice_amount_cents",
        "currency",
        "confidence",
        "confidence_reason",
        "extracted_fields_json",
        "source_document_id",
      ].join(", "),
    )
    .eq("organization_id", organizationId)
    .order("next_renewal_date", { ascending: true, nullsFirst: false });

  if (status) {
    query = query.eq("status", status);
  }

  if (confidence) {
    query = query.eq("confidence", confidence);
  }

  if (sourceSystem) {
    query = query.eq("source_system", sourceSystem);
  }

  if (from) {
    query = query.gte("next_renewal_date", from);
  }

  if (to) {
    query = query.lte("next_renewal_date", to);
  }

  if (vendor) {
    query = query.ilike("vendor_name", `%${vendor}%`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load contracts: ${error.message}`);
  }

  return hydrateContracts({
    contracts: (data ?? []) as unknown as ContractDbRow[],
    organizationId,
    supabaseAdmin,
  });
}

export async function loadRenewals({
  from,
  organizationId,
  supabaseAdmin,
  to,
}: {
  from: string;
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
  to: string;
}): Promise<RenewalRow[]> {
  const contracts = await loadContracts({
    organizationId,
    status: null,
    supabaseAdmin,
  });

  return contracts.flatMap((contract) =>
    contract.nextRenewalDate &&
    isDateInRange(contract.nextRenewalDate, from, to)
      ? [
          {
            ...contract,
            monthKey: contract.nextRenewalDate.slice(0, 7),
          },
        ]
      : [],
  );
}

export async function loadContractGaps({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<ContractGapsPayload> {
  const [linksResult, contractsResult, suppliersResult] = await Promise.all([
    supabaseAdmin
      .from("contract_app_links")
      .select(
        [
          "id",
          "contract_id",
          "sso_supplier_id",
          "matched_app_name",
          "matched_app_domain",
          "match_status",
          "match_score",
          "match_reason",
        ].join(", "),
      )
      .eq("organization_id", organizationId)
      .in("match_status", [
        "missing_contract",
        "possible_match",
        "orphan_contract",
        "matched",
      ])
      .order("match_score", { ascending: false }),
    supabaseAdmin
      .from("contracts")
      .select("id, vendor_name, confidence, status, confidence_reason")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("saas_suppliers")
      .select(
        [
          "id",
          "supplier_name",
          "supplier_domain",
          "monthly_spend",
          "supplier_identity_matches(identity_mode,last_signal_at,users_with_signal_90d)",
        ].join(", "),
      )
      .eq("organization_id", organizationId),
  ]);

  for (const result of [linksResult, contractsResult, suppliersResult]) {
    if (result.error) {
      throw new Error(`Unable to load contract gaps: ${result.error.message}`);
    }
  }

  const contractsById = new Map(
    ((contractsResult.data ?? []) as Array<{
      confidence_reason: string;
      confidence: string;
      id: string;
      status: string;
      vendor_name: string;
    }>).map((contract) => [contract.id, contract]),
  );
  const suppliersById = new Map(
    ((suppliersResult.data ?? []) as unknown as SupplierDbRow[]).map((supplier) => [
      supplier.id,
      supplier,
    ]),
  );
  const rows = ((linksResult.data ?? []) as unknown as ContractLinkDbRow[]).map((link) =>
    toGapRow({ contractsById, link, suppliersById }),
  );
  const profilesBySupplierKey = await loadSupplierLogoProfilesByName({
    supplierNames: rows.map((row) => row.vendorName ?? row.appName),
    supabaseAdmin,
  });
  const rowsWithLogos = rows.map((row) => ({
    ...row,
    logoUrl: getSupplierLogoUrl({
      profile: profilesBySupplierKey.get(
        normalizeSupplierKey(row.vendorName ?? row.appName),
      ),
      supplierDomain: row.appDomain,
    }),
  }));
  const matchedRows = rowsWithLogos.filter((row) => row.matchStatus === "matched");
  const usageReviewContracts = rowsWithLogos.filter(
    (row) =>
      row.matchStatus === "matched" &&
      row.contractStatus === "possibly_cancelled",
  ).map((row) => ({
    ...row,
    matchReason: row.matchReason,
  }));

  return {
    missingContracts: rowsWithLogos.filter(
      (row) =>
        row.matchStatus === "missing_contract" &&
        !hasEquivalentMatchedApp(row, matchedRows),
    ),
    orphanContracts: rowsWithLogos.filter(
      (row) => row.matchStatus === "orphan_contract",
    ),
    possibleMatches: rowsWithLogos.filter(
      (row) => row.matchStatus === "possible_match",
    ),
    usageReviewContracts,
  };
}

function hasEquivalentMatchedApp(
  missingRow: ContractGapRow,
  matchedRows: ContractGapRow[],
): boolean {
  return matchedRows.some((matchedRow) =>
    isSameIdentitySupplier(
      {
        supplierDomain: missingRow.appDomain,
        supplierName: missingRow.appName,
      },
      {
        supplierDomain: matchedRow.appDomain,
        supplierName: matchedRow.appName,
      },
    ),
  );
}

async function hydrateContracts({
  contracts,
  organizationId,
  supabaseAdmin,
}: {
  contracts: ContractDbRow[];
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<ContractRow[]> {
  if (contracts.length === 0) {
    return [];
  }

  const sourceDocumentIds = Array.from(
    new Set(
      contracts.flatMap((contract) =>
        contract.source_document_id ? [contract.source_document_id] : [],
      ),
    ),
  );
  const [linksResult, invoiceDatesResult, profilesBySupplierKey] =
    await Promise.all([
      supabaseAdmin
        .from("contract_app_links")
        .select("contract_id, matched_app_name, matched_app_domain")
        .eq("organization_id", organizationId)
        .in("contract_id", contracts.map((contract) => contract.id)),
      sourceDocumentIds.length > 0
        ? supabaseAdmin
            .from("pennylane_supplier_invoices")
            .select("id, invoice_date, issue_date, due_date")
            .eq("organization_id", organizationId)
            .in("id", sourceDocumentIds)
        : Promise.resolve({ data: [], error: null }),
      loadSupplierLogoProfilesByName({
        supplierNames: contracts.map((contract) => contract.vendor_name),
        supabaseAdmin,
      }),
    ]);

  if (linksResult.error) {
    throw new Error(`Unable to load contract links: ${linksResult.error.message}`);
  }

  if (invoiceDatesResult.error) {
    throw new Error(
      `Unable to load contract invoice dates: ${invoiceDatesResult.error.message}`,
    );
  }

  const linkByContractId = new Map(
    ((linksResult.data ?? []) as Array<{
      contract_id: string;
      matched_app_domain: string | null;
      matched_app_name: string | null;
    }>).map((link) => [link.contract_id, link]),
  );
  const invoicePaymentDateById = new Map<string, string>();

  for (const invoice of (invoiceDatesResult.data ?? []) as InvoiceDateDbRow[]) {
    const paymentDate = getInvoicePaymentDate(invoice);

    if (paymentDate) {
      invoicePaymentDateById.set(invoice.id, paymentDate);
    }
  }

  return contracts.map((contract) => {
    const link = linkByContractId.get(contract.id);
    const invoicePaymentDate = contract.source_document_id
      ? invoicePaymentDateById.get(contract.source_document_id) ?? null
      : null;

    return {
      billingFrequency: contract.billing_frequency,
      aiAssisted: contract.extracted_fields_json.ai_used === true,
      confidence: contract.confidence,
      confidenceReason: contract.confidence_reason,
      contractId: contract.id,
      currency: contract.currency,
      currentPeriodEnd: contract.current_period_end,
      currentPeriodStart: contract.current_period_start,
      lastInvoiceAmountCents: contract.last_invoice_amount_cents,
      linkedSsoAppName: link?.matched_app_name ?? null,
      logoUrl: getSupplierLogoUrl({
        profile: profilesBySupplierKey.get(normalizeSupplierKey(contract.vendor_name)),
        supplierDomain: link?.matched_app_domain ?? null,
      }),
      nextRenewalDate: contract.next_renewal_date ?? invoicePaymentDate,
      planName: contract.plan_name,
      productName: contract.product_name,
      recurringAmountCents: contract.recurring_amount_cents,
      status: contract.status,
      vendorName: contract.vendor_name,
    };
  });
}

function getInvoicePaymentDate(invoice: InvoiceDateDbRow): string | null {
  return (
    normalizeIsoDate(invoice.invoice_date) ??
    normalizeIsoDate(invoice.issue_date) ??
    normalizeIsoDate(invoice.due_date)
  );
}

function normalizeIsoDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function isDateInRange(value: string, from: string, to: string): boolean {
  return value >= from && value <= to;
}

function toGapRow({
  contractsById,
  link,
  suppliersById,
}: {
  contractsById: Map<
    string,
    {
      confidence_reason: string;
      confidence: string;
      status: string;
      vendor_name: string;
    }
  >;
  link: ContractLinkDbRow;
  suppliersById: Map<string, SupplierDbRow>;
}): ContractGapRow {
  const contract = link.contract_id ? contractsById.get(link.contract_id) : null;
  const supplier = link.sso_supplier_id ? suppliersById.get(link.sso_supplier_id) : null;
  const identity = supplier?.supplier_identity_matches?.[0];
  const users90 = identity?.users_with_signal_90d ?? 0;

  return {
    appDomain: link.matched_app_domain ?? supplier?.supplier_domain ?? null,
    appName: link.matched_app_name ?? supplier?.supplier_name ?? "-",
    confidence: contract?.confidence ?? null,
    contractStatus: contract?.status ?? null,
    contractId: link.contract_id,
    identityMode: identity?.identity_mode ?? null,
    lastSignalAt: identity?.last_signal_at ?? null,
    linkId: link.id,
    logoUrl: null,
    matchReason:
      contract?.status === "possibly_cancelled"
        ? contract.confidence_reason
        : link.match_reason,
    matchScore: link.match_score,
    matchStatus: link.match_status,
    monthlySpendCents: supplier?.monthly_spend ?? null,
    usersWithSignal90d: users90,
    vendorName: contract?.vendor_name ?? null,
  };
}

export function getContractRecommendedAction(row: ContractGapRow): string {
  if (row.contractStatus === "possibly_cancelled") {
    return "Confirm cancellation or update the billing source";
  }

  if (row.matchStatus === "missing_contract") {
    return row.usersWithSignal90d > 0
      ? "Find or upload the contract for this SSO app"
      : "Check whether this visible app needs a contract";
  }

  if (row.matchStatus === "orphan_contract") {
    return "Validate app-level usage before renewal decisions";
  }

  return "Review and confirm the possible match";
}

export function getUsageContext(row: ContractGapRow): string {
  return row.usersWithSignal90d === 0
    ? "No recent Google SAML usage signal"
    : "Recent Google SAML usage signal found";
}
