import { getPennylaneApiTimeoutMs } from "./client.ts";

export type PdfTextExtractionErrorCode =
  | "empty_pdf"
  | "invalid_pdf"
  | "timeout"
  | "unavailable";

export class PdfTextExtractionError extends Error {
  readonly cause: unknown;
  readonly code: PdfTextExtractionErrorCode;

  constructor(
    code: PdfTextExtractionErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "PdfTextExtractionError";
    this.code = code;
    this.cause = cause;
  }
}

export type PdfTextExtractionResult = {
  pageCount: number;
  text: string;
};

export async function extractPdfTextWithPdfJs(
  bytes: Buffer | Uint8Array,
): Promise<PdfTextExtractionResult> {
  let loadingTask:
    | {
        destroy?: () => Promise<void>;
        promise: Promise<{
          destroy: () => Promise<void>;
          getPage: (pageNumber: number) => Promise<{
            getTextContent: () => Promise<{ items: unknown[] }>;
          }>;
          numPages: number;
        }>;
      }
    | undefined;

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    loadingTask = pdfjs.getDocument({
      data: toUint8ArrayCopy(bytes),
      disableFontFace: true,
      stopAtErrors: false,
      useSystemFonts: true,
      useWorkerFetch: false,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });
    const document = await withTimeout(
      loadingTask.promise,
      getPdfTextExtractionTimeoutMs(),
    );

    try {
      const pages: string[] = [];

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await withTimeout(
          page.getTextContent(),
          getPdfTextExtractionTimeoutMs(),
        );
        const pageText = normalizeExtractedText(
          content.items.map(extractTextItemValue).filter(Boolean).join(" "),
        );

        if (pageText) {
          pages.push(pageText);
        }
      }

      const text = normalizeExtractedText(pages.join("\n\n"));

      if (!text) {
        throw new PdfTextExtractionError(
          "empty_pdf",
          "PDF text extraction returned no selectable text.",
        );
      }

      return {
        pageCount: document.numPages,
        text,
      };
    } finally {
      await document.destroy().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof PdfTextExtractionError) {
      throw error;
    }

    throw new PdfTextExtractionError(
      isPdfJsUnavailableError(error) ? "unavailable" : "invalid_pdf",
      "PDF text extraction with PDF.js failed.",
      error,
    );
  } finally {
    await loadingTask?.destroy?.().catch(() => undefined);
  }
}

export function isPdfTextExtractionUnavailableError(error: unknown): boolean {
  return (
    error instanceof PdfTextExtractionError &&
    error.code === "unavailable"
  );
}

function extractTextItemValue(item: unknown): string {
  if (!item || typeof item !== "object" || !("str" in item)) {
    return "";
  }

  const value = (item as { str?: unknown }).str;

  return typeof value === "string" ? value : "";
}

function getPdfTextExtractionTimeoutMs(): number {
  const rawValue = process.env.PENNYLANE_PDF_TEXT_EXTRACTION_TIMEOUT_MS;
  const parsedValue = rawValue ? Number(rawValue) : NaN;

  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return Math.floor(parsedValue);
  }

  return Math.max(15_000, getPennylaneApiTimeoutMs());
}

function isPdfJsUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Cannot find module") ||
    error.message.includes("ERR_MODULE_NOT_FOUND") ||
    error.message.includes("pdfjs-dist")
  );
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toUint8ArrayCopy(bytes: Buffer | Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new PdfTextExtractionError(
          "timeout",
          `PDF text extraction timed out after ${timeoutMs}ms.`,
        ),
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}
