import { connection } from "next/server";
import { AppShell } from "@/app/app/_components/app-shell";
import { GoogleSyncProgress } from "@/app/app/_components/google-workspace";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import { loadGoogleStatus } from "@/lib/integrations/google/frontendData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function GoogleSyncingPage() {
  await connection();

  const { organizationId } = await getIntegrationRequestContext();
  const googleStatus = await loadGoogleStatus({
    organizationId,
    supabaseAdmin: createSupabaseAdminClient(),
  });

  return (
    <AppShell
      eyebrow="Google Workspace"
      helper="Initial sync discovers SaaS apps from identity signals and matches them back to your inventory."
      title="Syncing Google Workspace"
    >
      <GoogleSyncProgress initialStatus={googleStatus} />
    </AppShell>
  );
}
