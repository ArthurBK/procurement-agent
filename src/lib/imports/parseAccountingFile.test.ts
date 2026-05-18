import assert from "node:assert/strict";
import test from "node:test";
import { utils, write } from "xlsx";
import { parseAccountingFile } from "./parseAccountingFile.ts";

test("converts Excel serial dates to ISO date strings", () => {
  const buffer = buildWorkbookBuffer([
    ["Date", "Libellé", "Montant"],
    [45292, "Notion", -34.72],
  ]);

  const result = parseAccountingFile(buffer, "pennylane.xlsx");

  assert.equal(result.rows[0]?.date, "2024-01-01");
  assert.deepEqual(result.errors, []);
});

test("converts euro amounts to cents and preserves the sign", () => {
  const csv = [
    "Date,Libellé,Montant",
    "2024-01-01,Notion,-34.72",
    "2024-01-02,Refund,7000",
  ].join("\n");

  const result = parseAccountingFile(Buffer.from(csv), "transactions.csv");

  assert.equal(result.rows[0]?.amountCents, -3472);
  assert.equal(result.rows[1]?.amountCents, 700000);
  assert.deepEqual(result.errors, []);
});

test("maps Pennylane transaction rows", () => {
  const buffer = buildWorkbookBuffer([
    [
      "Date",
      "Mois",
      "Compte Bancaire",
      "Libellé",
      "Montant",
      "Tiers",
      "Justifié",
      "Commentaires",
      "État",
      "Type",
      "Suivi de trésorerie",
    ],
    [
      "15/01/2024",
      "2024-01",
      "Main account",
      "Google Workspace",
      "-12,34",
      "Google",
      "Oui",
      "Monthly payment",
      "Validé",
      "Carte",
      "Oui",
    ],
  ]);

  const result = parseAccountingFile(buffer, "pennylane.xlsx");

  assert.deepEqual(result.rows[0], {
    rowNumber: 2,
    date: "2024-01-15",
    rawSupplier: "Google Workspace",
    amountCents: -1234,
    currency: "EUR",
    bankAccount: "Main account",
    description: "Monthly payment",
    sourceRow: {
      Date: "15/01/2024",
      Mois: "2024-01",
      "Compte Bancaire": "Main account",
      Libellé: "Google Workspace",
      Montant: "-12,34",
      Tiers: "Google",
      Justifié: "Oui",
      Commentaires: "Monthly payment",
      État: "Validé",
      Type: "Carte",
      "Suivi de trésorerie": "Oui",
    },
  });
  assert.deepEqual(result.errors, []);
});

test("maps Qonto transaction export rows", () => {
  const csv = [
    [
      "Status",
      "Operation date (local)",
      "Total amount (incl. VAT)",
      "Currency",
      "Account name",
      "Counterparty name",
      "Reference",
      "Note",
    ].join(","),
    [
      "Settled",
      "11-05-2026 12:20:39",
      "-11.20",
      "EUR",
      "Compte principal",
      "MISTER GARDEN",
      "card-payment",
      "Team lunch",
    ].join(","),
    [
      "Settled",
      "10-05-2026 09:15:00",
      "1250.00",
      "EUR",
      "Compte principal",
      "Refund Inc",
      "refund-reference",
      "",
    ].join(","),
  ].join("\n");

  const result = parseAccountingFile(Buffer.from(csv), "qonto.csv");

  assert.deepEqual(result.rows[0], {
    rowNumber: 2,
    date: "2026-05-11",
    rawSupplier: "MISTER GARDEN",
    amountCents: -1120,
    currency: "EUR",
    bankAccount: "Compte principal",
    description: "Team lunch",
    sourceRow: {
      Status: "Settled",
      "Operation date (local)": "11-05-2026 12:20:39",
      "Total amount (incl. VAT)": "-11.20",
      Currency: "EUR",
      "Account name": "Compte principal",
      "Counterparty name": "MISTER GARDEN",
      Reference: "card-payment",
      Note: "Team lunch",
    },
  });
  assert.equal(result.rows[1]?.description, "refund-reference");
  assert.deepEqual(result.errors, []);
});

function buildWorkbookBuffer(rows: unknown[][]): Buffer {
  const workbook = utils.book_new();
  const worksheet = utils.aoa_to_sheet(rows);

  utils.book_append_sheet(workbook, worksheet, "Transactions bancaires");

  return write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;
}
