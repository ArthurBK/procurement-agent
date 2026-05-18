import { connection } from "next/server";
import { AppShell } from "@/app/app/_components/app-shell";
import { IdentitySignalsDashboard } from "@/app/app/_components/google-workspace";
import { getIntegrationRequestContext } from "@/lib/integrations/context";
import {
  loadGoogleStatus,
  loadIdentitySignals,
} from "@/lib/integrations/google/frontendData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function IdentitySignalsPage() {
  await connection();

  const { organizationId } = await getIntegrationRequestContext();
  const supabaseAdmin = createSupabaseAdminClient();
  const [googleStatus, identitySignals] = await Promise.all([
    loadGoogleStatus({ organizationId, supabaseAdmin }),
    loadIdentitySignals({ organizationId, supabaseAdmin }),
  ]);

  return (
    <AppShell
      eyebrow="Usage intelligence"
      helper="Google Workspace gives us identity signals, not perfect product usage. We use these signals to decide which SaaS tools need deeper app-level analysis."
      title="Identity & SSO Signals"
    >
      <IdentitySignalsDashboard
        data={identitySignals}
        googleStatus={googleStatus}
      />
    </AppShell>
  );
}
