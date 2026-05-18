import { buildLogoUrl, normalizeDomain } from "@/lib/suppliers/logo";
import type { LogoSource } from "@/lib/suppliers/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type CreateSupplierProfileBody = {
  supplierKey?: string;
  displayName?: string;
  domain?: string | null;
  logoUrl?: string | null;
  logoSource?: string;
};

const LOGO_SOURCES: LogoSource[] = ["manual", "logo_dev", "uploaded", "none"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateSupplierProfileBody;
    const validation = validateCreateBody(body);

    if (!validation.ok) {
      return Response.json({ errors: [validation.error] }, { status: 400 });
    }

    const now = new Date().toISOString();
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: profile, error } = await supabaseAdmin
      .from("supplier_profiles")
      .upsert(
        {
          display_name: validation.value.displayName,
          domain: validation.value.domain,
          logo_source: validation.value.logoSource,
          logo_url: validation.value.logoUrl,
          supplier_key: validation.value.supplierKey,
          updated_at: now,
        },
        { onConflict: "supplier_key" },
      )
      .select("*")
      .single();

    if (error) {
      return Response.json(
        { errors: [`Unable to save supplier profile: ${error.message}`] },
        { status: 500 },
      );
    }

    return Response.json({ profile });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected supplier profile creation error.";

    return Response.json({ errors: [message] }, { status: 500 });
  }
}

function validateCreateBody(
  body: CreateSupplierProfileBody,
):
  | {
      ok: true;
      value: {
        supplierKey: string;
        displayName: string;
        domain: string | null;
        logoUrl: string | null;
        logoSource: LogoSource;
      };
    }
  | { ok: false; error: string } {
  const supplierKey = body.supplierKey?.trim();
  const displayName = body.displayName?.trim();

  if (!supplierKey) {
    return { error: "supplierKey is required.", ok: false };
  }

  if (!displayName) {
    return { error: "displayName is required.", ok: false };
  }

  if (body.logoSource !== undefined && !isLogoSource(body.logoSource)) {
    return { error: "logoSource is invalid.", ok: false };
  }

  const domain = normalizeDomain(body.domain);
  const providedLogoUrl = normalizeNullableString(body.logoUrl);

  if (domain && !providedLogoUrl) {
    return {
      ok: true,
      value: {
        displayName,
        domain,
        logoSource: "logo_dev",
        logoUrl: buildLogoUrl(domain),
        supplierKey,
      },
    };
  }

  if (!domain && !providedLogoUrl) {
    return {
      ok: true,
      value: {
        displayName,
        domain: null,
        logoSource: "none",
        logoUrl: null,
        supplierKey,
      },
    };
  }

  return {
    ok: true,
    value: {
      displayName,
      domain,
      logoSource: body.logoSource ?? "manual",
      logoUrl: providedLogoUrl,
      supplierKey,
    },
  };
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}

function isLogoSource(value: string): value is LogoSource {
  return LOGO_SOURCES.includes(value as LogoSource);
}
