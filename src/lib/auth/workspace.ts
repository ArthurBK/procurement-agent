import "server-only";

import type { User } from "@supabase/supabase-js";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/auth/constants";
import type { MemberRole, WorkspaceContext } from "@/lib/auth/types";
import {
  WorkspaceAuthError,
  chooseRoleForNewMember,
  createWorkspaceNameFromDomain,
  createWorkspaceSlugFromDomain,
  getEnterpriseEmailDomain,
  normalizeUserEmail,
} from "@/lib/auth/workspace-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type OrganizationRow = {
  id: string;
  name: string;
  primary_domain: string | null;
  slug: string;
};

type OrganizationMemberRow = {
  role: MemberRole;
};

export async function getAuthenticatedWorkspaceContext(): Promise<WorkspaceContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new WorkspaceAuthError(
      "authentication_required",
      "Sign in with Google to continue.",
      401,
    );
  }

  return ensureWorkspaceForUser({
    supabaseAdmin: createSupabaseAdminClient(),
    user,
  });
}

export async function ensureWorkspaceForUser({
  supabaseAdmin,
  user,
}: {
  supabaseAdmin: SupabaseAdminClient;
  user: Pick<User, "email" | "id">;
}): Promise<WorkspaceContext> {
  const userEmail = normalizeUserEmail(user.email);
  const workspaceDomain = getEnterpriseEmailDomain(userEmail);
  const organization = await findOrCreateOrganizationForDomain({
    domain: workspaceDomain,
    supabaseAdmin,
    userId: user.id,
  });
  const role = await ensureOrganizationMembership({
    email: userEmail,
    organizationId: organization.id,
    supabaseAdmin,
    userId: user.id,
  });

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    role,
    userEmail,
    userId: user.id,
    workspaceDomain,
  };
}

async function findOrCreateOrganizationForDomain({
  domain,
  supabaseAdmin,
  userId,
}: {
  domain: string;
  supabaseAdmin: SupabaseAdminClient;
  userId: string;
}): Promise<OrganizationRow> {
  const existing = await loadOrganizationByDomain({ domain, supabaseAdmin });

  if (existing) {
    return existing;
  }

  const workspaceName = createWorkspaceNameFromDomain(domain);
  const workspaceSlug = createWorkspaceSlugFromDomain(domain);
  const claimedDefault = await claimDefaultOrganization({
    domain,
    name: workspaceName,
    slug: workspaceSlug,
    supabaseAdmin,
    userId,
  });

  if (claimedDefault) {
    return claimedDefault;
  }

  const { data, error } = await supabaseAdmin
    .from("organizations")
    .insert({
      created_by_user_id: userId,
      name: workspaceName,
      primary_domain: domain,
      slug: workspaceSlug,
    })
    .select("id, name, primary_domain, slug")
    .single();

  if (!error && data) {
    return data as OrganizationRow;
  }

  const organizationAfterRace = await loadOrganizationByDomain({
    domain,
    supabaseAdmin,
  });

  if (organizationAfterRace) {
    return organizationAfterRace;
  }

  throw new Error(
    `Unable to create workspace: ${error?.message ?? "missing organization row"}`,
  );
}

async function loadOrganizationByDomain({
  domain,
  supabaseAdmin,
}: {
  domain: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<OrganizationRow | null> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id, name, primary_domain, slug")
    .eq("primary_domain", domain)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load workspace: ${error.message}`);
  }

  return data ? (data as OrganizationRow) : null;
}

async function claimDefaultOrganization({
  domain,
  name,
  slug,
  supabaseAdmin,
  userId,
}: {
  domain: string;
  name: string;
  slug: string;
  supabaseAdmin: SupabaseAdminClient;
  userId: string;
}): Promise<OrganizationRow | null> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .update({
      created_by_user_id: userId,
      name,
      primary_domain: domain,
      slug,
    })
    .eq("id", DEFAULT_ORGANIZATION_ID)
    .is("primary_domain", null)
    .select("id, name, primary_domain, slug")
    .maybeSingle();

  if (error) {
    return null;
  }

  return data ? (data as OrganizationRow) : null;
}

async function ensureOrganizationMembership({
  email,
  organizationId,
  supabaseAdmin,
  userId,
}: {
  email: string;
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
  userId: string;
}): Promise<MemberRole> {
  const { data: existingMember, error: existingMemberError } =
    await supabaseAdmin
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

  if (existingMemberError) {
    throw new Error(
      `Unable to load workspace membership: ${existingMemberError.message}`,
    );
  }

  if (existingMember) {
    return (existingMember as OrganizationMemberRow).role;
  }

  const memberCount = await countOrganizationMembers({
    organizationId,
    supabaseAdmin,
  });
  const role = chooseRoleForNewMember(memberCount);
  const { error: insertError } = await supabaseAdmin
    .from("organization_members")
    .insert({
      email,
      organization_id: organizationId,
      role,
      user_id: userId,
    });

  if (!insertError) {
    return role;
  }

  const { data: memberAfterRace, error: memberAfterRaceError } =
    await supabaseAdmin
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

  if (memberAfterRaceError || !memberAfterRace) {
    throw new WorkspaceAuthError(
      "workspace_membership_required",
      `Unable to create workspace membership: ${
        insertError.message ?? memberAfterRaceError?.message
      }`,
      403,
    );
  }

  return (memberAfterRace as OrganizationMemberRow).role;
}

async function countOrganizationMembers({
  organizationId,
  supabaseAdmin,
}: {
  organizationId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(`Unable to count workspace members: ${error.message}`);
  }

  return count ?? 0;
}
