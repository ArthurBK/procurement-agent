import { buildLogoUrl, normalizeDomain } from "@/lib/suppliers/logo";
import type { LogoSource, SupplierProfile } from "@/lib/suppliers/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type PatchSupplierProfileBody = {
  displayName?: string;
  domain?: string | null;
  logoUrl?: string | null;
  logoSource?: string;
};

const LOGO_SOURCES: LogoSource[] = ["manual", "logo_dev", "uploaded", "none"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = (await request.json()) as PatchSupplierProfileBody;
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: existingProfile, error: existingError } = await supabaseAdmin
      .from("supplier_profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      return Response.json(
        {
          errors: [
            `Unable to load supplier profile: ${existingError.message}`,
          ],
        },
        { status: 500 },
      );
    }

    if (!existingProfile) {
      return Response.json(
        { errors: ["Supplier profile not found."] },
        { status: 404 },
      );
    }

    const validation = validatePatchBody(
      body,
      existingProfile as unknown as SupplierProfile,
    );

    if (!validation.ok) {
      return Response.json({ errors: [validation.error] }, { status: 400 });
    }

    const { data: profile, error: updateError } = await supabaseAdmin
      .from("supplier_profiles")
      .update({
        ...validation.value,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return Response.json(
        { errors: [`Unable to update supplier profile: ${updateError.message}`] },
        { status: 500 },
      );
    }

    return Response.json({ profile });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected supplier profile update error.";

    return Response.json({ errors: [message] }, { status: 500 });
  }
}

function validatePatchBody(
  body: PatchSupplierProfileBody,
  existingProfile: SupplierProfile,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const update: Record<string, unknown> = {};
  let bodyLogoUrl: string | null | undefined;

  if (body.displayName !== undefined) {
    const displayName = body.displayName.trim();

    if (!displayName) {
      return { error: "displayName cannot be empty.", ok: false };
    }

    update.display_name = displayName;
  }

  if (body.logoSource !== undefined) {
    if (!isLogoSource(body.logoSource)) {
      return { error: "logoSource is invalid.", ok: false };
    }

    update.logo_source = body.logoSource;
  }

  if (body.logoUrl !== undefined) {
    bodyLogoUrl = normalizeNullableString(body.logoUrl);
    update.logo_url = bodyLogoUrl;

    if (body.logoSource === undefined) {
      update.logo_source = bodyLogoUrl ? "manual" : "none";
    }
  }

  if (body.domain !== undefined) {
    const domain = normalizeDomain(body.domain);
    const domainChanged = domain !== existingProfile.domain;

    update.domain = domain;

    if (
      domainChanged &&
      domain &&
      (bodyLogoUrl === null ||
        (bodyLogoUrl === undefined && !existingProfile.logo_url))
    ) {
      update.logo_url = buildLogoUrl(domain);
      update.logo_source = "logo_dev";
    }

    if (!domain && body.logoUrl === undefined && !existingProfile.logo_url) {
      update.logo_url = null;
      update.logo_source = "none";
    }
  }

  if (Object.keys(update).length === 0) {
    return { error: "No valid fields to update.", ok: false };
  }

  return { ok: true, value: update };
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
