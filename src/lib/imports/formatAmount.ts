export function formatAmountCents(
  amountCents: number | null,
  currency = "EUR",
): string {
  if (amountCents === null) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    currency,
    style: "currency",
  }).format(amountCents / 100);
}
