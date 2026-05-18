import {
  computeUtilization,
  getLoginFrequency,
  getUtilizationStatus,
} from "./usageMetrics.ts";

export type IdentityModeValue = "saml" | "oauth" | "authorized_app" | "unknown";
export type IdentityConfidenceValue = "high" | "medium" | "low" | "unknown";

export type IdentityTableSupplier = {
  confidence: IdentityConfidenceValue;
  identityMode: IdentityModeValue;
  lastSignalAt: string | null;
  monthlySpend: number | null;
  paidSeats: number | null;
  pricingSource?: "contract" | "shared_contract" | "supplier" | "unknown";
  supplierDomain: string | null;
  supplierName: string;
  usersWithSignal180d: number;
  usersWithSignal30d: number;
  usersWithSignal90d: number;
};

export type IdentityFilterProperty =
  | "application"
  | "confidence"
  | "identityMode"
  | "pricing"
  | "utilization";

export type IdentityFilterOperator = "contains" | "is" | "is_not";

export type IdentityFilterRule = {
  id: string;
  operator: IdentityFilterOperator;
  property: IdentityFilterProperty;
  value: string;
};

export type IdentityUtilizationValue =
  | "healthy"
  | "underutilized"
  | "needs_data";

export type IdentityPricingValue = "known" | "missing";

export type IdentityModeFilter = "all" | IdentityModeValue;
export type IdentityConfidenceFilter = "all" | IdentityConfidenceValue;
export type IdentityPricingFilter = "all" | IdentityPricingValue;
export type IdentityUtilizationFilter = "all" | IdentityUtilizationValue;

export type IdentityTableFilters = {
  confidence: IdentityConfidenceFilter;
  identityMode: IdentityModeFilter;
  pricing: IdentityPricingFilter;
  query: string;
  utilization: IdentityUtilizationFilter;
};

export type IdentitySortField =
  | "application"
  | "confidence"
  | "lastSignalAt"
  | "loginFrequency"
  | "loginUsers"
  | "monthlySpend"
  | "utilization";

export type IdentitySortDirection = "asc" | "desc";

export type IdentitySortRule = {
  direction: IdentitySortDirection;
  field: IdentitySortField;
  id: string;
};

export type IdentityTableSort = {
  direction: IdentitySortDirection;
  field: IdentitySortField;
};

export type IdentityTableState = {
  filters: IdentityFilterRule[];
  sorts: IdentitySortRule[];
};

type SerializedFilterRule = {
  o?: unknown;
  p?: unknown;
  v?: unknown;
};

type SerializedSortRule = {
  d?: unknown;
  f?: unknown;
};

const FILTER_PROPERTIES = new Set<IdentityFilterProperty>([
  "application",
  "confidence",
  "identityMode",
  "pricing",
  "utilization",
]);
const FILTER_OPERATORS = new Set<IdentityFilterOperator>([
  "contains",
  "is",
  "is_not",
]);
const SORT_FIELDS = new Set<IdentitySortField>([
  "application",
  "confidence",
  "lastSignalAt",
  "loginFrequency",
  "loginUsers",
  "monthlySpend",
  "utilization",
]);
const SORT_DIRECTIONS = new Set<IdentitySortDirection>(["asc", "desc"]);
const IDENTITY_MODE_VALUES = new Set<IdentityModeValue>([
  "saml",
  "oauth",
  "authorized_app",
  "unknown",
]);
const CONFIDENCE_VALUES = new Set<IdentityConfidenceValue>([
  "high",
  "medium",
  "low",
  "unknown",
]);
const PRICING_VALUES = new Set<IdentityPricingValue>(["known", "missing"]);
const UTILIZATION_VALUES = new Set<IdentityUtilizationValue>([
  "healthy",
  "underutilized",
  "needs_data",
]);

const DEFAULT_IDENTITY_TABLE_FILTER_VALUES: IdentityTableFilters = {
  confidence: "all",
  identityMode: "all",
  pricing: "all",
  query: "",
  utilization: "all",
};

