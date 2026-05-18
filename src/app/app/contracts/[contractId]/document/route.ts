import { NextResponse } from "next/server";
import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { PennylaneClient } from "@/lib/integrations/pennylane/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ contractId: string }> },
) {
  try {
    const { contractId } = await params;
    const { organizationId } = await getIntegrationRequestContext();
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: contract, error: contractError } = await supabaseAdmin
      .from("contracts")
      .select("id, source_document_id, source_external_id, vendor_name")
      .eq("organization_id", organizationId)
      .eq("id", contractId)
      .maybeSingle();

    if (contractError) {
      return new Response("Unable to load contract.", { status: 500 });
    }

    if (!contract) {
      return new Response("Contract not found.", { status: 404 });
    }

    if (!contract.source_document_id) {
      return redirectToContractDetail(request, contractId);
    }

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("pennylane_supplier_invoices")
      .select("attachment_url, external_id, invoice_number, raw_json, supplier_name")
      .eq("organization_id", organizationId)
      .eq("id", contract.source_document_id)
      .maybeSingle();

    if (invoiceError) {
      return new Response("Unable to load contract document.", { status: 500 });
    }

    const invoiceRawJson =
      typeof invoice?.raw_json === "object" && invoice.raw_json !== null
        ? (invoice.raw_json as Record<string, unknown>)
        : null;
    const attachmentUrl =
      (typeof invoice?.attachment_url === "string"
        ? invoice.attachment_url
        : null) ??
      (invoiceRawJson
        ? extractString(invoiceRawJson, [
            "public_file_url",
            "file_url",
            "attachment_url",
            "document_url",
            "pdf_url",
          ])
        : null);
    const firstPdf = attachmentUrl ? await downloadPdf(attachmentUrl) : null;
    const refreshedPdf = firstPdf
      ? null
      : await downloadRefreshedPennylanePdf(
          typeof invoice?.external_id === "string" ? invoice.external_id : null,
        );
    const pdf = firstPdf ?? refreshedPdf;

    if (!pdf) {
      return redirectToContractDetail(request, contractId);
    }

    return new Response(pdf.bytes, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${buildPdfFilename({
          invoiceNumber:
            typeof invoice?.invoice_number === "string"
              ? invoice.invoice_number
              : null,
          supplierName:
            typeof invoice?.supplier_name === "string"
              ? invoice.supplier_name
              : contract.vendor_name,
        })}"`,
        "Content-Type": pdf.contentType,
      },
    });
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    return new Response("Unable to load contract document.", { status: 500 });
  }
}

function redirectToContractDetail(request: Request, contractId: string): NextResponse {
  const response = NextResponse.redirect(
    new URL(`/app/contracts/${contractId}`, request.url),
  );
  response.headers.set("Cache-Control", "no-store");

  return response;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

async function downloadPdf(
  attachmentUrl: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const candidates = Array.from(
    new Set(
      [attachmentUrl, normalizePennylanePublicPdfUrl(attachmentUrl)].filter(
        (candidate): candidate is string => typeof candidate === "string",
      ),
    ),
  );

  for (const candidate of candidates) {
    const url = parseHttpUrl(candidate);

    if (!url) {
      continue;
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/pdf,application/octet-stream,*/*",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      continue;
    }

    const bytes = await response.arrayBuffer();

    if (bytes.byteLength === 0) {
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "application/pdf";

    return {
      bytes,
      contentType: contentType.includes("pdf")
        ? contentType
        : "application/pdf",
    };
  }

  return null;
}

async function downloadRefreshedPennylanePdf(
  sourceExternalId: string | null,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!sourceExternalId) {
    return null;
  }

  try {
    const invoice = await new PennylaneClient().getSupplierInvoice(sourceExternalId);
    const attachmentUrl = extractString(invoice, [
      "public_file_url",
      "file_url",
      "attachment_url",
      "document_url",
      "pdf_url",
    ]);

    return attachmentUrl ? downloadPdf(attachmentUrl) : null;
  } catch {
    return null;
  }
}

function buildPdfFilename({
  invoiceNumber,
  supplierName,
}: {
  invoiceNumber: string | null;
  supplierName: string;
}): string {
  const parts = [supplierName, invoiceNumber].filter(Boolean).join("-");
  const safeName = parts
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${safeName || "contract"}.pdf`;
}

function extractString(
  value: Record<string, unknown>,
  paths: string[],
): string | null {
  for (const path of paths) {
    const result = getNestedValue(value, path);

    if (typeof result === "string" && result.trim()) {
      return result.trim();
    }

    if (typeof result === "number") {
      return String(result);
    }
  }

  return null;
}

function getNestedValue(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, value);
}

function normalizePennylanePublicPdfUrl(value: string): string | null {
  const marker = "encrypted_id=";
  const markerIndex = value.indexOf(marker);

  if (!value.includes("/public/invoice/pdf") || markerIndex === -1) {
    return null;
  }

  const valueStart = markerIndex + marker.length;
  const nextParamIndex = value.indexOf("&", valueStart);
  const valueEnd = nextParamIndex === -1 ? value.length : nextParamIndex;
  const rawEncryptedId = value.slice(valueStart, valueEnd);

  try {
    return `${value.slice(0, valueStart)}${encodeURIComponent(
      decodeURIComponent(rawEncryptedId),
    )}${value.slice(valueEnd)}`;
  } catch {
    return null;
  }
}
