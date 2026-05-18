import { connection } from "next/server";
import { AppShell } from "@/app/app/_components/app-shell";
import { IdentitySignalsDashboard } from "@/app/app/_components/google-workspace";
import {
  loadCachedGoogleStatus,
  loadCachedIdentitySignals,
} from "@/lib/frontend-cache";
import { getIntegrationRequestContext } from "@/lib/integrations/context";

export default async function IdentitySignalsPage() {
  await connection();

  const { organizationId } = await getIntegrationRequestContext();
  const [googleStatus, identitySignals] = await Promise.all([
    loadCachedGoogleStatus({ organizationId }),
    loadCachedIdentitySignals({ organizationId }),
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
