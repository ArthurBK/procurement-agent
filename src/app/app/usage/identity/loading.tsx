import { AppRouteLoadingShell } from "@/app/app/_components/app-route-loading-shell";

export default function IdentitySignalsLoading() {
  return (
    <AppRouteLoadingShell
      eyebrow="Usage intelligence"
      helper="Google Workspace gives us identity signals, not perfect product usage. We use these signals to decide which SaaS tools need deeper app-level analysis."
      title="Identity & SSO Signals"
      variant="identity"
    />
  );
}
