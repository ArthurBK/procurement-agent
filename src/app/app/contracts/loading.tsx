import { AppRouteLoadingShell } from "@/app/app/_components/app-route-loading-shell";

export default function ContractsLoading() {
  return (
    <AppRouteLoadingShell
      eyebrow="Contracts"
      helper="Pennylane gives us what is paid and renewed. Google Workspace gives us identity visibility. This view joins both signals without claiming app-level usage."
      title="Contracts / Renewals"
      variant="contracts"
    />
  );
}
