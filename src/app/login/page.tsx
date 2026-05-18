import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/app/login/login-form";
import { getAuthenticatedWorkspaceContext } from "@/lib/auth/workspace";
import { WorkspaceAuthError } from "@/lib/auth/workspace-core";

export default async function LoginPage() {
  await connection();

  try {
    await getAuthenticatedWorkspaceContext();
    redirect("/app/suppliers");
  } catch (error) {
    if (!(error instanceof WorkspaceAuthError)) {
      throw error;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10 text-zinc-950">
      <LoginForm />
    </main>
  );
}
