import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { searchLogoDevBrands } from "@/lib/suppliers/logoDevSearch";
import { buildLogoSearchQueries } from "@/lib/suppliers/logoSearchQueries";
import type { LogoSource } from "@/lib/suppliers/types";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type CandidateSupplierRow = {
  corrected_supplier: string | null;
  supplier: string;
  supplier_key: string;
  system_decision: "auto_subscription" | "needs_review" | "excluded";
  user_decision: "confirmed" | "ignored" | null;
};

type ExistingSupplierProfileRow = {
  domain: string | null;
  logo_source: LogoSource;
  logo_url: string | null;
  supplier_key: string;
};

type SupplierProfileUpsert = {
  display_name: string;
  domain: string;
  logo_source: LogoSource;
  logo_url: string;
  supplier_key: string;
  updated_at: string;
};

type SupplierToSearch = {
  displayName: string;
  supplierKey: string;
};

export type AutoCreateSupplierProfilesResult = {
  createdCount: number;
  missingCount: number;
  searchedCount: number;
  skippedCount: number;
};

const MAX_AUTO_LOGO_SEARCHES = 20;

export async function autoCreateSupplierProfilesForImport({
  importId,
  supabaseAdmin,
}: {
  importId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<AutoCreateSupplierProfilesResult> {
  const publishableKey =
    process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY?.trim();

  if (!publishableKey) {
    throw new Error("NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY is not configured");
  }

  const { data: candidatesData, error: candidatesError } = await supabaseAdmin
    .from("recurring_payment_candidates")
    .select(
      [
        "supplier_key",
        "supplier",
        "corrected_supplier",
        "system_decision",
        "user_decision",
      ].join(", "),
    )
    .eq("import_id", importId);

  if (candidatesError) {
    throw new Error(
      `Unable to load recurring candidates: ${candidatesError.message}`,
    );
  }

  const suppliers = buildSuppliersToSearch(
    (candidatesData ?? []) as unknown as CandidateSupplierRow[],
  );

  if (suppliers.length === 0) {
    return {
      createdCount: 0,
      missingCount: 0,
      searchedCount: 0,
      skippedCount: 0,
    };
  }

  const { data: existingProfilesData, error: profilesError } =
    await supabaseAdmin
      .from("supplier_profiles")
      .select("supplier_key, domain, logo_url, logo_source")
      .in(
        "supplier_key",
        suppliers.map((supplier) => supplier.supplierKey),
      );

  if (profilesError) {
    throw new Error(
      `Unable to load supplier profiles: ${profilesError.message}`,
    );
  }

  const existingProfilesBySupplierKey = new Map(
    ((existingProfilesData ?? []) as unknown as ExistingSupplierProfileRow[]).map(
      (profile) => [profile.supplier_key, profile],
    ),
  );
  const missingSuppliers = suppliers.filter(
    (supplier) =>
      !hasDisplayableLogo(existingProfilesBySupplierKey.get(supplier.supplierKey)),
  );
  const suppliersToSearch = missingSuppliers.slice(0, MAX_AUTO_LOGO_SEARCHES);
  const upserts: SupplierProfileUpsert[] = [];
  const now = new Date().toISOString();

  for (const supplier of suppliersToSearch) {
    const resultWithLogo = await findLogoResult(supplier.displayName);

    if (!resultWithLogo?.logoUrl) {
      continue;
    }

    upserts.push({
      display_name: resultWithLogo.name,
      domain: resultWithLogo.domain,
      logo_source: "logo_dev",
      logo_url: resultWithLogo.logoUrl,
      supplier_key: supplier.supplierKey,
      updated_at: now,
    });
  }

  if (upserts.length > 0) {
    const { error: upsertError } = await supabaseAdmin
      .from("supplier_profiles")
      .upsert(upserts, {
        onConflict: "supplier_key",
      });

    if (upsertError) {
      throw new Error(`Unable to save supplier profiles: ${upsertError.message}`);
    }
  }

  return {
    createdCount: upserts.length,
    missingCount: missingSuppliers.length,
    searchedCount: suppliersToSearch.length,
    skippedCount: Math.max(0, missingSuppliers.length - suppliersToSearch.length),
  };
}

function hasDisplayableLogo(
  profile: ExistingSupplierProfileRow | undefined,
): boolean {
  if (!profile) {
    return false;
  }

  if (profile.logo_url) {
    return true;
  }

  return profile.logo_source === "logo_dev" && Boolean(profile.domain);
}

function buildSuppliersToSearch(
  candidates: CandidateSupplierRow[],
): SupplierToSearch[] {
  const suppliersByKey = new Map<string, SupplierToSearch>();

  for (const candidate of candidates) {
    if (!isEligibleForAutoLogo(candidate)) {
      continue;
    }

    const supplierKey = candidate.supplier_key.trim();
    const displayName = (
      candidate.corrected_supplier ?? candidate.supplier
    ).trim();

    if (!supplierKey || !displayName || suppliersByKey.has(supplierKey)) {
      continue;
    }

    suppliersByKey.set(supplierKey, {
      displayName,
      supplierKey,
    });
  }

  return Array.from(suppliersByKey.values());
}

async function findLogoResult(displayName: string) {
  for (const query of buildLogoSearchQueries(displayName)) {
    const results = await searchLogoDevBrands(query);
    const resultWithLogo = results.find((result) => result.logoUrl);

    if (resultWithLogo) {
      return resultWithLogo;
    }
  }

  return null;
}

function isEligibleForAutoLogo(candidate: CandidateSupplierRow): boolean {
  if (candidate.user_decision === "ignored") {
    return false;
  }

  if (candidate.user_decision === "confirmed") {
    return true;
  }

  return candidate.system_decision !== "excluded";
}
