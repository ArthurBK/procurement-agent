import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createIntegrationAuditLog } from "@/lib/integrations/audit";
import {
  DEFAULT_ACTOR_USER_ID,
  type IntegrationRequestContext,
} from "@/lib/integrations/context";
import {
  buildInvoiceSourceHash,
  inferContractsFromPennylaneInvoices,
  type InferredContract,
  type PennylaneInvoiceForContractExtraction,
} from "@/lib/contracts/extraction";
import {
  AI_CONTRACT_EXTRACTION_RAW_JSON_KEY,
  buildAiContractExtractionErrorMetadata,
  buildAiContractSourceTextHash,
  extractContractFieldsWithAi,
  getAiContractExtractionMetadata,
  getAiContractExtractionModel,
  isAiContractExtractionEnabled,
  shouldAttemptAiContractExtraction,
  type AiContractExtractionMetadata,
} from "@/lib/contracts/aiExtraction";
import { normalizeContractVendorName } from "@/lib/contracts/normalization";
import { rebuildContractAppLinks } from "@/lib/contracts/matching";
import { applyContractLifecycleStatus } from "@/lib/contracts/lifecycle";
import { decryptSecret } from "@/lib/security/encryption";
import {
  getPennylaneLookbackStartDate,
  PennylaneClient,
  type PennylaneSupplierApiRow,
  type PennylaneSupplierInvoiceApiRow,
} from "@/lib/integrations/pennylane/client";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type PennylaneIntegrationRow = {
  encrypted_access_token: string | null;
  id: string;
};

type SsoSupplierHint = {
  supplierDomain: string | null;
  supplierName: string;
};

type PennylaneInvoiceDbRow = {
  amount_cents: number | null;
  amount_excluding_tax_cents: number | null;
  currency: string;
  due_date: string | null;
  external_id: string;
  id: string;
  invoice_date: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  label: string | null;
  raw_json: Record<string, unknown>;
  source_hash: string;
  supplier_external_id: string | null;
  supplier_name: string;
};

const execFileAsync = promisify(execFile);
const PDF_TO_TEXT_BINARIES = [
  "pdftotext",
  "/opt/homebrew/bin/pdftotext",
  "/usr/local/bin/pdftotext",
  "/usr/bin/pdftotext",
];
const CURL_BINARIES = [
  "curl",
  "/usr/bin/curl",
  "/opt/homebrew/bin/curl",
  "/usr/local/bin/curl",
];

export type PennylaneSyncSummary = {
  aiExtractionsAttempted: number;
  aiExtractionsFailed: number;
  aiExtractionsReused: number;
  aiExtractionsSkipped: number;
  aiExtractionsSucceeded: number;
  contractsInferred: number;
  errors: string[];
  invoicesCreated: number;
  invoicesFetched: number;
  invoicesUpdated: number;
  matchesCreated: number;
  missingContractsDetected: number;
  orphanContractsDetected: number;
  possibleMatchesDetected: number;
  suppliersFetched: number;
  warnings: string[];
};

