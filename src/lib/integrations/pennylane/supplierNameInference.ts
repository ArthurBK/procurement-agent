import { AI_CONTRACT_EXTRACTION_RAW_JSON_KEY } from "../../contracts/aiExtraction.ts";
import { normalizeContractVendorName } from "../../contracts/normalization.ts";
import type { PennylaneSupplierInvoiceApiRow } from "./client.ts";

export type SsoSupplierHint = {
  supplierDomain: string | null;
  supplierName: string;
};

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

export function inferSupplierNameFromSsoHints({
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

export function inferSupplierNameFromFilename(
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

function getSsoHintCandidates(hint: SsoSupplierHint): string[] {
  const normalizedName = normalizeContractVendorName(hint.supplierName);
  const domainStem = normalizeContractVendorName(
    hint.supplierDomain?.split(".")[0] ?? "",
  );
  const firstNameToken = normalizedName.split(" ")[0] ?? "";

  const candidates = [
    normalizedName,
    domainStem,
    firstNameToken.length >= 5 ? firstNameToken : "",
  ];

  return Array.from(
    new Set(
      candidates
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

function getPath(value: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
