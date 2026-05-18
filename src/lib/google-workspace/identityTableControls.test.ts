import assert from "node:assert/strict";
import test from "node:test";
import {
  applyIdentityTableControls,
  getActiveIdentityFilterCount,
  getIdentityUtilizationBucket,
  parseIdentityTableStateFromSearchParams,
  writeIdentityTableStateToSearchParams,
  type IdentityTableSupplier,
} from "./identityTableControls.ts";

test("applies multiple identity filter rules with AND semantics", () => {
  const rows = applyIdentityTableControls({
    filters: [
      {
        id: "filter-1",
        operator: "contains",
        property: "application",
        value: "air",
      },
      {
        id: "filter-2",
        operator: "is",
        property: "identityMode",
        value: "saml",
      },
      {
        id: "filter-3",
        operator: "is",
        property: "utilization",
        value: "underutilized",
      },
    ],
    sorts: [],
    suppliers: [
      supplier({
        identityMode: "saml",
        paidSeats: 10,
        supplierName: "Aircall",
        usersWithSignal90d: 2,
      }),
      supplier({
        identityMode: "oauth",
        supplierName: "Airbnb",
      }),
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.supplierName),
    ["Aircall"],
  );
});

test("supports is not filters", () => {
  const rows = applyIdentityTableControls({
    filters: [
      {
        id: "filter-1",
        operator: "is_not",
        property: "confidence",
        value: "low",
      },
    ],
    sorts: [],
    suppliers: [
      supplier({ confidence: "high", supplierName: "Slack" }),
      supplier({ confidence: "low", supplierName: "Legacy" }),
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.supplierName),
    ["Slack"],
  );
});

test("sorts identity suppliers by multiple sort rules", () => {
  const rows = applyIdentityTableControls({
    filters: [],
    sorts: [
      { direction: "desc", field: "loginUsers", id: "sort-1" },
      { direction: "asc", field: "application", id: "sort-2" },
    ],
    suppliers: [
      supplier({ supplierName: "Notion", usersWithSignal90d: 3 }),
      supplier({ supplierName: "Slack", usersWithSignal90d: 11 }),
      supplier({ supplierName: "Qonto", usersWithSignal90d: 11 }),
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.supplierName),
    ["Qonto", "Slack", "Notion"],
  );
});

test("keeps null sort values after known values in either direction", () => {
  const rows = applyIdentityTableControls({
    filters: [],
    sorts: [{ direction: "desc", field: "monthlySpend", id: "sort-1" }],
    suppliers: [
      supplier({ monthlySpend: null, supplierName: "Unknown" }),
      supplier({ monthlySpend: 200, supplierName: "Qonto" }),
      supplier({ monthlySpend: 100, supplierName: "Slack" }),
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.supplierName),
    ["Qonto", "Slack", "Unknown"],
  );
});

test("counts active filters and ignores empty text filters", () => {
  assert.equal(
    getActiveIdentityFilterCount([
      {
        id: "filter-1",
        operator: "contains",
        property: "application",
        value: "",
      },
      {
        id: "filter-2",
        operator: "is",
        property: "identityMode",
        value: "saml",
      },
    ]),
    1,
  );
});

test("buckets identity utilization for table filters", () => {
  assert.equal(
    getIdentityUtilizationBucket(
      supplier({
        identityMode: "saml",
        paidSeats: 20,
        usersWithSignal90d: 4,
      }),
    ),
    "underutilized",
  );
  assert.equal(
    getIdentityUtilizationBucket(supplier({ identityMode: "oauth" })),
    "needs_data",
  );
});

test("parses and serializes table state through URL search params", () => {
  const params = new URLSearchParams();

  writeIdentityTableStateToSearchParams(params, {
    filters: [
      {
        id: "filter-1",
        operator: "contains",
        property: "application",
        value: "notion",
      },
      {
        id: "filter-2",
        operator: "is_not",
        property: "confidence",
        value: "low",
      },
    ],
    sorts: [{ direction: "desc", field: "loginUsers", id: "sort-1" }],
  });

  assert.equal(params.get("q"), "notion");
  assert.equal(params.has("filters"), true);
  assert.equal(params.has("sorts"), true);

  const state = parseIdentityTableStateFromSearchParams(params);

  assert.deepEqual(
    state.filters.map(({ operator, property, value }) => ({
      operator,
      property,
      value,
    })),
    [
      { operator: "contains", property: "application", value: "notion" },
      { operator: "is_not", property: "confidence", value: "low" },
    ],
  );
  assert.deepEqual(
    state.sorts.map(({ direction, field }) => ({ direction, field })),
    [{ direction: "desc", field: "loginUsers" }],
  );
});

test("invalid URL state falls back to empty defaults", () => {
  const params = new URLSearchParams({
    filters: JSON.stringify([{ p: "bad", o: "is", v: "x" }]),
    sorts: "not-json",
  });
  const state = parseIdentityTableStateFromSearchParams(params);

  assert.deepEqual(state.filters, []);
  assert.deepEqual(state.sorts, []);
});

function supplier(
  overrides: Partial<IdentityTableSupplier> = {},
): IdentityTableSupplier {
  return {
    confidence: "high",
    identityMode: "saml",
    lastSignalAt: null,
    monthlySpend: null,
    paidSeats: null,
    supplierDomain: null,
    supplierName: "Supplier",
    usersWithSignal180d: 0,
    usersWithSignal30d: 0,
    usersWithSignal90d: 0,
    ...overrides,
  };
}
