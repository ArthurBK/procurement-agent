import type { ReactNode } from "react";

const navigationItems = [
  "Identity signals",
  "Contracts / Renewals",
  "Integrations",
];

type AppRouteLoadingShellProps = {
  eyebrow: string;
  helper: string;
  title: string;
  variant: "contracts" | "identity";
};

export function AppRouteLoadingShell({
  eyebrow,
  helper,
  title,
  variant,
}: AppRouteLoadingShellProps) {
  return (
    <main
      aria-busy="true"
      className="min-h-screen bg-zinc-50 text-zinc-950"
    >
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-zinc-200 bg-white px-4 py-4 lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
          <div className="flex flex-col gap-5">
            <p className="text-base font-semibold tracking-normal text-zinc-950">
              Procurement Agent
            </p>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-40" />
            </div>
            <nav className="flex gap-2 overflow-x-auto text-sm font-medium text-zinc-600 lg:flex-col lg:overflow-visible">
              {navigationItems.map((item) => (
                <div
                  className="whitespace-nowrap rounded-md px-3 py-2"
                  key={item}
                >
                  {item}
                </div>
              ))}
            </nav>
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </aside>

        <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:ml-64 lg:px-8">
          <div className="mx-auto flex min-w-0 w-full max-w-7xl flex-col gap-6">
            <header className="flex flex-col gap-2">
              <p className="text-sm font-medium text-zinc-500">{eyebrow}</p>
              <h1 className="text-3xl font-semibold tracking-normal">
                {title}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-zinc-600">
                {helper}
              </p>
            </header>

            {variant === "contracts" ? (
              <ContractsLoadingContent />
            ) : (
              <IdentityLoadingContent />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function ContractsLoadingContent() {
  return (
    <>
      <SummaryGrid count={5} />
      <Panel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-10 w-36 rounded-md" />
        </div>
      </Panel>
      <TableSkeleton
        columns="md:grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))]"
        metricCells={5}
        rows={5}
        titleWidth="w-44"
      />
      <Panel>
        <Skeleton className="h-5 w-24" />
        <div className="mt-8 flex items-end justify-between gap-3 overflow-hidden">
          {Array.from({ length: 14 }, (_, index) => (
            <div className="flex min-w-10 flex-col items-center gap-3" key={index}>
              {index % 3 === 0 ? (
                <Skeleton className="h-10 w-10 rounded-md" />
              ) : (
                <span className="h-10" />
              )}
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-6 xl:grid-cols-2">
        <CompactListSkeleton titleWidth="w-36" />
        <CompactListSkeleton titleWidth="w-28" />
      </div>
    </>
  );
}

function IdentityLoadingContent() {
  return (
    <>
      <SummaryGrid count={6} />
      <Panel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-10 w-28 rounded-md" />
        </div>
      </Panel>
      <TableSkeleton
        columns="md:grid-cols-[minmax(0,1.8fr)_repeat(6,minmax(0,1fr))]"
        metricCells={6}
        rows={8}
        titleWidth="w-56"
      />
    </>
  );
}

function SummaryGrid({ count }: { count: number }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: count }, (_, index) => (
        <div
          className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
          key={index}
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-8 w-16" />
        </div>
      ))}
    </section>
  );
}

function TableSkeleton({
  columns,
  metricCells,
  rows,
  titleWidth,
}: {
  columns: string;
  metricCells: number;
  rows: number;
  titleWidth: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <Skeleton className={`h-5 ${titleWidth}`} />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="divide-y divide-zinc-100">
        {Array.from({ length: rows }, (_, index) => (
          <div
            className={`grid gap-3 px-5 py-4 text-sm ${columns} md:items-center`}
            key={index}
          >
            <div className="flex min-w-0 items-center gap-3">
              <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            {Array.from({ length: metricCells }, (_, cellIndex) => (
              <Skeleton className="h-4 w-20 max-w-full" key={cellIndex} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function CompactListSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <Skeleton className={`h-5 ${titleWidth}`} />
      </div>
      <div className="divide-y divide-zinc-100">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="grid gap-3 px-5 py-4 text-sm" key={index}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      {children}
    </section>
  );
}

function Skeleton({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded bg-zinc-200/80 ${className}`} />
  );
}
