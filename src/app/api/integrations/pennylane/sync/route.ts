import { authContextErrorToResponse } from "@/lib/auth/workspace-core";
import { revalidatePennylaneFrontendCache } from "@/lib/frontend-cache";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { loadPennylaneStatus } from "@/lib/integrations/pennylane/frontendData";
import { runPennylaneSync } from "@/lib/integrations/pennylane/sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { tasks } from "@trigger.dev/sdk/v3";
import { after } from "next/server";
import type { pennylaneSyncTask } from "@/trigger/pennylane";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const context = await getIntegrationRequestContext();
    const waitForCompletion = new URL(request.url).searchParams.get("wait") === "1";

    if (waitForCompletion) {
      const result = await runPennylaneSync({
        context,
        supabaseAdmin: createSupabaseAdminClient(),
      });
      revalidatePennylaneFrontendCache(context.organizationId);
      const status = result.status === "failed" ? 500 : 200;

      return Response.json(result, { status });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const pennylaneStatus = await loadPennylaneStatus({
      organizationId: context.organizationId,
      supabaseAdmin,
    });

    if (pennylaneStatus.status === "syncing") {
      return Response.json(
        { errors: ["A Pennylane sync is already running."] },
        { status: 409 },
      );
    }

    if (shouldRunPennylaneSyncOnTrigger()) {
      const handle = await tasks.trigger<typeof pennylaneSyncTask>(
        "pennylane-sync",
        {
          organizationId: context.organizationId,
          userId: context.userId,
        },
      );

      return Response.json(
        { status: "queued", triggerRunId: handle.id },
        { status: 202 },
      );
    }

    after(async () => {
      try {
        await runPennylaneSync({
          context,
          supabaseAdmin: createSupabaseAdminClient(),
        });
        revalidatePennylaneFrontendCache(context.organizationId);
      } catch (error) {
        console.error("Pennylane background sync failed", error);
      }
    });

    return Response.json({ status: "started" }, { status: 202 });
  } catch (error) {
    const authResponse = authContextErrorToResponse(error);

    if (authResponse) {
      return authResponse;
    }

    const message =
      error instanceof Error ? error.message : "Unable to sync Pennylane.";
    const status = message.includes("already running") ? 409 : 500;

    return Response.json({ errors: [message] }, { status });
  }
}

function shouldRunPennylaneSyncOnTrigger(): boolean {
  if (process.env.PENNYLANE_SYNC_RUNTIME === "next-after") {
    return false;
  }

  return (
    process.env.PENNYLANE_SYNC_RUNTIME === "trigger" ||
    (process.env.NODE_ENV === "production" && Boolean(process.env.TRIGGER_SECRET_KEY))
  );
}