export const DEFAULT_IDENTITY_TABLE_FILTERS = Object.assign(
  [],
  DEFAULT_IDENTITY_TABLE_FILTER_VALUES,
) as IdentityFilterRule[] & IdentityTableFilters;
export const DEFAULT_IDENTITY_TABLE_SORT: IdentityTableSort = {
  direction: "asc",
  field: "application",
};
export const DEFAULT_IDENTITY_TABLE_SORTS: IdentitySortRule[] = [];

export function applyIdentityTableControls<T extends IdentityTableSupplier>({
  filters,
  sort,
  suppliers,
}: {
  filters: IdentityTableFilters;
  sort: IdentityTableSort;
  suppliers: T[];
}): T[];
export function applyIdentityTableControls<T extends IdentityTableSupplier>({
  filters,
  sorts,
  suppliers,
}: {
  filters: IdentityFilterRule[];
  sorts: IdentitySortRule[];
  suppliers: T[];
}): T[];
export function applyIdentityTableControls<T extends IdentityTableSupplier>(
  args:
    | {
        filters: IdentityFilterRule[];
        sorts: IdentitySortRule[];
        suppliers: T[];
      }
    | {
        filters: IdentityTableFilters;
        sort: IdentityTableSort;
        suppliers: T[];
      },
): T[] {
  const filters = Array.isArray(args.filters)
    ? args.filters
    : legacyFiltersToRules(args.filters);
  const sorts =
    "sorts" in args ? args.sorts : legacySortToRules(args.sort);
  const suppliers = args.suppliers;
  const activeFilters = filters
    .map((filter, index) => normalizeFilterRule(filter, `filter-${index}`))
    .filter((filter): filter is IdentityFilterRule =>
      Boolean(filter && isActiveFilterRule(filter)),
    );
  const activeSorts = sorts
    .map((sort, index) => normalizeSortRule(sort, `sort-${index}`))
    .filter((sort): sort is IdentitySortRule => Boolean(sort));

  return suppliers
    .filter((supplier) =>
      activeFilters.every((filter) => matchesIdentityFilter(supplier, filter)),
    )
    .toSorted((left, right) =>
      compareIdentitySuppliers(left, right, activeSorts),
    );
}

export function createIdentityFilterRule(
  property: IdentityFilterProperty = "application",
): IdentityFilterRule {
  return {
    id: createRuleId("filter"),
    operator: getDefaultFilterOperator(property),
    property,
    value: getDefaultFilterValue(property),
  };
}

export function createIdentitySortRule(
  field: IdentitySortField = "application",
): IdentitySortRule {
  return {
    direction: field === "application" ? "asc" : "desc",
    field,
    id: createRuleId("sort"),
  };
}

export function getActiveIdentityFilterCount(
  filters: IdentityFilterRule[],
): number;
export function getActiveIdentityFilterCount(
  filters: IdentityTableFilters,
): number;
export function getActiveIdentityFilterCount(
  filters: IdentityFilterRule[] | IdentityTableFilters,
): number {
  const filterRules = Array.isArray(filters)
    ? filters
    : legacyFiltersToRules(filters);

  return filterRules.filter((filter, index) => {
    const normalized = normalizeFilterRule(filter, `filter-${index}`);

    return Boolean(normalized && isActiveFilterRule(normalized));
  }).length;
}

export function getDefaultFilterOperator(
  property: IdentityFilterProperty,
): IdentityFilterOperator {
  return property === "application" ? "contains" : "is";
}

export function getDefaultFilterValue(property: IdentityFilterProperty): string {
  if (property === "identityMode") {
    return "saml";
  }

  if (property === "confidence") {
    return "high";
  }

  if (property === "pricing") {
    return "known";
  }

  if (property === "utilization") {
    return "underutilized";
  }

  return "";
}

