import assert from "node:assert/strict";
import test from "node:test";
import {
  PdfTextExtractionError,
  extractPdfTextWithPdfJs,
} from "./pdfText.ts";

test("extractPdfTextWithPdfJs returns selectable text from a PDF", async () => {
  const result = await extractPdfTextWithPdfJs(
    buildSimplePdf("Notion renewal May 9 2026"),
  );

  assert.equal(result.pageCount, 1);
  assert.match(result.text, /Notion renewal May 9 2026/);
});

test("extractPdfTextWithPdfJs rejects invalid PDF bytes", async () => {
  await assert.rejects(
    () => extractPdfTextWithPdfJs(Buffer.from("not a pdf")),
    (error) =>
      error instanceof PdfTextExtractionError && error.code === "invalid_pdf",
  );
});

function buildSimplePdf(text: string): Buffer {
  const escapedText = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 24 Tf 100 700 Td (${escapedText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    [
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]",
      "/Resources << /Font << /F1 5 0 R >> >>",
      "/Contents 4 0 R >>",
    ].join(" "),
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const offsets: number[] = [];
  let body = "%PDF-1.4\n";

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body);
  const xrefRows = offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join("\n");
  body += [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    xrefRows,
    "trailer",
    `<< /Root 1 0 R /Size ${objects.length + 1} >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n");

  return Buffer.from(body);
}
