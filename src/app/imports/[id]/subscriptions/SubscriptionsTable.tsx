"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatAmountCents } from "@/lib/imports/formatAmount";
import { buildLogoUrl } from "@/lib/suppliers/logo";
import type { LogoSource } from "@/lib/suppliers/types";

export type SubscriptionRow = {
  id: string;
  supplier: string;
  supplier_key: string;
  next_payment: string | null;
  payment_method: string | null;
  frequency: "weekly" | "monthly" | "quarterly" | "annually" | "unknown";
  billing_model: "fixed" | "variable" | "unknown";
  business_category:
    | "software"
    | "cloud"
    | "ai"
    | "telecom"
    | "banking"
    | "workspace"
    | "professional_service"
    | "marketing"
    | "food"
    | "transport"
    | "travel"
    | "retail"
    | "income"
    | "unknown";
  amount_cents: number;
  currency: string;
  confidence: number;
  evidence: Record<string, unknown>;
};

export type SupplierProfileRow = {
  id: string;
  supplier_key: string;
  display_name: string;
  domain: string | null;
  logo_url: string | null;
  logo_source: LogoSource;
};

type AutoLogoResponse = {
  createdCount?: number;
  errors?: string[];
  missingCount?: number;
  searchedCount?: number;
  skippedCount?: number;
};

const FREQUENCY_LABELS: Record<SubscriptionRow["frequency"], string> = {
  annually: "Annually",
  monthly: "Monthly",
  quarterly: "Quarterly",
  unknown: "Unknown",
  weekly: "Weekly",
};