export function getIdentityUtilizationBucket(
  supplier: IdentityTableSupplier,
): IdentityUtilizationValue {
  if (supplier.identityMode !== "saml") {
    return "needs_data";
  }

  const utilization = computeUtilization(
    supplier.usersWithSignal90d,
    supplier.paidSeats,
  );
  const status = getUtilizationStatus(utilization.utilization);

  if (status === "needs_seat_data") {
    return "needs_data";
  }

  if (status === "underutilized" || status === "severe_underutilized") {
    return "underutilized";
  }

  return "healthy";
}

export function parseIdentityTableStateFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): IdentityTableState {
  const filters: IdentityFilterRule[] = [];
  const query = searchParams.get("q")?.trim();

  if (query) {
    filters.push({
      id: "filter-q",
      operator: "contains",
      property: "application",
      value: query,
    });
  }

  for (const [index, item] of parseJsonArray(
    searchParams.get("filters"),
  ).entries()) {
    const filter = normalizeSerializedFilterRule(item, `filter-${index}`);

    if (filter && isActiveFilterRule(filter)) {
      filters.push(filter);
    }
  }

  const sorts = parseJsonArray(searchParams.get("sorts"))
    .map((item, index) => normalizeSerializedSortRule(item, `sort-${index}`))
    .filter((sort): sort is IdentitySortRule => Boolean(sort));

  return { filters, sorts };
}

export function writeIdentityTableStateToSearchParams(
  params: URLSearchParams,
  state: IdentityTableState,
): URLSearchParams {
  const filters = state.filters
    .map((filter, index) => normalizeFilterRule(filter, `filter-${index}`))
    .filter((filter): filter is IdentityFilterRule =>
      Boolean(filter && isActiveFilterRule(filter)),
    );
  const queryFilterIndex = filters.findIndex(
    (filter) =>
      filter.property === "application" &&
      filter.operator === "contains" &&
      filter.value.trim().length > 0,
  );
  const queryFilter =
    queryFilterIndex >= 0 ? filters[queryFilterIndex] ?? null : null;
  const serializedFilters = filters
    .filter((_, index) => index !== queryFilterIndex)
    .map(serializeFilterRule);
  const serializedSorts = state.sorts
    .map((sort, index) => normalizeSortRule(sort, `sort-${index}`))
    .filter((sort): sort is IdentitySortRule => Boolean(sort))
    .map(serializeSortRule);

  if (queryFilter) {
    params.set("q", queryFilter.value.trim());
  } else {
    params.delete("q");
  }

  if (serializedFilters.length > 0) {
    params.set("filters", JSON.stringify(serializedFilters));
  } else {
    params.delete("filters");
  }

  if (serializedSorts.length > 0) {
    params.set("sorts", JSON.stringify(serializedSorts));
  } else {
    params.delete("sorts");
  }

  return params;
}

function matchesIdentityFilter(
  supplier: IdentityTableSupplier,
  filter: IdentityFilterRule,
): boolean {
  const leftValue = getFilterValue(supplier, filter.property);
  const rightValue = filter.value.trim().toLowerCase();
  let matches = false;

  if (filter.operator === "contains") {
    matches = leftValue.includes(rightValue);
  } else {
    matches = leftValue === rightValue;
  }

  return filter.operator === "is_not" ? !matches : matches;
}

function getFilterValue(
  supplier: IdentityTableSupplier,
  property: IdentityFilterProperty,
): string {
  if (property === "application") {
    return [supplier.supplierName, supplier.supplierDomain ?? ""]
      .join(" ")
      .toLowerCase();
  }

  if (property === "identityMode") {
    return supplier.identityMode;
  }

  if (property === "confidence") {
    return supplier.confidence;
  }

  if (property === "pricing") {
    return supplier.monthlySpend === null ? "missing" : "known";
  }

  return getIdentityUtilizationBucket(supplier);
}

