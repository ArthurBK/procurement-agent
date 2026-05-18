import { connection } from "next/server";
import { AppShell } from "@/app/app/_components/app-shell";
import { GooglePreConsentScreen } from "@/app/app/_components/google-workspace";

export default async function GoogleConnectPage() {
  await connection();

  return (
    <AppShell
      eyebrow="Google Workspace"
      helper="Authorize read-only Admin SDK access before we sync identity and SSO signals."
      title="Connect Google Workspace"
    >
      <GooglePreConsentScreen />
    </AppShell>
  );
}
