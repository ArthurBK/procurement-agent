import Link from "next/link";
import { connection } from "next/server";
import {
  GoogleWorkspaceIntegrationCard,
  IdentitySignalsDashboard,
} from "@/app/app/_components/google-workspace";
import {
  loadCachedGoogleStatus,
  loadCachedIdentitySignals,
} from "@/lib/frontend-cache";
import { getIntegrationRequestContext } from "@/lib/integrations/context";

export default async function GoogleWorkspaceIntegrationPage() {
  await connection();

  const { organizationId } = await getIntegrationRequestContext();
  const [googleStatus, identitySignals] = await Promise.all([
    loadCachedGoogleStatus({ organizationId }),
    loadCachedIdentitySignals({ organizationId }),
  ]);

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <nav className="flex flex-wrap gap-4 text-sm font-medium text-zinc-600">
          <Link className="hover:text-zinc-950" href="/app/usage/identity">
            Identity signals
          </Link>
          <Link className="hover:text-zinc-950" href="/app/settings/integrations">
            Integrations
          </Link>
        </nav>

        <header className="flex flex-col gap-2">
          <p className="text-sm font-medium text-zinc-500">Google Workspace</p>
          <h1 className="text-3xl font-semibold tracking-normal">
            SaaS utilization
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-zinc-600">
            Google Workspace provides identity signals, not perfect product
            usage. Use this table to spot apps that need app-level validation,
            seat review, or renewal work.
          </p>
        </header>

        <GoogleWorkspaceIntegrationCard initialStatus={googleStatus} />
        <IdentitySignalsDashboard
          data={identitySignals}
          googleStatus={googleStatus}
        />
      </div>
    </main>
  );
}
