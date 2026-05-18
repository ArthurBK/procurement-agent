import Link from "next/link";
import { getAuthenticatedWorkspaceContext } from "@/lib/auth/workspace";
import { WorkspaceAuthError } from "@/lib/auth/workspace-core";

const navigationItems = [
  { href: "/app/usage/identity", label: "Identity signals" },
  { href: "/app/contracts", label: "Contracts / Renewals" },
  { href: "/app/settings/integrations", label: "Integrations" },
];

export async function AppShell({
  children,
  eyebrow,
  helper,
  title,
}: {
  children: React.ReactNode;
  eyebrow?: string;
  helper?: string;
  title: string;
}) {
  const workspace = await loadWorkspaceHeader();

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-zinc-200 bg-white px-4 py-4 lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
          <div className="flex flex-col gap-5">
            <Link
              className="text-base font-semibold tracking-normal text-zinc-950"
              href="/app/usage/identity"
            >
              Procurement Agent
            </Link>
            {workspace ? (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                <p className="truncate text-sm font-medium text-zinc-950">
                  {workspace.organizationName}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {workspace.userEmail}
                </p>
              </div>
            ) : null}
            <nav className="flex gap-2 overflow-x-auto text-sm font-medium text-zinc-600 lg:flex-col lg:overflow-visible">
              {navigationItems.map((item) => (
                <Link
                  className="whitespace-nowrap rounded-md px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950"
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            {workspace ? (
              <form action="/auth/signout" method="post">
                <button
                  className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                  type="submit"
                >
                  Sign out
                </button>
              </form>
            ) : null}
          </div>
        </aside>

        <div className="flex-1 px-4 py-8 sm:px-6 lg:ml-64 lg:px-8">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
            <header className="flex flex-col gap-2">
              {eyebrow ? (
                <p className="text-sm font-medium text-zinc-500">{eyebrow}</p>
              ) : null}
              <h1 className="text-3xl font-semibold tracking-normal">{title}</h1>
              {helper ? (
                <p className="max-w-3xl text-sm leading-6 text-zinc-600">
                  {helper}
                </p>
              ) : null}
            </header>

            {children}
          </div>
        </div>
      </div>
    </main>
  );
}

async function loadWorkspaceHeader() {
  try {
    return await getAuthenticatedWorkspaceContext();
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return null;
    }

    throw error;
  }
}
