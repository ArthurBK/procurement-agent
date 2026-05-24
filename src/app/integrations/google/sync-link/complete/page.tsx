type SyncLinkCompleteSearchParams = {
  status?: string | string[];
};

type SyncLinkResult = {
  body: string;
  title: string;
  tone: "success" | "error" | "warning";
};

const RESULT_COPY: Record<string, SyncLinkResult> = {
  callback_failed: {
    body: "Google Workspace could not be connected. Ask the person who sent the link to create a new one.",
    title: "Google Workspace connection failed",
    tone: "error",
  },
  expired: {
    body: "This sync link is no longer valid. Ask the person who sent it to create a new 48-hour link.",
    title: "This sync link has expired",
    tone: "warning",
  },
  expired_state: {
    body: "The Google authorization session expired before it completed. Ask the person who sent the link to create a new one.",
    title: "Authorization session expired",
    tone: "warning",
  },
  integration_save_failed: {
    body: "Google authorization succeeded, but the connection could not be saved. Ask the person who sent the link to try again.",
    title: "Connection could not be saved",
    tone: "error",
  },
  invalid: {
    body: "This sync link is invalid. Check that you opened the full URL from the person who sent it.",
    title: "Invalid sync link",
    tone: "error",
  },
  link_start_failed: {
    body: "The sync link could not start a Google authorization session. Ask the person who sent it to create a new one.",
    title: "Sync link could not start",
    tone: "error",
  },
  missing_access_token: {
    body: "Google did not return the access needed to connect Workspace. Ask the person who sent the link to try again.",
    title: "Google authorization failed",
    tone: "error",
  },
  missing_code_or_state: {
    body: "The Google authorization response was incomplete. Ask the person who sent the link to create a new one.",
    title: "Google authorization failed",
    tone: "error",
  },
  missing_refresh_token: {
    body: "Google did not grant offline access. Ask the person who sent the link to create a new one, then approve the requested access.",
    title: "Google authorization incomplete",
    tone: "error",
  },
  permission_smoke_test_failed: {
    body: "The Google admin account did not have the Directory and Reports access required for this read-only sync.",
    title: "More Google Workspace access is needed",
    tone: "error",
  },
  success: {
    body: "The read-only Google Workspace sync completed. You can close this window.",
    title: "Google Workspace sync is complete",
    tone: "success",
  },
  sync_failed: {
    body: "Google Workspace connected, but the read-only sync did not complete. The person who sent the link can review the error in the app.",
    title: "Google Workspace sync failed",
    tone: "error",
  },
  used: {
    body: "This sync link has already been used. Ask the person who sent it to create a new 48-hour link.",
    title: "This sync link was already used",
    tone: "warning",
  },
};

export default async function GoogleSyncLinkCompletePage({
  searchParams,
}: {
  searchParams?: Promise<SyncLinkCompleteSearchParams>;
}) {
  const params = await searchParams;
  const rawStatus = Array.isArray(params?.status)
    ? params?.status[0]
    : params?.status;
  const status = rawStatus?.startsWith("oauth_")
    ? "oauth_failed"
    : rawStatus ?? "invalid";
  const result =
    status === "oauth_failed"
      ? {
          body: "Google authorization was cancelled or failed. Ask the person who sent the link to create a new one if you need to retry.",
          title: "Google authorization was not completed",
          tone: "warning" as const,
        }
      : RESULT_COPY[status] ?? RESULT_COPY.invalid;
  const toneClassName = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[result.tone];

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12">
      <section className="w-full max-w-xl rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-5">
          <p className="text-sm font-medium text-zinc-500">Google Workspace</p>
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-normal text-zinc-950">
              {result.title}
            </h1>
            <p className="text-sm leading-6 text-zinc-600">{result.body}</p>
          </div>
          <div className={`rounded-md border px-4 py-3 text-sm ${toneClassName}`}>
            No app account is required for this page.
          </div>
        </div>
      </section>
    </main>
  );
}
