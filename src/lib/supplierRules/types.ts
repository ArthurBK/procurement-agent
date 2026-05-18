export type SupplierRule = {
  id: string;
  supplier_key: string;
  canonical_supplier: string;
  business_category:
    | "software"
    | "cloud"
    | "ai"
    | "telecom"
    | "banking"
    | "workspace"
    | "professional_service"
    | "marketing"
    | "food"
    | "transport"
    | "travel"
    | "retail"
    | "income"
    | "unknown";
  default_decision: "auto_subscription" | "needs_review" | "excluded";
  match_type: "exact_supplier_key";
  source: "user" | "system";
  notes: string | null;
  active: boolean;
};

export type SupplierRuleInput = {
  supplierKey: string;
  canonicalSupplier: string;
  businessCategory: SupplierRule["business_category"];
  defaultDecision: SupplierRule["default_decision"];
  notes?: string | null;
};
