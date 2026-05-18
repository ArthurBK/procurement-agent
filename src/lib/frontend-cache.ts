import "server-only";

import { cache } from "react";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import {
  loadContractDetail,
  loadContractGaps,
  loadContracts,
  type ContractDetail,
  type ContractGapsPayload,
  type ContractRow,
} from "@/lib/contracts/frontendData";
import {
  loadGoogleStatus,
  loadIdentitySignals,
  type GoogleStatusPayload,
  type IdentitySignalsPayload,
} from "@/lib/integrations/google/frontendData";
import {
  loadPennylaneStatus,
  type PennylaneFrontendStatus,
} from "@/lib/integrations/pennylane/frontendData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const FRONTEND_PATHS = [
  "/app/usage/identity",
  "/app/contracts",
  "/app/settings/integrations",
] as const;

const FRONTEND_CACHE_SCHEMA_VERSION = "2026-05-18.identity-domains-v2";

export const frontendCacheTags = {
  contractDetail: (organizationId: string, contractId: string) =>
    `frontend:contract-detail:${organizationId}:${contractId}`,
  contractGaps: (organizationId: string) =>
    `frontend:contract-gaps:${organizationId}`,
  contracts: (organizationId: string) => `frontend:contracts:${organizationId}`,
  googleStatus: (organizationId: string) =>
    `frontend:google-status:${organizationId}`,
  identitySignals: (organizationId: string) =>
    `frontend:identity-signals:${organizationId}`,
  pennylaneStatus: (organizationId: string) =>
    `frontend:pennylane-status:${organizationId}`,
};

export async function loadCachedGoogleStatus({
  organizationId,
}: {
  organizationId: string;
}): Promise<GoogleStatusPayload> {
  const version = await loadFrontendDataVersion(organizationId);

  return unstable_cache(
    async (cachedOrganizationId: string) =>
      loadGoogleStatus({
        organizationId: cachedOrganizationId,
        supabaseAdmin: createSupabaseAdminClient(),
      }),
    ["frontend-google-status", FRONTEND_CACHE_SCHEMA_VERSION, organizationId, version],
    {
      revalidate: false,
      tags: [frontendCacheTags.googleStatus(organizationId)],
    },
  )(organizationId);
}

export async function loadCachedIdentitySignals({
  organizationId,
}: {
  organizationId: string;
}): Promise<IdentitySignalsPayload> {
  const version = await loadFrontendDataVersion(organizationId);

  return unstable_cache(
    async (cachedOrganizationId: string) =>
      loadIdentitySignals({
        autoEnrichLogos: false,
        organizationId: cachedOrganizationId,
        supabaseAdmin: createSupabaseAdminClient(),
      }),
    [
      "frontend-identity-signals",
      FRONTEND_CACHE_SCHEMA_VERSION,
      organizationId,
      version,
    ],
    {
      revalidate: false,
      tags: [frontendCacheTags.identitySignals(organizationId)],
    },
  )(organizationId);
}

export async function loadCachedPennylaneStatus({
  organizationId,
}: {
  organizationId: string;
}): Promise<PennylaneFrontendStatus> {
  const version = await loadFrontendDataVersion(organizationId);

  return unstable_cache(
    async (cachedOrganizationId: string) =>
      loadPennylaneStatus({
        organizationId: cachedOrganizationId,
        recoverStaleRuns: false,
        supabaseAdmin: createSupabaseAdminClient(),
      }),
    [
      "frontend-pennylane-status",
      FRONTEND_CACHE_SCHEMA_VERSION,
      organizationId,
      version,
    ],
    {
      revalidate: false,
      tags: [frontendCacheTags.pennylaneStatus(organizationId)],
    },
  )(organizationId);
}

export async function loadCachedContracts({
  organizationId,
}: {
  organizationId: string;
}): Promise<ContractRow[]> {
  const version = await loadFrontendDataVersion(organizationId);

  return unstable_cache(
    async (cachedOrganizationId: string) =>
      loadContracts({
        organizationId: cachedOrganizationId,
        supabaseAdmin: createSupabaseAdminClient(),
      }),
    ["frontend-contracts", FRONTEND_CACHE_SCHEMA_VERSION, organizationId, version],
    {
      revalidate: false,
      tags: [frontendCacheTags.contracts(organizationId)],
    },
  )(organizationId);
}