function compareIdentitySuppliers(
  left: IdentityTableSupplier,
  right: IdentityTableSupplier,
  sorts: IdentitySortRule[],
): number {
  for (const sort of sorts) {
    const leftValue = getSortValue(left, sort.field);
    const rightValue = getSortValue(right, sort.field);
    const nullComparison = compareNullSortValues(leftValue, rightValue);

    if (nullComparison !== 0) {
      return nullComparison;
    }

    const comparison = compareSortValue(leftValue, rightValue);

    if (comparison !== 0) {
      return comparison * (sort.direction === "asc" ? 1 : -1);
    }
  }

  return left.supplierName.localeCompare(right.supplierName);
}

function compareNullSortValues(
  left: number | string | null,
  right: number | string | null,
): number {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return 0;
}

function getSortValue(
  supplier: IdentityTableSupplier,
  field: IdentitySortField,
): number | string | null {
  if (field === "application") {
    return supplier.supplierName.toLowerCase();
  }

  if (field === "confidence") {
    return confidenceRank(supplier.confidence);
  }

  if (field === "lastSignalAt") {
    return supplier.lastSignalAt ? Date.parse(supplier.lastSignalAt) : null;
  }

  if (field === "loginFrequency") {
    return loginFrequencyRank(supplier);
  }

  if (field === "loginUsers") {
    return supplier.usersWithSignal90d;
  }

  if (field === "monthlySpend") {
    return supplier.monthlySpend;
  }

  if (field === "utilization") {
    const utilization = computeUtilization(
      supplier.identityMode === "saml" ? supplier.usersWithSignal90d : 0,
      supplier.identityMode === "saml" ? supplier.paidSeats : null,
    );

    return utilization.utilization;
  }

  return null;
}

function compareSortValue(
  left: number | string | null,
  right: number | string | null,
): number {
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }

  return Number(left) - Number(right);
}

function confidenceRank(confidence: IdentityConfidenceValue): number {
  if (confidence === "high") {
    return 3;
  }

  if (confidence === "medium") {
    return 2;
  }

  if (confidence === "low") {
    return 1;
  }

  return 0;
}

function loginFrequencyRank(supplier: IdentityTableSupplier): number {
  const frequency = getLoginFrequency(
    supplier.usersWithSignal30d,
    supplier.usersWithSignal90d,
    supplier.usersWithSignal180d,
  );

  if (frequency === "high") {
    return 3;
  }

  if (frequency === "average") {
    return 2;
  }

  return 1;
}

function normalizeFilterRule(
  value: unknown,
  id: string,
): IdentityFilterRule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<IdentityFilterRule>;
  const property = isFilterProperty(candidate.property)
    ? candidate.property
    : null;

  if (!property) {
    return null;
  }

  const operator = isFilterOperator(candidate.operator)
    ? candidate.operator
    : getDefaultFilterOperator(property);
  const normalizedOperator =
    property === "application"
      ? "contains"
      : operator === "contains"
        ? "is"
        : operator;
  const rawValue =
    typeof candidate.value === "string"
      ? candidate.value
      : getDefaultFilterValue(property);
  const normalizedValue = normalizeFilterValue(property, rawValue);

  if (normalizedValue === null) {
    return null;
  }

  return {
    id: typeof candidate.id === "string" ? candidate.id : id,
    operator: normalizedOperator,
    property,
    value: normalizedValue,
  };
}

function normalizeSerializedFilterRule(
  value: unknown,
  id: string,
): IdentityFilterRule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as SerializedFilterRule;

  return normalizeFilterRule(
    {
      id,
      operator: candidate.o,
      property: candidate.p,
      value: candidate.v,
    },
    id,
  );
}

function normalizeSortRule(value: unknown, id: string): IdentitySortRule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<IdentitySortRule>;

  if (!isSortField(candidate.field)) {
    return null;
  }

  return {
    direction: isSortDirection(candidate.direction) ? candidate.direction : "asc",
    field: candidate.field,
    id: typeof candidate.id === "string" ? candidate.id : id,
  };
}

function normalizeSerializedSortRule(
  value: unknown,
  id: string,
): IdentitySortRule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as SerializedSortRule;

  return normalizeSortRule(
    {
      direction: candidate.d,
      field: candidate.f,
      id,
    },
    id,
  );
}

