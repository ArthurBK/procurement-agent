import { logger, task } from "@trigger.dev/sdk/v3";
import { DEFAULT_ACTOR_USER_ID } from "@/lib/auth/constants";
import type { IntegrationRequestContext } from "@/lib/auth/types";
import { runPennylaneSync } from "@/lib/integrations/pennylane/sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type PennylaneSyncTaskPayload = {
  organizationId: string;
  userId?: string | null;
};

export const pennylaneSyncTask = task({
  id: "pennylane-sync",
  maxDuration: 3600,
  run: async (payload: PennylaneSyncTaskPayload) => {
    const context: IntegrationRequestContext = {
      organizationId: payload.organizationId,
      userId: payload.userId ?? DEFAULT_ACTOR_USER_ID,
    };

    logger.log("Starting Pennylane sync", {
      organizationId: context.organizationId,
    });

    const result = await runPennylaneSync({
      context,
      supabaseAdmin: createSupabaseAdminClient(),
    });
    await revalidatePennylaneFrontendCacheFromWorker(context.organizationId);

    logger.log("Pennylane sync completed", {
      organizationId: context.organizationId,
      status: result.status,
      syncRunId: result.syncRunId,
    });

    return result;
  },
});

async function revalidatePennylaneFrontendCacheFromWorker(
  organizationId: string,
): Promise<void> {
  const appBaseUrl = getAppBaseUrl();
  const secret = process.env.INTERNAL_REVALIDATE_SECRET?.trim();

  if (!appBaseUrl || !secret) {
    logger.warn("Skipping Pennylane frontend cache revalidation", {
      hasAppBaseUrl: Boolean(appBaseUrl),
      hasSecret: Boolean(secret),
      organizationId,
    });
    return;
  }

  const response = await fetch(
    new URL("/api/internal/revalidate/pennylane", appBaseUrl),
    {
      body: JSON.stringify({ organizationId }),
      headers: {
        "Content-Type": "application/json",
        "x-internal-revalidate-secret": secret,
      },
      method: "POST",
    },
  ).catch((error) => {
    logger.warn("Pennylane frontend cache revalidation request failed", {
      error: error instanceof Error ? error.message : "unknown error",
      organizationId,
    });
    return null;
  });

  if (!response) {
    return;
  }

  if (!response.ok) {
    logger.warn("Pennylane frontend cache revalidation returned an error", {
      organizationId,
      status: response.status,
    });
  }
}

function getAppBaseUrl(): string | null {
  const value =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim();

  if (!value) {
    return null;
  }

  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
}
