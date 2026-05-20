import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/app/login/login-form";
import { getAuthenticatedWorkspaceContext } from "@/lib/auth/workspace";
import {
  WorkspaceAuthError,
  getSafeAuthRedirectPath,
} from "@/lib/auth/workspace-core";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  await connection();

  const resolvedSearchParams = await searchParams;
  const next = getSafeAuthRedirectPath(resolvedSearchParams.next);

  try {
    await getAuthenticatedWorkspaceContext();
    redirect(next);
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