function isActiveFilterRule(filter: IdentityFilterRule): boolean {
  if (filter.property === "application") {
    return filter.value.trim().length > 0;
  }

  return normalizeFilterValue(filter.property, filter.value) !== null;
}

function normalizeFilterValue(
  property: IdentityFilterProperty,
  value: string,
): string | null {
  const normalized = value.trim();

  if (property === "application") {
    return normalized;
  }

  if (property === "identityMode") {
    return isIdentityModeValue(normalized) ? normalized : null;
  }

  if (property === "confidence") {
    return isConfidenceValue(normalized) ? normalized : null;
  }

  if (property === "pricing") {
    return isPricingValue(normalized) ? normalized : null;
  }

  return isUtilizationValue(normalized) ? normalized : null;
}

function serializeFilterRule(filter: IdentityFilterRule): SerializedFilterRule {
  return {
    o: filter.operator,
    p: filter.property,
    v: filter.value.trim(),
  };
}

function serializeSortRule(sort: IdentitySortRule): SerializedSortRule {
  return {
    d: sort.direction,
    f: sort.field,
  };
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isFilterProperty(value: unknown): value is IdentityFilterProperty {
  return typeof value === "string" && FILTER_PROPERTIES.has(value as IdentityFilterProperty);
}

function isFilterOperator(value: unknown): value is IdentityFilterOperator {
  return typeof value === "string" && FILTER_OPERATORS.has(value as IdentityFilterOperator);
}

function isSortField(value: unknown): value is IdentitySortField {
  return typeof value === "string" && SORT_FIELDS.has(value as IdentitySortField);
}

function isSortDirection(value: unknown): value is IdentitySortDirection {
  return typeof value === "string" && SORT_DIRECTIONS.has(value as IdentitySortDirection);
}

function isIdentityModeValue(value: string): value is IdentityModeValue {
  return IDENTITY_MODE_VALUES.has(value as IdentityModeValue);
}

function isConfidenceValue(value: string): value is IdentityConfidenceValue {
  return CONFIDENCE_VALUES.has(value as IdentityConfidenceValue);
}

function isPricingValue(value: string): value is IdentityPricingValue {
  return PRICING_VALUES.has(value as IdentityPricingValue);
}

function isUtilizationValue(value: string): value is IdentityUtilizationValue {
  return UTILIZATION_VALUES.has(value as IdentityUtilizationValue);
}

function createRuleId(prefix: "filter" | "sort"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function legacyFiltersToRules(filters: IdentityTableFilters): IdentityFilterRule[] {
  const rules: IdentityFilterRule[] = [];

  if (filters.query.trim()) {
    rules.push({
      id: "filter-query",
      operator: "contains",
      property: "application",
      value: filters.query,
    });
  }

  if (filters.identityMode !== "all") {
    rules.push({
      id: "filter-identity",
      operator: "is",
      property: "identityMode",
      value: filters.identityMode,
    });
  }

  if (filters.confidence !== "all") {
    rules.push({
      id: "filter-confidence",
      operator: "is",
      property: "confidence",
      value: filters.confidence,
    });
  }

  if (filters.pricing !== "all") {
    rules.push({
      id: "filter-pricing",
      operator: "is",
      property: "pricing",
      value: filters.pricing,
    });
  }

  if (filters.utilization !== "all") {
    rules.push({
      id: "filter-utilization",
      operator: "is",
      property: "utilization",
      value: filters.utilization,
    });
  }

  return rules;
}

function legacySortToRules(sort: IdentityTableSort): IdentitySortRule[] {
  if (
    sort.field === DEFAULT_IDENTITY_TABLE_SORT.field &&
    sort.direction === DEFAULT_IDENTITY_TABLE_SORT.direction
  ) {
    return [];
  }

  return [
    {
      direction: sort.direction,
      field: sort.field,
      id: "sort-legacy",
    },
  ];
}
