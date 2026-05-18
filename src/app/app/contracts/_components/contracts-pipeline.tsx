"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buildRenewalOccurrences } from "@/lib/contracts/renewalOccurrences";

type PipelineRenewal = {
  aiAssisted: boolean;
  billingFrequency: string;
  contractId: string;
  currency: string;
  dateLabel?: string;
  lastInvoiceAmountCents: number | null;
  linkedSsoAppName: string | null;
  logoUrl: string | null;
  nextRenewalDate: string | null;
  planName: string | null;
  productName: string | null;
  recurringAmountCents: number | null;
  status: string;
  timelineDate?: string | null;
  vendorName: string;
};

type PipelinePoint = {
  item: PipelineRenewal;
  key: string;
  left: number;
  lane: number;
  renewalDate: Date;
};

type PipelineTick = {
  date: Date;
  isToday: boolean;
  key: string;
  left: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const LOGO_SIZE = 34;
const MIN_TIMELINE_WIDTH = 1100;
const SIDE_PADDING = 52;
const LANE_GAP = 42;
const MIN_POINT_GAP = 44;
const ROLLING_PAST_DAYS = 28;
const ROLLING_FUTURE_DAYS = 119;

export function ContractsPipeline({ renewals }: { renewals: PipelineRenewal[] }) {
  const [failedLogoUrls, setFailedLogoUrls] = useState<Set<string>>(() => new Set());
  const timeline = useMemo(() => buildTimeline(renewals), [renewals]);

  if (timeline.points.length === 0) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-950">Pipeline</h2>
        <div className="mt-5 rounded-md border border-dashed border-zinc-200 px-4 py-8 text-sm text-zinc-500">
          No renewals in the current 4-month rolling window.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-950">Pipeline</h2>
        <p className="text-xs font-medium text-zinc-500">
          {timeline.points.length} renewal
          {timeline.points.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="overflow-x-auto pb-2">
        <div
          className="relative"
          style={{
            height: timeline.height,
            minWidth: timeline.width,
            width: timeline.width,
          }}
        >
          <div
            className="absolute inset-x-0 h-px bg-zinc-200"
            style={{ top: timeline.axisTop }}
          />
          {timeline.ticks.map((tick) => (
            <TimelineTick axisTop={timeline.axisTop} key={tick.key} tick={tick} />
          ))}

          {timeline.points.map((point) => {
            const logoUrl =
              point.item.logoUrl && !failedLogoUrls.has(point.item.logoUrl)
                ? point.item.logoUrl
                : null;

            return (
              <div
                className="group absolute z-10 hover:z-[9999] focus-within:z-[9999]"
                key={point.key}
                style={{
                  left: point.left,
                  top: timeline.axisTop - 54 - point.lane * LANE_GAP,
                  transform: "translateX(-50%)",
                }}
              >
                <Link
                  aria-label={`Open ${point.item.vendorName} contract`}
                  className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-zinc-200 transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  href={`/app/contracts/${point.item.contractId}`}
                >
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={`${point.item.vendorName} logo`}
                      className="h-[34px] w-[34px] rounded-lg object-contain"
                      height={LOGO_SIZE}
                      onError={() => {
                        setFailedLogoUrls((current) => {
                          const next = new Set(current);
                          next.add(logoUrl);
                          return next;
                        });
                      }}
                      src={logoUrl}
                      width={LOGO_SIZE}
                    />
                  ) : (
                    <span className="flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-zinc-100 text-sm font-semibold text-zinc-600">
                      {point.item.vendorName.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                  )}
                </Link>

                <PipelineTooltip
                  item={point.item}
                  logoUrl={logoUrl}
                  renewalDate={point.renewalDate}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TimelineTick({
  axisTop,
  tick,
}: {
  axisTop: number;
  tick: PipelineTick;
}) {
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(
    tick.date,
  );
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(tick.date);

  return (
    <div
      className={`absolute top-0 w-px ${
        tick.isToday ? "bg-indigo-300" : "bg-zinc-100"
      }`}
      style={{ height: axisTop, left: tick.left }}
    >
      <div
        className={`absolute left-1/2 w-11 -translate-x-1/2 text-center text-xs leading-4 ${
          tick.isToday ? "font-semibold text-indigo-600" : "text-zinc-400"
        }`}
        style={{ top: axisTop + 8 }}
      >
        <span className="block">{month}</span>
        <span className="block font-medium">{day}</span>
      </div>
    </div>
  );
}

function FrequencyPill({ value }: { value: string }) {
  return (
    <span className="mt-1 inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
      {formatFrequency(value)}
    </span>
  );
}

function PipelineTooltip({
  item,
  logoUrl,
  renewalDate,
}: {
  item: PipelineRenewal;
  logoUrl: string | null;
  renewalDate: Date;
}) {
  const annualCost = toAnnualAmount(
    item.recurringAmountCents ?? item.lastInvoiceAmountCents,
    item.billingFrequency,
  );
  const subtitle =
    [item.productName, item.planName].filter(Boolean).join(", ") ||
    item.linkedSsoAppName ||
    "Contract renewal";

  return (
    <div className="pointer-events-auto absolute bottom-[42px] left-1/2 z-[9999] hidden w-[310px] -translate-x-1/2 rounded-md border border-zinc-200 bg-white p-3 text-left shadow-lg group-focus-within:block group-hover:block">
      <div className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="h-10 w-10 rounded-md object-contain"
            height={40}
            src={logoUrl}
            width={40}
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-sm font-semibold text-zinc-600">
            {item.vendorName.trim().charAt(0).toUpperCase() || "?"}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-950">
            {item.vendorName}
          </p>
          <p className="truncate text-xs text-zinc-500">{subtitle}</p>
          <FrequencyPill value={item.billingFrequency} />
        </div>
        <div className="grid gap-1 text-right">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-normal text-zinc-400">
              Annual cost
            </p>
            <p className="text-xs font-semibold text-zinc-800">
              {formatMoney(annualCost, item.currency)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-normal text-zinc-400">
              Deadline
            </p>
            <p className="text-xs font-semibold text-zinc-800">
              {item.dateLabel ?? formatDeadline(renewalDate)}
            </p>
          </div>
        </div>
      </div>
      <Link
        className="mt-3 inline-flex text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
        href={`/app/contracts/${item.contractId}/document`}
        rel="noreferrer"
        target="_blank"
      >
        View contract
      </Link>
    </div>
  );
}

function buildTimeline(renewals: PipelineRenewal[]): {
  axisTop: number;
  height: number;
  points: PipelinePoint[];
  ticks: PipelineTick[];
  width: number;
} {
  const today = startOfLocalDay(new Date());
  const windowStart = addDays(today, -ROLLING_PAST_DAYS);
  const windowEnd = addDays(today, ROLLING_FUTURE_DAYS);
  const span = Math.max(windowEnd.getTime() - windowStart.getTime(), DAY_MS);
  const width = MIN_TIMELINE_WIDTH;
  const usableWidth = width - SIDE_PADDING * 2;
  const datedRenewals = expandRenewalOccurrences({
    renewals,
    windowEnd,
    windowStart,
  });

  if (datedRenewals.length === 0) {
    return { axisTop: 0, height: 0, points: [], ticks: [], width };
  }

  const laneLastLeft: number[] = [];

  const points = datedRenewals.map(({ item, key, renewalDate }) => {
    const left =
      SIDE_PADDING +
      ((renewalDate.getTime() - windowStart.getTime()) / span) * usableWidth;
    const lane = findLane(laneLastLeft, left);
    laneLastLeft[lane] = left;

    return { item, key, lane, left, renewalDate };
  });

  const laneCount = Math.max(1, laneLastLeft.length);
  const axisTop = 138 + (laneCount - 1) * LANE_GAP;
  const height = axisTop + 48;
  const ticks = buildRollingTicks({
    span,
    today,
    usableWidth,
    windowStart,
  });

  return {
    axisTop,
    height,
    points,
    ticks,
    width,
  };
}

function expandRenewalOccurrences({
  renewals,
  windowEnd,
  windowStart,
}: {
  renewals: PipelineRenewal[];
  windowEnd: Date;
  windowStart: Date;
}): Array<{
  item: PipelineRenewal;
  key: string;
  renewalDate: Date;
}> {
  return buildRenewalOccurrences({
    renewals,
    windowEnd: toLocalDateKey(windowEnd),
    windowStart: toLocalDateKey(windowStart),
  }).flatMap((occurrence) => {
    const renewalDate = parseDate(occurrence.renewalDate);

    return renewalDate
      ? [
          {
            item: occurrence.item,
            key: occurrence.key,
            renewalDate,
          },
        ]
      : [];
  });
}

function buildRollingTicks({
  span,
  today,
  usableWidth,
  windowStart,
}: {
  span: number;
  today: Date;
  usableWidth: number;
  windowStart: Date;
}): PipelineTick[] {
  const ticks: PipelineTick[] = [];
  const windowEnd = addDays(today, ROLLING_FUTURE_DAYS);

  for (
    let time = windowStart.getTime();
    time <= windowEnd.getTime();
    time += WEEK_MS
  ) {
    const date = new Date(time);
    const left =
      SIDE_PADDING + ((date.getTime() - windowStart.getTime()) / span) * usableWidth;

    ticks.push({
      date,
      isToday: sameLocalDate(date, today),
      key: toLocalDateKey(date),
      left,
    });
  }

  return ticks;
}

function findLane(laneLastLeft: number[], left: number): number {
  const lane = laneLastLeft.findIndex((lastLeft) => left - lastLeft >= MIN_POINT_GAP);

  return lane === -1 ? laneLastLeft.length : lane;
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);

  return next;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameLocalDate(left: Date, right: Date): boolean {
  return toLocalDateKey(left) === toLocalDateKey(right);
}

function toLocalDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function toAnnualAmount(
  amountCents: number | null,
  billingFrequency: string,
): number | null {
  if (amountCents === null) {
    return null;
  }

  if (billingFrequency === "monthly") {
    return amountCents * 12;
  }

  if (billingFrequency === "quarterly") {
    return amountCents * 4;
  }

  return amountCents;
}

function formatMoney(valueCents: number | null, currency: string): string {
  if (valueCents === null) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(valueCents / 100);
}

function formatDeadline(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  })
    .format(date)
    .toUpperCase();
}

function formatFrequency(value: string): string {
  if (value === "monthly") {
    return "Monthly";
  }

  if (value === "quarterly") {
    return "Quarterly";
  }

  if (value === "annual") {
    return "Annually";
  }

  if (value === "weekly") {
    return "Weekly";
  }

  return "Unknown";
}
