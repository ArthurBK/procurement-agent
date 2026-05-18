const LEGAL_SUFFIXES = new Set([
  "inc",
  "llc",
  "ltd",
  "limited",
  "sas",
  "sarl",
  "gmbh",
  "corp",
  "corporation",
]);

const PAYMENT_NOISE = new Set([
  "cb",
  "card",
  "payment",
  "paiement",
  "pos",
  "sepa",
  "ach",
]);

export function normalizeSupplierKey(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => !LEGAL_SUFFIXES.has(token))
    .filter((token) => !PAYMENT_NOISE.has(token))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
