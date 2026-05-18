import assert from "node:assert/strict";
import test from "node:test";
import { inferSupplierNameFromSsoHints } from "./supplierNameInference.ts";

test("finds SSO-visible supplier in enriched invoice text", () => {
  const supplierName = inferSupplierNameFromSsoHints({
    invoice: {
      amount: "101.23",
      currency: "EUR",
      date: "2025-08-22",
      id: "aircall-invoice",
      label: "Facture SWIFTGUM - #INVFR0456148",
      pdf_text:
        "FACTURE Aircall SAS Standard User License Essentials 22 août 2025 - 21 sept. 2025",
      supplier: { id: "swiftgum-supplier" },
    },
    ssoSupplierHints: [{ supplierDomain: "aircall.io", supplierName: "Aircall" }],
  });

  assert.equal(supplierName, "Aircall");
});

test("does not infer a supplier when invoice text has no SSO-visible signal", () => {
  const supplierName = inferSupplierNameFromSsoHints({
    invoice: {
      amount: "18.50",
      currency: "EUR",
      date: "2025-08-22",
      id: "restaurant-invoice",
      label: "Facture Restaurant",
      pdf_text: "Restaurant receipt lunch menu",
      supplier: { id: "restaurant-supplier" },
    },
    ssoSupplierHints: [{ supplierDomain: "aircall.io", supplierName: "Aircall" }],
  });

  assert.equal(supplierName, null);
});
