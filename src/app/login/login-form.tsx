"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { getSafeAuthRedirectPath } from "@/lib/auth/workspace-core";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const ERROR_COPY: Record<string, string> = {
  auth_callback_failed: "Google sign-in failed. Try again.",
  authentication_required: "Sign in with Google to continue.",
  email_required: "Use a Google account with a verified email.",
  public_email_domain: "Use a company Google account to create or join a workspace.",
  workspace_membership_required: "Unable to create your workspace membership.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(
    searchParams.get("error")
      ? ERROR_COPY[searchParams.get("error") as string] ?? "Unable to sign in."
      : null,
  );
  const [isLoading, setIsLoading] = useState(false);

  async function signInWithGoogle() {
    setError(null);
    setIsLoading(true);

    const supabase = createSupabaseBrowserClient();
    const next = getSafeAuthRedirectPath(searchParams.get("next"));
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next);
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      options: {
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
        redirectTo: redirectTo.toString(),
      },
      provider: "google",
    });

    if (signInError) {
      setError(signInError.message);
      setIsLoading(false);
    }
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-zinc-500">Procurement Agent</p>
        <h1 className="text-2xl font-semibold tracking-normal text-zinc-950">
          Sign in
        </h1>
        <p className="text-sm leading-6 text-zinc-600">
          Continue with your company Google account to access your workspace.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <button
        className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        disabled={isLoading}
        onClick={signInWithGoogle}
        type="button"
      >
        {isLoading ? "Redirecting..." : "Continue with Google"}
      </button>
    </div>
  );
}
