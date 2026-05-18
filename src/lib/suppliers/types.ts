export type LogoSource = "manual" | "logo_dev" | "uploaded" | "none";

export type SupplierProfile = {
  id: string;
  supplier_key: string;
  display_name: string;
  domain: string | null;
  logo_url: string | null;
  logo_source: LogoSource;
  created_at: string;
  updated_at: string;
};
