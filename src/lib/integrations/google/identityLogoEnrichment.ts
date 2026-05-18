import "server-only";

import { normalizeSupplierKey } from "@/lib/recurring/normalizeSupplierKey";
import { buildLogoUrl, normalizeDomain } from "@/lib/suppliers/logo";
import {
  searchLogoDevBrands,
  type LogoDevSearchResult,
} from "@/lib/suppliers/logoDevSearch";
import { buildLogoSearchQueries } from "@/lib/suppliers/logoSearchQueries";
import type { LogoSource } from "@/lib/suppliers/types";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type SupplierLogoProfileRow = {
  display_name: string;
  domain: string | null;
  logo_source: LogoSource;
  logo_url: string | null;
  supplier_key: string;
};

type SaasSupplierLogoRow = {
  id: string;
  supplier_domain: string | null;
  supplier_name: string;
};

type SupplierProfileUpsert = {
  display_name: string;
  domain: string | null;
  logo_source: LogoSource;
  logo_url: string | null;
  supplier_key: string;
  updated_at: string;
};

const MAX_IDENTITY_LOGO_SEARCHES = 20;

export async function autoEnrichIdentitySupplierLogos({
  limit = MAX_IDENTITY_LOGO_SEARCHES,
  organizationId,
  supabaseAdmin,
}: {
  limit?: number;
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<void> {
  if (
    !process.env.LOGO_DEV_SECRET_KEY?.trim() ||
    !process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY?.trim()
  ) {
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("saas_suppliers")
    .select("id, supplier_name, supplier_domain")
    .eq("organization_id", organizationId)
    .order("supplier_name", { ascending: true });

  if (error) {
    throw new Error(`Unable to load suppliers for logo enrichment: ${error.message}`);
  }

  const suppliers = (data ?? []) as unknown as SaasSupplierLogoRow[];
  const supplierKeys = buildSupplierKeys(suppliers);

  if (supplierKeys.length === 0) {
    return;
  }

  const profilesByKey = await loadSupplierProfilesByKey({
    supplierKeys,
    supabaseAdmin,
  });
  const upserts: SupplierProfileUpsert[] = [];
  const suppliersToSearch: SaasSupplierLogoRow[] = [];

  for (const supplier of suppliers) {
    const supplierKey = normalizeSupplierKey(supplier.supplier_name);
    const profile = profilesByKey.get(supplierKey);

    if (
      normalizeDomain(supplier.supplier_domain) ||
      hasDisplayableLogo(profile) ||
      profile?.logo_source === "none" ||
      !supplierKey
    ) {
      continue;
    }

    suppliersToSearch.push(supplier);
  }

  const now = new Date().toISOString();

  for (const supplier of suppliersToSearch.slice(0, limit)) {
    const supplierKey = normalizeSupplierKey(supplier.supplier_name);
    const result = await findLogoResult(supplier.supplier_name);

    if (!result) {
      upserts.push({
        display_name: supplier.supplier_name,
        domain: null,
        logo_source: "none",
        logo_url: null,
        supplier_key: supplierKey,
        updated_at: now,
      });
      continue;
    }

    upserts.push({
      display_name: result.name,
      domain: result.domain,
      logo_source: "logo_dev",
      logo_url: result.logoUrl,
      supplier_key: supplierKey,
      updated_at: now,
    });
  }

  if (upserts.length > 0) {
    const { error: upsertError } = await supabaseAdmin
      .from("supplier_profiles")
      .upsert(upserts, { onConflict: "supplier_key" });

    if (upsertError) {
      throw new Error(`Unable to save identity supplier logos: ${upsertError.message}`);
    }
  }
}

export async function loadSupplierLogoProfilesByName({
  supplierNames,
  supabaseAdmin,
}: {
  supplierNames: string[];
  supabaseAdmin: SupabaseAdminClient;
}): Promise<Map<string, SupplierLogoProfileRow>> {
  const supplierKeys = Array.from(
    new Set(
      supplierNames
        .map((supplierName) => normalizeSupplierKey(supplierName))
        .filter((supplierKey) => supplierKey.length > 0),
    ),
  );

  return loadSupplierProfilesByKey({ supplierKeys, supabaseAdmin });
}

export function getSupplierLogoUrl({
  profile,
  supplierDomain,
}: {
  profile: SupplierLogoProfileRow | undefined;
  supplierDomain: string | null;
}): string | null {
  const normalizedSupplierDomain = normalizeDomain(supplierDomain);
  const normalizedProfileDomain = normalizeDomain(profile?.domain);

  if (profile?.logo_url) {
    return !normalizedSupplierDomain ||
      normalizedProfileDomain === normalizedSupplierDomain
      ? profile.logo_url
      : buildLogoUrl(normalizedSupplierDomain);
  }

  if (
    profile?.domain &&
    (!normalizedSupplierDomain || normalizedProfileDomain === normalizedSupplierDomain)
  ) {
    return buildLogoUrl(profile.domain);
  }

  return buildLogoUrl(supplierDomain);
}

async function loadSupplierProfilesByKey({
  supplierKeys,
  supabaseAdmin,
}: {
  supplierKeys: string[];
  supabaseAdmin: SupabaseAdminClient;
}): Promise<Map<string, SupplierLogoProfileRow>> {
  if (supplierKeys.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .from("supplier_profiles")
    .select("supplier_key, display_name, domain, logo_url, logo_source")
    .in("supplier_key", supplierKeys);

  if (error) {
    throw new Error(`Unable to load supplier logo profiles: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as unknown as SupplierLogoProfileRow[]).map((profile) => [
      profile.supplier_key,
      profile,
    ]),
  );
}

async function findLogoResult(
  supplierName: string,
): Promise<LogoDevSearchResult | null> {
  for (const query of buildLogoSearchQueries(supplierName)) {
    const results = await searchLogoDevBrands(query).catch(() => []);
    const resultWithLogo = results.find((result) => result.logoUrl);

    if (resultWithLogo) {
      return resultWithLogo;
    }
  }

  return null;
}

function hasDisplayableLogo(
  profile: SupplierLogoProfileRow | undefined,
): boolean {
  if (!profile) {
    return false;
  }

  if (profile.logo_url) {
    return true;
  }

  return profile.logo_source === "logo_dev" && Boolean(profile.domain);
}

function buildSupplierKeys(suppliers: SaasSupplierLogoRow[]): string[] {
  return Array.from(
    new Set(
      suppliers
        .map((supplier) => normalizeSupplierKey(supplier.supplier_name))
        .filter((supplierKey) => supplierKey.length > 0),
    ),
  );
}