export async function runPennylaneSync({
  client,
  context,
  supabaseAdmin,
}: {
  client?: PennylaneClient;
  context: IntegrationRequestContext;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<{ syncRunId: string; summary: PennylaneSyncSummary; status: string }> {
  await ensureNoRunningPennylaneSync({
    organizationId: context.organizationId,
    supabaseAdmin,
  });

  const integration = await ensurePennylaneIntegration({
    context,
    supabaseAdmin,
  });
  const pennylaneClient = client ?? createPennylaneClient(integration);
  const syncRun = await createSyncRun({
    context,
    integrationId: integration.id,
    supabaseAdmin,
  });

  try {
    await updateIntegrationStatus({
      integrationId: integration.id,
      status: "syncing",
      supabaseAdmin,
    });
    await pennylaneClient.testConnection();

    const fromDate = getPennylaneLookbackStartDate();
    await deletePennylaneSaasSuppliers({
      organizationId: context.organizationId,
      supabaseAdmin,
    });

    const [supplierRows, invoiceRows, ssoSupplierHints] = await Promise.all([
      pennylaneClient.listSuppliers().catch((error) => {
        throw new Error(labelPennylaneError("Suppliers fetch", error));
      }),
      pennylaneClient.listSupplierInvoices({ fromDate }).catch((error) => {
        throw new Error(labelPennylaneError("Supplier invoices fetch", error));
      }),
      loadSsoSupplierHints({
        organizationId: context.organizationId,
        supabaseAdmin,
      }),
    ]);
    const existingInvoiceRawJsonByExternalId =
      await loadExistingInvoiceRawJsonByExternalId({
        invoiceRows,
        organizationId: context.organizationId,
        supabaseAdmin,
      });
    const { invoices: enrichedInvoiceRows, warnings: enrichmentWarnings } =
      await enrichInvoicesWithDetails({
        client: pennylaneClient,
        existingInvoiceRawJsonByExternalId,
        invoices: invoiceRows,
        ssoSupplierHints,
      });
    const supplierNameById = buildSupplierNameById(supplierRows);
    const normalizedInvoices = normalizeSupplierInvoices({
      invoiceRows: enrichedInvoiceRows,
      ssoSupplierHints,
      supplierNameById,
      syncRunId: syncRun.id,
    });
    const upsertedInvoiceResult = await upsertSupplierInvoices({
      invoices: normalizedInvoices.rows,
      organizationId: context.organizationId,
      supabaseAdmin,
    });
    const upsertedInvoices = upsertedInvoiceResult.rows;
    const extractionInvoices = upsertedInvoices.map(toExtractionInvoice);
    const firstPassContracts = inferContractsFromPennylaneInvoices(extractionInvoices);
    const aiExtractionResult = await enhanceInvoicesWithAiExtraction({
      contracts: firstPassContracts,
      invoices: extractionInvoices,
      supabaseAdmin,
    });
    const inferredContracts =
      aiExtractionResult.succeeded > 0 || aiExtractionResult.failed > 0
        ? inferContractsFromPennylaneInvoices(aiExtractionResult.invoices)
        : firstPassContracts;
    const lifecycleContracts = inferredContracts.map((contract) =>
      applyContractLifecycleStatus({ contract }),
    );
    const contractsUpserted = await upsertContracts({
      contracts: lifecycleContracts,
      invoiceRows: upsertedInvoices,
      organizationId: context.organizationId,
      supabaseAdmin,
    });
    await pruneStalePennylaneContracts({
      organizationId: context.organizationId,
      sourceExternalIds: lifecycleContracts.map((contract) => contract.sourceExternalId),
      supabaseAdmin,
    });

    const matchSummary = await rebuildContractAppLinks({
      organizationId: context.organizationId,
      supabaseAdmin,
    });
    const summary: PennylaneSyncSummary = {
      aiExtractionsAttempted: aiExtractionResult.attempted,
      aiExtractionsFailed: aiExtractionResult.failed,
      aiExtractionsReused: aiExtractionResult.reused,
      aiExtractionsSkipped: aiExtractionResult.skipped,
      aiExtractionsSucceeded: aiExtractionResult.succeeded,
      contractsInferred: contractsUpserted,
      errors: normalizedInvoices.errors,
      invoicesCreated: upsertedInvoiceResult.createdCount,
      invoicesFetched: invoiceRows.length,
      invoicesUpdated: upsertedInvoiceResult.updatedCount,
      matchesCreated: matchSummary.matched,
      missingContractsDetected: matchSummary.missingContracts,
      orphanContractsDetected: matchSummary.orphanContracts,
      possibleMatchesDetected: matchSummary.possibleMatches,
      suppliersFetched: supplierRows.length,
      warnings: [
        ...enrichmentWarnings,
        ...normalizedInvoices.warnings,
        ...aiExtractionResult.warnings,
      ],
    };
    const status = summary.errors.length > 0 ? "partial" : "success";

    await completeSyncRun({
      errorMessage: summary.errors[0] ?? null,
      status,
      summary,
      supabaseAdmin,
      syncRunId: syncRun.id,
    });
    await updateIntegrationStatus({
      integrationId: integration.id,
      lastError: null,
      status: "connected",
      supabaseAdmin,
    });
    await createIntegrationAuditLog({
      action: "sync_completed",
      actorUserId: context.userId,
      integrationId: integration.id,
      metadata: summary,
      organizationId: context.organizationId,
      provider: "pennylane",
      supabaseAdmin,
    });

    return { status, summary, syncRunId: syncRun.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pennylane sync failed.";
    const summary: PennylaneSyncSummary = {
      aiExtractionsAttempted: 0,
      aiExtractionsFailed: 0,
      aiExtractionsReused: 0,
      aiExtractionsSkipped: 0,
      aiExtractionsSucceeded: 0,
      contractsInferred: 0,
      errors: [message],
      invoicesCreated: 0,
      invoicesFetched: 0,
      invoicesUpdated: 0,
      matchesCreated: 0,
      missingContractsDetected: 0,
      orphanContractsDetected: 0,
      possibleMatchesDetected: 0,
      suppliersFetched: 0,
      warnings: [],
    };

    await completeSyncRun({
      errorMessage: message,
      status: "failed",
      summary,
      supabaseAdmin,
      syncRunId: syncRun.id,
    });
    await updateIntegrationStatus({
      integrationId: integration.id,
      lastError: message,
      status: "error",
      supabaseAdmin,
    });
    await createIntegrationAuditLog({
      action: "sync_failed",
      actorUserId: context.userId,
      integrationId: integration.id,
      message,
      metadata: { syncRunId: syncRun.id },
      organizationId: context.organizationId,
      provider: "pennylane",
      supabaseAdmin,
    });

    return { status: "failed", summary, syncRunId: syncRun.id };
  }
}

const GENERIC_SSO_CANDIDATES = new Set([
  "app",
  "calendar",
  "chrome",
  "cloud",
  "console",
  "ios",
  "mail",
  "macos",
  "manager",
  "test",
]);

export function normalizeSupplierInvoices({
  invoiceRows,
  ssoSupplierHints,
  supplierNameById,
  syncRunId,
}: {
  invoiceRows: PennylaneSupplierInvoiceApiRow[];
  ssoSupplierHints?: SsoSupplierHint[];
  supplierNameById: Map<string, string>;
  syncRunId: string;
}): {
  errors: string[];
  rows: Array<Record<string, unknown>>;
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = invoiceRows.flatMap((invoice, index) => {
    try {
      const normalized = normalizeSupplierInvoice({
        invoice,
        index,
        ssoSupplierHints: ssoSupplierHints ?? [],
        supplierNameById,
        syncRunId,
      });

      if (!normalized) {
        warnings.push(
          `Skipped Pennylane invoice ${extractString(invoice, ["id"]) ?? index}: no SSO-related supplier signal.`,
        );
      }

      return normalized ? [normalized] : [];
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : `Unable to normalize Pennylane invoice at index ${index}.`,
      );

      return [];
    }
  });

  return {
    errors,
    rows,
    warnings,
  };
}

export function normalizeSupplierInvoice({
  invoice,
  ssoSupplierHints = [],
  supplierNameById,
  syncRunId,
}: {
  index: number;
  invoice: PennylaneSupplierInvoiceApiRow;
  ssoSupplierHints?: SsoSupplierHint[];
  supplierNameById: Map<string, string>;
  syncRunId: string;
}): Record<string, unknown> | null {
  const externalId = extractString(invoice, ["id", "external_id", "external_reference"]) ??
    buildInvoiceSourceHash(invoice);
  const supplierExternalId = extractString(invoice, [
    "supplier_id",
    "supplier.id",
    "supplierId",
  ]);
  const explicitSupplierName = extractString(invoice, [
    "supplier_name",
    "supplier.name",
    "supplier.label",
    "supplier",
    "vendor_name",
  ]) ?? (supplierExternalId ? supplierNameById.get(supplierExternalId) ?? null : null);
  const inferredSsoSupplierName = inferSupplierNameFromSsoHints({
    invoice,
    ssoSupplierHints,
  });
  const filenameSupplierName = inferSupplierNameFromFilename(invoice);
  const supplierName =
    inferredSsoSupplierName ?? explicitSupplierName ?? filenameSupplierName;

  if (
    !supplierName ||
    !isSsoRelevantSupplier({ invoice, ssoSupplierHints, supplierName })
  ) {
    return null;
  }

  const rawJson = invoice;
  const amountCents = extractAmountCents(invoice, [
    "amount_cents",
    "currency_amount_cents",
    "total_amount_cents",
    "amount",
    "currency_amount",
    "total_amount",
  ]);
  const amountExcludingTaxCents = extractAmountCents(invoice, [
    "amount_excluding_tax_cents",
    "amount_before_tax_cents",
    "currency_amount_before_tax_cents",
    "amount_excluding_tax",
    "amount_before_tax",
    "currency_amount_before_tax",
  ]);

  return {
    amount_cents: amountCents,
    amount_excluding_tax_cents: amountExcludingTaxCents,
    attachment_url: extractString(invoice, [
      "public_file_url",
      "file_url",
      "attachment_url",
      "document_url",
      "pdf_url",
    ]),
    currency: (
      extractString(invoice, ["currency", "currency_code"]) ?? "EUR"
    ).toUpperCase(),
    due_date: extractDate(invoice, ["due_date", "deadline"]),
    external_id: String(externalId),
    extraction_error: null,
    invoice_date: extractDate(invoice, ["date", "invoice_date"]),
    invoice_number: extractString(invoice, ["invoice_number", "number"]),
    issue_date: extractDate(invoice, ["issue_date", "date"]),
    is_paid: extractPaymentStatus(invoice),
    label: extractString(invoice, ["label", "description", "title"]),
    raw_json: rawJson,
    source_hash: buildInvoiceSourceHash(rawJson),
    source_system: "pennylane",
    storage_key: null,
    supplier_external_id: supplierExternalId,
    supplier_name: supplierName,
    sync_run_id: syncRunId,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function enrichInvoicesWithDetails({
  client,
  existingInvoiceRawJsonByExternalId,
  invoices,
  ssoSupplierHints,
}: {
  client: PennylaneClient;
  existingInvoiceRawJsonByExternalId: Map<string, Record<string, unknown>>;
  invoices: PennylaneSupplierInvoiceApiRow[];
  ssoSupplierHints: SsoSupplierHint[];
}): Promise<{
  invoices: PennylaneSupplierInvoiceApiRow[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const enrichedInvoices: PennylaneSupplierInvoiceApiRow[] = [];

  for (const invoice of invoices) {
    const details: Record<string, unknown> = {};
    const externalId = extractString(invoice, [
      "id",
      "external_id",
      "external_reference",
    ]) ?? buildInvoiceSourceHash(invoice);
    const existingRawJson = existingInvoiceRawJsonByExternalId.get(String(externalId));
    const existingPdfText =
      typeof existingRawJson?.pdf_text === "string" ? existingRawJson.pdf_text : null;
    const existingAiExtraction = existingRawJson
      ? getAiContractExtractionMetadata(existingRawJson)
      : null;

    if (existingPdfText) {
      details.pdf_text = existingPdfText;
    }

    if (existingAiExtraction) {
      details[AI_CONTRACT_EXTRACTION_RAW_JSON_KEY] = existingAiExtraction;
    }

    const metadataSupplier = extractString(invoice, [
      "supplier_name",
      "supplier.name",
      "supplier.label",
      "supplier",
      "vendor_name",
    ]);
    const metadataAlreadyMatchesSso =
      metadataSupplier &&
      isSsoRelevantSupplier({
        invoice,
        ssoSupplierHints,
        supplierName: metadataSupplier,
      });

    if (!metadataAlreadyMatchesSso && !details.pdf_text) {
      try {
        const pdfText = await extractPdfTextFromInvoice({ client, invoice });

        if (pdfText) {
          details.pdf_text = pdfText.slice(0, 20_000);
        }
      } catch (error) {
        warnings.push(
          labelPennylaneError(
            `PDF text extraction for invoice ${extractString(invoice, ["id"]) ?? "unknown"}`,
            error,
          ),
        );
      }
    }

    enrichedInvoices.push({ ...invoice, ...details });
  }

  return { invoices: enrichedInvoices, warnings };
}

async function enhanceInvoicesWithAiExtraction({
  contracts,
  invoices,
  supabaseAdmin,
}: {
  contracts: InferredContract[];
  invoices: PennylaneInvoiceForContractExtraction[];
  supabaseAdmin: SupabaseAdminClient;
}): Promise<{
  attempted: number;
  failed: number;
  invoices: PennylaneInvoiceForContractExtraction[];
  reused: number;
  skipped: number;
  succeeded: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const aiEnabled = isAiContractExtractionEnabled();
  const apiKey = process.env.OPENAI_API_KEY;
  const model = getAiContractExtractionModel();
  const contractByLatestInvoiceExternalId = new Map(
    contracts.map((contract) => [contract.sourceDocumentExternalId, contract]),
  );
  let attempted = 0;
  let failed = 0;
  let reused = 0;
  let skipped = 0;
  let succeeded = 0;
  const enhancedInvoices: PennylaneInvoiceForContractExtraction[] = [];

  if (aiEnabled && !apiKey) {
    warnings.push(
      "AI contract extraction is enabled but OPENAI_API_KEY is missing; skipped AI extraction.",
    );
  }

  for (const invoice of invoices) {
    const sourceHash = buildAiContractSourceTextHash(invoice);
    const cached = getAiContractExtractionMetadata(invoice.rawJson);
    const deterministicContract =
      contractByLatestInvoiceExternalId.get(invoice.externalId) ?? null;
    const decision = shouldAttemptAiContractExtraction({
      deterministicContract,
      invoice,
    });

    if (
      cached?.source_text_hash === sourceHash &&
      cached.extracted_fields &&
      !decision.shouldAttempt
    ) {
      reused += 1;
      enhancedInvoices.push(invoice);
      continue;
    }

    if (!decision.shouldAttempt || !aiEnabled || !apiKey) {
      skipped += 1;
      enhancedInvoices.push(invoice);
      continue;
    }

    attempted += 1;

    try {
      const result = await extractContractFieldsWithAi({
        invoice,
        model,
      });
      const enhancedInvoice = withAiExtractionMetadata(invoice, result.metadata);
      await persistInvoiceAiMetadata({ invoice: enhancedInvoice, supabaseAdmin });
      enhancedInvoices.push(enhancedInvoice);
      succeeded += 1;
    } catch (error) {
      const metadata = buildAiContractExtractionErrorMetadata({
        error,
        invoice,
        model,
      });
      const enhancedInvoice = withAiExtractionMetadata(invoice, metadata);
      await persistInvoiceAiMetadata({ invoice: enhancedInvoice, supabaseAdmin });
      enhancedInvoices.push(enhancedInvoice);
      failed += 1;
      warnings.push(
        `AI contract extraction failed for Pennylane invoice ${invoice.externalId}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  return {
    attempted,
    failed,
    invoices: enhancedInvoices,
    reused,
    skipped,
    succeeded,
    warnings,
  };
}

function withAiExtractionMetadata(
  invoice: PennylaneInvoiceForContractExtraction,
  metadata: AiContractExtractionMetadata,
): PennylaneInvoiceForContractExtraction {
  return {
    ...invoice,
    rawJson: {
      ...invoice.rawJson,
      [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: metadata,
    },
    sourceHash: buildInvoiceSourceHash({
      ...invoice.rawJson,
      [AI_CONTRACT_EXTRACTION_RAW_JSON_KEY]: metadata,
    }),
  };
}

async function persistInvoiceAiMetadata({
  invoice,
  supabaseAdmin,
}: {
  invoice: PennylaneInvoiceForContractExtraction;
  supabaseAdmin: SupabaseAdminClient;
}) {
  if (!invoice.id) {
    return;
  }

  const { error } = await supabaseAdmin
    .from("pennylane_supplier_invoices")
    .update({
      raw_json: invoice.rawJson,
      source_hash: invoice.sourceHash ?? buildInvoiceSourceHash(invoice.rawJson),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoice.id);

  if (error) {
    throw new Error(`Unable to save AI contract extraction: ${error.message}`);
  }
}

async function loadExistingInvoiceRawJsonByExternalId({
  invoiceRows,
  organizationId,
  supabaseAdmin,
}: {
  invoiceRows: PennylaneSupplierInvoiceApiRow[];
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<Map<string, Record<string, unknown>>> {
  const externalIds = invoiceRows.flatMap((invoice) => {
    const externalId = extractString(invoice, [
      "id",
      "external_id",
      "external_reference",
    ]);

    return externalId ? [externalId] : [];
  });

  if (externalIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .from("pennylane_supplier_invoices")
    .select("external_id, raw_json")
    .eq("organization_id", organizationId)
    .eq("source_system", "pennylane")
    .in("external_id", externalIds);

  if (error) {
    throw new Error(`Unable to load cached Pennylane invoices: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as Array<{
      external_id: string;
      raw_json: Record<string, unknown>;
    }>).map((invoice) => [invoice.external_id, invoice.raw_json]),
  );
}

async function extractPdfTextFromInvoice({
  client,
  invoice,
}: {
  client: PennylaneClient;
  invoice: PennylaneSupplierInvoiceApiRow;
}): Promise<string | null> {
  const attachmentUrl = extractString(invoice, [
    "public_file_url",
    "file_url",
    "attachment_url",
    "document_url",
    "pdf_url",
  ]);

  if (!attachmentUrl) {
    return null;
  }

  const bytes = await downloadAttachmentBytes({ attachmentUrl, client });

  if (!bytes) {
    throw new Error("Attachment download returned no PDF bytes.");
  }

  const directory = await mkdtemp(join(tmpdir(), "pennylane-pdf-"));
  const pdfPath = join(directory, "source.pdf");
  const textPath = join(directory, "source.txt");

  try {
    await writeFile(pdfPath, bytes);
    await runPdfToText(pdfPath, textPath);

    return await readFile(textPath, "utf8");
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Unable to extract PDF text.");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function downloadAttachmentBytes({
  attachmentUrl,
  client,
}: {
  attachmentUrl: string;
  client: PennylaneClient;
}): Promise<Buffer | null> {
  const bytes = await client.getAttachmentBytes(attachmentUrl);

  if (bytes) {
    return Buffer.from(bytes);
  }

  return downloadAttachmentBytesWithCurl(attachmentUrl).catch(() => null);
}

async function downloadAttachmentBytesWithCurl(
  attachmentUrl: string,
): Promise<Buffer | null> {
  for (const binary of CURL_BINARIES) {
    try {
      return await execFileBuffer(binary, [
        "-L",
        "-sS",
        "--fail",
        attachmentUrl,
      ]);
    } catch {
      // Try the next common curl location.
    }
  }

  return null;
}

function execFileBuffer(file: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: "buffer",
        maxBuffer: 25 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

async function runPdfToText(pdfPath: string, textPath: string): Promise<void> {
  let lastError: unknown;

  for (const binary of PDF_TO_TEXT_BINARIES) {
    try {
      await execFileAsync(binary, [pdfPath, textPath]);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to extract PDF text.");
}

async function loadSsoSupplierHints({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<SsoSupplierHint[]> {
  const { data, error } = await supabaseAdmin
    .from("saas_suppliers")
    .select(
      [
        "supplier_name",
        "supplier_domain",
        "source",
        "supplier_identity_matches(identity_mode)",
      ].join(", "),
    )
    .eq("organization_id", organizationId)
    .neq("source", "pennylane");

  if (error) {
    throw new Error(`Unable to load SSO supplier hints: ${error.message}`);
  }

  return ((data ?? []) as unknown as Array<{
    supplier_identity_matches?: Array<{ identity_mode: string | null }>;
    supplier_domain: string | null;
    supplier_name: string;
  }>)
    .filter((supplier) =>
      supplier.supplier_identity_matches?.some(
        (match) => match.identity_mode && match.identity_mode !== "unknown",
      ),
    )
    .map((supplier) => ({
      supplierDomain: supplier.supplier_domain,
      supplierName: supplier.supplier_name,
    }));
}

async function deletePennylaneSaasSuppliers({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}) {
  const { error } = await supabaseAdmin
    .from("saas_suppliers")
    .delete()
    .eq("organization_id", organizationId)
    .eq("source", "pennylane");

  if (error) {
    throw new Error(`Unable to remove Pennylane-only suppliers: ${error.message}`);
  }
}

function inferSupplierNameFromSsoHints({
  invoice,
  ssoSupplierHints,
}: {
  invoice: PennylaneSupplierInvoiceApiRow;
  ssoSupplierHints: SsoSupplierHint[];
}): string | null {
  const invoiceText = normalizeContractVendorName(collectInvoiceText(invoice));
  const sortedHints = [...ssoSupplierHints].sort(
    (left, right) => right.supplierName.length - left.supplierName.length,
  );

  for (const hint of sortedHints) {
    const candidates = getSsoHintCandidates(hint);

    if (candidates.some((candidate) => matchesNormalizedText(invoiceText, candidate))) {
      return inferCanonicalSupplierName(hint, invoiceText);
    }
  }

  return null;
}

function inferSupplierNameFromFilename(
  invoice: PennylaneSupplierInvoiceApiRow,
): string | null {
  const filename = extractString(invoice, ["filename"]);

  if (!filename) {
    return null;
  }

  const withoutExtension = filename.replace(/\.[a-z0-9]+$/i, "");
  const invoicePrefix = withoutExtension.match(/^(.+?)[_\-\s]+invoice\b/i);

  if (!invoicePrefix) {
    return null;
  }

  return invoicePrefix[1].replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function isSsoRelevantSupplier({
  invoice,
  ssoSupplierHints,
  supplierName,
}: {
  invoice: PennylaneSupplierInvoiceApiRow;
  ssoSupplierHints: SsoSupplierHint[];
  supplierName: string;
}): boolean {
  if (ssoSupplierHints.length === 0) {
    return true;
  }

  const invoiceText = normalizeContractVendorName(
    [supplierName, collectInvoiceText(invoice)].join(" "),
  );

  return ssoSupplierHints.some((hint) =>
    getSsoHintCandidates(hint).some((candidate) =>
      matchesNormalizedText(invoiceText, candidate),
    ),
  );
}

function getSsoHintCandidates(hint: SsoSupplierHint): string[] {
  const normalizedName = normalizeContractVendorName(hint.supplierName);
  const domainStem = normalizeContractVendorName(
    hint.supplierDomain?.split(".")[0] ?? "",
  );
  const firstNameToken = normalizedName.split(" ")[0] ?? "";

  return Array.from(
    new Set(
      [normalizedName, domainStem, firstNameToken]
        .filter((candidate) => candidate.length >= 3)
        .filter((candidate) => !GENERIC_SSO_CANDIDATES.has(candidate)),
    ),
  );
}

function matchesNormalizedText(text: string, candidate: string): boolean {
  return (
    text === candidate ||
    text.startsWith(`${candidate} `) ||
    text.endsWith(` ${candidate}`) ||
    text.includes(` ${candidate} `)
  );
}

function inferCanonicalSupplierName(
  hint: SsoSupplierHint,
  invoiceText: string,
): string {
  const domainStem = normalizeContractVendorName(
    hint.supplierDomain?.split(".")[0] ?? "",
  );

  if (domainStem && matchesNormalizedText(invoiceText, domainStem)) {
    return toTitleCase(domainStem);
  }

  const firstNameToken = normalizeContractVendorName(hint.supplierName).split(" ")[0];

  return firstNameToken && matchesNormalizedText(invoiceText, firstNameToken)
    ? toTitleCase(firstNameToken)
    : hint.supplierName;
}

function collectInvoiceText(value: unknown, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => collectInvoiceText(item, depth + 1)).join(" ");
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== AI_CONTRACT_EXTRACTION_RAW_JSON_KEY)
      .map(([, child]) => collectInvoiceText(child, depth + 1))
      .join(" ");
  }

  return "";
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function ensureNoRunningPennylaneSync({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}) {
  const { data, error } = await supabaseAdmin
    .from("pennylane_sync_runs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "running")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to check Pennylane sync state: ${error.message}`);
  }

  if (data) {
    throw new Error("A Pennylane sync is already running.");
  }
}

async function ensurePennylaneIntegration({
  context,
  supabaseAdmin,
}: {
  context: IntegrationRequestContext;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<PennylaneIntegrationRow> {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .upsert(
      {
        connected_by_user_id: context.userId,
        organization_id: context.organizationId,
        provider: "pennylane",
        status: "syncing",
      },
      { onConflict: "organization_id,provider" },
    )
    .select("id, encrypted_access_token")
    .single();

  if (error) {
    throw new Error(`Unable to save Pennylane integration: ${error.message}`);
  }

  return data as PennylaneIntegrationRow;
}

function createPennylaneClient(
  integration: PennylaneIntegrationRow,
): PennylaneClient {
  if (integration.encrypted_access_token) {
    return new PennylaneClient({
      apiToken: decryptSecret(integration.encrypted_access_token),
    });
  }

  return new PennylaneClient();
}

async function createSyncRun({
  context,
  integrationId,
  supabaseAdmin,
}: {
  context: IntegrationRequestContext;
  integrationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from("pennylane_sync_runs")
    .insert({
      integration_id: integrationId,
      organization_id: context.organizationId,
      status: "running",
      triggered_by_user_id: context.userId ?? DEFAULT_ACTOR_USER_ID,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to create Pennylane sync run: ${error.message}`);
  }

  return data as { id: string };
}

async function completeSyncRun({
  errorMessage,
  status,
  summary,
  supabaseAdmin,
  syncRunId,
}: {
  errorMessage: string | null;
  status: "success" | "failed" | "partial";
  summary: PennylaneSyncSummary;
  supabaseAdmin: SupabaseAdminClient;
  syncRunId: string;
}) {
  const { error } = await supabaseAdmin
    .from("pennylane_sync_runs")
    .update({
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
      status,
      summary_json: summary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", syncRunId);

  if (error) {
    throw new Error(`Unable to complete Pennylane sync run: ${error.message}`);
  }
}

async function updateIntegrationStatus({
  integrationId,
  lastError,
  status,
  supabaseAdmin,
}: {
  integrationId: string;
  lastError?: string | null;
  status: "connected" | "syncing" | "error";
  supabaseAdmin: SupabaseAdminClient;
}) {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    last_error: lastError ?? null,
    status,
  };

  if (status === "syncing") {
    update.last_sync_started_at = now;
  }

  if (status === "connected") {
    update.last_sync_completed_at = now;
  }

  const { error } = await supabaseAdmin
    .from("integrations")
    .update(update)
    .eq("id", integrationId);

  if (error) {
    throw new Error(`Unable to update Pennylane integration: ${error.message}`);
  }
}

async function upsertSupplierInvoices({
  invoices,
  organizationId,
  supabaseAdmin,
}: {
  invoices: Array<Record<string, unknown>>;
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<{
  createdCount: number;
  rows: PennylaneInvoiceDbRow[];
  updatedCount: number;
}> {
  if (invoices.length === 0) {
    return { createdCount: 0, rows: [], updatedCount: 0 };
  }

  const rows: Array<Record<string, unknown>> = invoices.map((invoice) => ({
    ...invoice,
    organization_id: organizationId,
  }));
  const externalIds = rows.map((row) => String(row.external_id));
  const existingResult = await supabaseAdmin
    .from("pennylane_supplier_invoices")
    .select("external_id, source_hash")
    .eq("organization_id", organizationId)
    .eq("source_system", "pennylane")
    .in("external_id", externalIds);

  if (existingResult.error) {
    throw new Error(
      `Unable to load existing Pennylane invoices: ${existingResult.error.message}`,
    );
  }

  const existingHashes = new Map(
    ((existingResult.data ?? []) as Array<{
      external_id: string;
      source_hash: string;
    }>).map((row) => [row.external_id, row.source_hash]),
  );
  const { data, error } = await supabaseAdmin
    .from("pennylane_supplier_invoices")
    .upsert(rows, {
      onConflict: "organization_id,source_system,external_id",
    })
    .select(
      [
        "id",
        "external_id",
        "supplier_external_id",
        "supplier_name",
        "invoice_number",
        "invoice_date",
        "issue_date",
        "due_date",
        "amount_cents",
        "amount_excluding_tax_cents",
        "currency",
        "label",
        "raw_json",
        "source_hash",
      ].join(", "),
    );

  if (error) {
    throw new Error(`Unable to save Pennylane invoices: ${error.message}`);
  }

  return {
    createdCount: rows.filter(
      (row) => !existingHashes.has(String(row.external_id)),
    ).length,
    rows: (data ?? []) as unknown as PennylaneInvoiceDbRow[],
    updatedCount: rows.filter((row) => {
      const existingHash = existingHashes.get(String(row.external_id));

      return existingHash !== undefined && existingHash !== String(row.source_hash);
    }).length,
  };
}

async function upsertContracts({
  contracts,
  invoiceRows,
  organizationId,
  supabaseAdmin,
}: {
  contracts: InferredContract[];
  invoiceRows: PennylaneInvoiceDbRow[];
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<number> {
  if (contracts.length === 0) {
    return 0;
  }

  const invoiceByExternalId = new Map(
    invoiceRows.map((invoice) => [invoice.external_id, invoice]),
  );
  const rows = contracts.map((contract) => {
    const invoice = invoiceByExternalId.get(contract.sourceDocumentExternalId);

    return {
      billing_frequency: contract.billingFrequency,
      confidence: contract.confidence,
      confidence_reason: contract.confidenceReason,
      currency: contract.currency,
      current_period_end: contract.currentPeriodEnd,
      current_period_start: contract.currentPeriodStart,
      extracted_fields_json: contract.extractedFields,
      last_invoice_amount_cents: contract.lastInvoiceAmountCents,
      last_synced_at: new Date().toISOString(),
      next_renewal_date: contract.nextRenewalDate,
      normalized_vendor_name: contract.normalizedVendorName,
      organization_id: organizationId,
      plan_name: contract.planName,
      product_name: contract.productName,
      quantity: contract.quantity,
      recurring_amount_cents: contract.recurringAmountCents,
      seats: contract.seats,
      source_document_id: invoice?.id ?? null,
      source_external_id: contract.sourceExternalId,
      source_system: contract.sourceSystem,
      status: contract.status,
      updated_at: new Date().toISOString(),
      vendor_name: contract.vendorName,
    };
  });

  await deleteContractsWithChangedSourceKeys({
    organizationId,
    rows,
    supabaseAdmin,
  });

  const { data, error } = await supabaseAdmin
    .from("contracts")
    .upsert(rows, {
      onConflict: "organization_id,source_system,source_external_id",
    })
    .select("id");

  if (error) {
    throw new Error(`Unable to save contracts: ${error.message}`);
  }

  return data?.length ?? 0;
}

async function deleteContractsWithChangedSourceKeys({
  organizationId,
  rows,
  supabaseAdmin,
}: {
  organizationId: string;
  rows: Array<Record<string, unknown>>;
  supabaseAdmin: SupabaseAdminClient;
}) {
  const sourceDocumentIds = rows.flatMap((row) =>
    typeof row.source_document_id === "string" ? [row.source_document_id] : [],
  );

  if (sourceDocumentIds.length === 0) {
    return;
  }

  const expectedSourceExternalByDocumentId = new Map(
    rows.flatMap((row) =>
      typeof row.source_document_id === "string" &&
      typeof row.source_external_id === "string"
        ? [[row.source_document_id, row.source_external_id]]
        : [],
    ),
  );
  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select("id, source_document_id, source_external_id")
    .eq("organization_id", organizationId)
    .eq("source_system", "pennylane")
    .in("source_document_id", sourceDocumentIds);

  if (error) {
    throw new Error(`Unable to load existing contracts: ${error.message}`);
  }

  const conflictingIds = ((data ?? []) as Array<{
    id: string;
    source_document_id: string | null;
    source_external_id: string | null;
  }>).flatMap((contract) => {
    const expectedSourceExternalId = contract.source_document_id
      ? expectedSourceExternalByDocumentId.get(contract.source_document_id)
      : null;

    return expectedSourceExternalId &&
      contract.source_external_id !== expectedSourceExternalId
      ? [contract.id]
      : [];
  });

  if (conflictingIds.length === 0) {
    return;
  }

  const deleteResult = await supabaseAdmin
    .from("contracts")
    .delete()
    .eq("organization_id", organizationId)
    .in("id", conflictingIds);

  if (deleteResult.error) {
    throw new Error(
      `Unable to delete changed Pennylane contracts: ${deleteResult.error.message}`,
    );
  }
}

async function pruneStalePennylaneContracts({
  organizationId,
  sourceExternalIds,
  supabaseAdmin,
}: {
  organizationId: string;
  sourceExternalIds: string[];
  supabaseAdmin: SupabaseAdminClient;
}) {
  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select("id, source_external_id")
    .eq("organization_id", organizationId)
    .eq("source_system", "pennylane");

  if (error) {
    throw new Error(`Unable to load stale Pennylane contracts: ${error.message}`);
  }

  const currentExternalIds = new Set(sourceExternalIds);
  const staleIds = ((data ?? []) as Array<{
    id: string;
    source_external_id: string | null;
  }>).flatMap((contract) =>
    contract.source_external_id &&
    !currentExternalIds.has(contract.source_external_id)
      ? [contract.id]
      : [],
  );

  if (staleIds.length === 0) {
    return;
  }

  const deleteResult = await supabaseAdmin
    .from("contracts")
    .delete()
    .eq("organization_id", organizationId)
    .in("id", staleIds);

  if (deleteResult.error) {
    throw new Error(
      `Unable to prune stale Pennylane contracts: ${deleteResult.error.message}`,
    );
  }
}

function toExtractionInvoice(
  row: PennylaneInvoiceDbRow,
): PennylaneInvoiceForContractExtraction {
  return {
    amountCents: row.amount_cents,
    amountExcludingTaxCents: row.amount_excluding_tax_cents,
    currency: row.currency,
    dueDate: row.due_date,
    externalId: row.external_id,
    id: row.id,
    invoiceDate: row.invoice_date,
    invoiceNumber: row.invoice_number,
    issueDate: row.issue_date,
    label: row.label,
    rawJson: row.raw_json,
    sourceHash: row.source_hash,
    supplierExternalId: row.supplier_external_id,
    supplierName: row.supplier_name,
  };
}

function buildSupplierNameById(
  suppliers: PennylaneSupplierApiRow[],
): Map<string, string> {
  return new Map(
    suppliers.flatMap((supplier) => {
      const id = extractString(supplier, ["id"]);
      const name = extractString(supplier, ["name", "label"]);

      return id && name ? [[id, name]] : [];
    }),
  );
}

function extractString(
  value: Record<string, unknown>,
  paths: string[],
): string | null {
  for (const path of paths) {
    const rawValue = getPath(value, path);

    if (typeof rawValue === "string" && rawValue.trim()) {
      return rawValue.trim();
    }

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return String(rawValue);
    }
  }

  return null;
}

function extractDate(value: Record<string, unknown>, paths: string[]): string | null {
  const rawValue = extractString(value, paths);

  if (!rawValue) {
    return null;
  }

  const iso = rawValue.match(/^(\d{4}-\d{2}-\d{2})/);

  if (iso) {
    return iso[1];
  }

  const parsed = new Date(rawValue);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function extractAmountCents(
  value: Record<string, unknown>,
  paths: string[],
): number | null {
  for (const path of paths) {
    const rawValue = getPath(value, path);
    const numericValue = toNumber(rawValue);

    if (numericValue === null) {
      continue;
    }

    return path.includes("cents")
      ? Math.round(numericValue)
      : Math.round(numericValue * 100);
  }

  return null;
}

function extractPaymentStatus(invoice: Record<string, unknown>): boolean | null {
  const status = extractString(invoice, [
    "payment_status",
    "status",
    "paid_status",
  ])?.toLowerCase();

  if (!status) {
    return null;
  }

  if (status.includes("paid") || status.includes("complete")) {
    return true;
  }

  if (status.includes("pending") || status.includes("unpaid")) {
    return false;
  }

  return null;
}

function getPath(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/\s/g, "").replace(",", "."));

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function labelPennylaneError(label: string, error: unknown): string {
  return error instanceof Error ? `${label}: ${error.message}` : `${label} failed.`;
}
