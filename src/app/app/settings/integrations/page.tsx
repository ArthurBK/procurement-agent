import { connection } from "next/server";
import { AppShell } from "@/app/app/_components/app-shell";
import { GoogleWorkspaceIntegrationCard } from "@/app/app/_components/google-workspace";
import { PennylaneIntegrationCard } from "@/app/app/_components/pennylane-integration";
import {
  loadCachedGoogleStatus,
  loadCachedPennylaneStatus,
} from "@/lib/frontend-cache";
import { getIntegrationRequestContext } from "@/lib/integrations/context";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  await connection();

  const { organizationId } = await getIntegrationRequestContext();
  const [googleStatus, pennylaneStatus] = await Promise.all([
    loadCachedGoogleStatus({
      organizationId,
    }),
    loadCachedPennylaneStatus({
      organizationId,
    }),
  ]);
  const resolvedSearchParams = await searchParams;

  return (
    <AppShell
      eyebrow="Settings"
      helper="Connect read-only data sources that help explain SaaS spend and access."
      title="Integrations"
    >
      {resolvedSearchParams?.error === "google_oauth_failed" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Google Workspace connection failed. Try again with a Google Workspace
          admin that can access Admin SDK Directory and Reports data.
        </div>
      ) : null}

      <GoogleWorkspaceIntegrationCard initialStatus={googleStatus} />
      <PennylaneIntegrationCard initialStatus={pennylaneStatus} />
    </AppShell>
  );
}