export function SubscriptionsTable({
  importId,
  profiles,
  subscriptions,
}: {
  importId: string;
  profiles: SupplierProfileRow[];
  subscriptions: SubscriptionRow[];
}) {
  const router = useRouter();
  const profilesByKey = useMemo(() => buildProfileMap(profiles), [profiles]);
  const missingProfileCount = useMemo(
    () => countMissingProfiles(subscriptions, profilesByKey),
    [profilesByKey, subscriptions],
  );
  const [autoLogoError, setAutoLogoError] = useState<string | null>(null);

  useEffect(() => {
    if (missingProfileCount === 0) {
      return;
    }

    const sessionKey = `subscription-auto-logo:v2:${importId}:${missingProfileCount}`;

    if (window.sessionStorage.getItem(sessionKey) === "requested") {
      return;
    }

    window.sessionStorage.setItem(sessionKey, "requested");
    const timeoutId = window.setTimeout(() => {
      void searchMissingLogos({
        importId,
        onComplete: () => window.sessionStorage.removeItem(sessionKey),
        onError: setAutoLogoError,
        onRefresh: router.refresh,
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [importId, missingProfileCount, router.refresh]);

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      {autoLogoError ? (
        <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
          {autoLogoError}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
          <thead className="bg-zinc-100 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Supplier</th>
              <th className="px-5 py-3 font-semibold">Next payment</th>
              <th className="px-5 py-3 font-semibold">Payment method</th>
              <th className="px-5 py-3 font-semibold">Frequency</th>
              <th className="px-5 py-3 font-semibold">Billing model</th>
              <th className="px-5 py-3 font-semibold">Category</th>
              <th className="px-5 py-3 text-right font-semibold">Amount</th>
              <th className="px-5 py-3 text-right font-semibold">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {subscriptions.length > 0 ? (
              subscriptions.map((subscription) => (
                <SubscriptionTableRows
                  key={subscription.id}
                  profile={profilesByKey[subscription.supplier_key]}
                  subscription={subscription}
                />
              ))
            ) : (
              <tr>
                <td className="px-5 py-6 text-center text-zinc-500" colSpan={8}>
                  No recurring subscriptions detected yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SubscriptionTableRows({
  profile,
  subscription,
}: {
  profile: SupplierProfileRow | undefined;
  subscription: SubscriptionRow;
}) {
  const displayName = profile?.display_name ?? subscription.supplier;

  return (
    <tr className="bg-white">
      <td className="px-5 py-3">
        <div className="flex min-w-[260px] items-start gap-3">
          <SupplierAvatar profile={profile} supplier={displayName} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-words font-medium text-zinc-950">
                {displayName}
              </span>
              {hasUsedCorrections(subscription.evidence) ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                  Edited
                </span>
              ) : null}
            </div>
            {profile?.domain ? (
              <div className="mt-0.5 break-all text-xs text-zinc-500">
                {profile.domain}
              </div>
            ) : null}
          </div>
        </div>
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-zinc-700">
        {subscription.next_payment ?? "-"}
      </td>
      <td className="px-5 py-3 text-zinc-700">
        {subscription.payment_method ?? "-"}
      </td>
      <td className="px-5 py-3 text-zinc-700">
        {FREQUENCY_LABELS[subscription.frequency]}
      </td>
      <td className="px-5 py-3 text-zinc-700">
        {formatEnumLabel(subscription.billing_model)}
      </td>
      <td className="px-5 py-3 text-zinc-700">
        {formatEnumLabel(subscription.business_category)}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-right font-medium text-zinc-950">
        {formatAmountCents(subscription.amount_cents, subscription.currency)}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-right text-zinc-700">
        {formatConfidence(subscription.confidence)}
      </td>
    </tr>
  );
}

function SupplierAvatar({
  profile,
  supplier,
}: {
  profile: SupplierProfileRow | undefined;
  supplier: string;
}) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const logoUrl = getDisplayLogoUrl(profile);

  if (logoUrl && failedLogoUrl !== logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${supplier} logo`}
        className="h-9 w-9 shrink-0 rounded-md bg-white object-contain"
        height={36}
        onError={() => setFailedLogoUrl(logoUrl)}
        src={logoUrl}
        width={36}
      />
    );
  }

  return <FallbackAvatar supplier={supplier} />;
}

function FallbackAvatar({ supplier }: { supplier: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-600">
      {getInitial(supplier)}
    </div>
  );
}

function getDisplayLogoUrl(profile: SupplierProfileRow | undefined) {
  if (!profile) {
    return null;
  }

  if (profile.logo_source === "logo_dev" && profile.domain) {
    return buildLogoUrl(profile.domain) ?? profile.logo_url;
  }

  return profile.logo_url;
}

function buildProfileMap(
  profiles: SupplierProfileRow[],
): Record<string, SupplierProfileRow> {
  return Object.fromEntries(
    profiles.map((profile) => [profile.supplier_key, profile]),
  );
}

function countMissingProfiles(
  subscriptions: SubscriptionRow[],
  profilesByKey: Record<string, SupplierProfileRow>,
): number {
  const supplierKeys = new Set(
    subscriptions.flatMap((subscription) =>
      subscription.supplier_key.trim().length > 0
        ? [subscription.supplier_key]
        : [],
    ),
  );

  let missingProfiles = 0;

  for (const supplierKey of supplierKeys) {
    if (!profileHasDisplayableLogo(profilesByKey[supplierKey])) {
      missingProfiles += 1;
    }
  }

  return missingProfiles;
}

function profileHasDisplayableLogo(
  profile: SupplierProfileRow | undefined,
): boolean {
  if (!profile) {
    return false;
  }

  if (profile.logo_url) {
    return true;
  }

  return profile.logo_source === "logo_dev" && Boolean(profile.domain);
}

async function searchMissingLogos({
  importId,
  onComplete,
  onError,
  onRefresh,
}: {
  importId: string;
  onComplete: () => void;
  onError: (message: string | null) => void;
  onRefresh: () => void;
}) {
  try {
    const response = await fetch(
      `/api/imports/${importId}/supplier-profiles/auto-logo`,
      { method: "POST" },
    );
    const result = (await response.json()) as AutoLogoResponse;

    if (!response.ok) {
      onError(result.errors?.[0] ?? "Unable to search supplier logos.");
      onComplete();
      return;
    }

    onError(null);

    if ((result.createdCount ?? 0) > 0) {
      onRefresh();
    }
  } catch (requestError) {
    onError(
      requestError instanceof Error
        ? requestError.message
        : "Unable to search supplier logos.",
    );
    onComplete();
  }
}

function getInitial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "?";
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hasUsedCorrections(evidence: Record<string, unknown>): boolean {
  return evidence.used_corrections === true;
}