export async function loadCachedContractGaps({
  organizationId,
}: {
  organizationId: string;
}): Promise<ContractGapsPayload> {
  const version = await loadFrontendDataVersion(organizationId);

  return unstable_cache(
    async (cachedOrganizationId: string) =>
      loadContractGaps({
        organizationId: cachedOrganizationId,
        supabaseAdmin: createSupabaseAdminClient(),
      }),
    [
      "frontend-contract-gaps",
      FRONTEND_CACHE_SCHEMA_VERSION,
      organizationId,
      version,
    ],
    {
      revalidate: false,
      tags: [frontendCacheTags.contractGaps(organizationId)],
    },
  )(organizationId);
}

export async function loadCachedContractDetail({
  contractId,
  organizationId,
}: {
  contractId: string;
  organizationId: string;
}): Promise<ContractDetail | null> {
  const version = await loadFrontendDataVersion(organizationId);

  return unstable_cache(
    async (cachedOrganizationId: string, cachedContractId: string) =>
      loadContractDetail({
        contractId: cachedContractId,
        organizationId: cachedOrganizationId,
        supabaseAdmin: createSupabaseAdminClient(),
      }),
    [
      "frontend-contract-detail",
      FRONTEND_CACHE_SCHEMA_VERSION,
      organizationId,
      contractId,
      version,
    ],
    {
      revalidate: false,
      tags: [
        frontendCacheTags.contracts(organizationId),
        frontendCacheTags.contractDetail(organizationId, contractId),
      ],
    },
  )(organizationId, contractId);
}

export function revalidateGoogleFrontendCache(organizationId: string) {
  revalidateTags([
    frontendCacheTags.googleStatus(organizationId),
    frontendCacheTags.identitySignals(organizationId),
    frontendCacheTags.contracts(organizationId),
    frontendCacheTags.contractGaps(organizationId),
  ]);
  revalidateFrontendPaths();
}

export function revalidatePennylaneFrontendCache(organizationId: string) {
  revalidateTags([
    frontendCacheTags.pennylaneStatus(organizationId),
    frontendCacheTags.contracts(organizationId),
    frontendCacheTags.contractGaps(organizationId),
    frontendCacheTags.identitySignals(organizationId),
  ]);
  revalidateFrontendPaths();
}

export function revalidateContractsFrontendCache(organizationId: string) {
  revalidateTags([
    frontendCacheTags.contracts(organizationId),
    frontendCacheTags.contractGaps(organizationId),
    frontendCacheTags.identitySignals(organizationId),
  ]);
  revalidateFrontendPaths();
}

function revalidateTags(tags: string[]) {
  for (const tag of tags) {
    revalidateTag(tag, { expire: 0 });
  }
}

function revalidateFrontendPaths() {
  for (const path of FRONTEND_PATHS) {
    revalidatePath(path);
  }
}

const loadFrontendDataVersion = cache(
  async (organizationId: string): Promise<string> => {
    const supabaseAdmin = createSupabaseAdminClient();
    const [integrationsResult, pennylaneRunResult] = await Promise.all([
      supabaseAdmin
        .from("integrations")
        .select(
          [
            "provider",
            "status",
            "last_sync_started_at",
            "last_sync_completed_at",
            "last_error",
            "updated_at",
          ].join(", "),
        )
        .eq("organization_id", organizationId)
        .in("provider", ["google_workspace", "pennylane"]),
      supabaseAdmin
        .from("pennylane_sync_runs")
        .select("status, started_at, completed_at")
        .eq("organization_id", organizationId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (integrationsResult.error) {
      throw new Error(
        `Unable to load frontend cache version: ${integrationsResult.error.message}`,
      );
    }

    if (pennylaneRunResult.error) {
      throw new Error(
        `Unable to load frontend cache version: ${pennylaneRunResult.error.message}`,
      );
    }

    const integrations = ((integrationsResult.data ?? []) as unknown as Array<{
      last_error: string | null;
      last_sync_completed_at: string | null;
      last_sync_started_at: string | null;
      provider: string;
      status: string | null;
      updated_at: string | null;
    }>).sort((left, right) => left.provider.localeCompare(right.provider));

    return JSON.stringify({
      integrations,
      pennylaneRun: pennylaneRunResult.data ?? null,
      schema: FRONTEND_CACHE_SCHEMA_VERSION,
    });
  },
);
