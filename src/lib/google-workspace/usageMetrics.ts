export type UtilizationStatus =
  | "overutilized"
  | "healthy"
  | "moderate"
  | "underutilized"
  | "severe_underutilized"
  | "needs_seat_data";

export type LoginFrequency = "high" | "average" | "low";

export type UtilizationMetric = {
  paidSeats: number | null;
  percentage: number | null;
  utilization: number | null;
  wastedSeats: number | null;
};

export type UsageRecommendationInput = {
  currentNextAction: string;
  identityMode: "saml" | "oauth" | "authorized_app" | "unknown";
  paidSeats: number | null;
  renewalDate?: string | null;
  usersWithSignal90d: number;
  visibleViaGoogle: boolean;
};

export function formatRelativeLastUsed(
  date: string | null,
  now = new Date(),
): string {
  if (!date) {
    return "-";
  }

  const eventDate = new Date(date);

  if (Number.isNaN(eventDate.getTime())) {
    return "-";
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.max(
    0,
    Math.floor((startOfDay(now).getTime() - startOfDay(eventDate).getTime()) / dayMs),
  );

  if (diffDays === 0) {
    return "Today";
  }

  if (diffDays === 1) {
    return "Yesterday";
  }

  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }

  if (diffDays < 14) {
    return "A week ago";
  }

  if (diffDays < 60) {
    return `${Math.floor(diffDays / 7)} weeks ago`;
  }

  if (diffDays < 365) {
    const months = Math.max(1, Math.floor(diffDays / 30));

    return months === 1 ? "A month ago" : `${months} months ago`;
  }

  const years = Math.max(1, Math.floor(diffDays / 365));

  return years === 1 ? "A year ago" : `${years} years ago`;
}

export function computeUtilization(
  users90d: number,
  paidSeats: number | null | undefined,
): UtilizationMetric {
  if (!Number.isFinite(paidSeats) || !paidSeats || paidSeats <= 0) {
    return {
      paidSeats: null,
      percentage: null,
      utilization: null,
      wastedSeats: null,
    };
  }

  const normalizedPaidSeats = Math.floor(paidSeats);
  const utilization = users90d / normalizedPaidSeats;

  return {
    paidSeats: normalizedPaidSeats,
    percentage: Math.round(utilization * 100),
    utilization,
    wastedSeats: Math.max(normalizedPaidSeats - users90d, 0),
  };
}

export function getUtilizationStatus(
  utilization: number | null,
): UtilizationStatus {
  if (utilization === null) {
    return "needs_seat_data";
  }

  if (utilization > 1) {
    return "overutilized";
  }

  if (utilization >= 0.85) {
    return "healthy";
  }

  if (utilization >= 0.5) {
    return "moderate";
  }

  if (utilization >= 0.2) {
    return "underutilized";
  }

  return "severe_underutilized";
}

export function getLoginFrequency(
  users30d: number,
  users90d: number,
  users180d: number,
): LoginFrequency {
  void users180d;

  if (users90d <= 0) {
    return "low";
  }

  const ratio = users30d / users90d;

  if (ratio >= 0.75) {
    return "high";
  }

  if (ratio >= 0.35) {
    return "average";
  }

  return "low";
}

export function getRecommendedNextAction(
  row: UsageRecommendationInput,
): string {
  const utilization = computeUtilization(
    row.usersWithSignal90d,
    row.paidSeats,
  ).utilization;
  const isLowUtilization = utilization !== null && utilization < 0.5;

  if (!row.visibleViaGoogle || row.identityMode === "unknown") {
    return "Connect app or fetch usage";
  }

  if (row.identityMode !== "saml") {
    return row.currentNextAction;
  }

  if (row.renewalDate && isLowUtilization) {
    return "Prepare renewal negotiation";
  }

  if (isLowUtilization) {
    return "Review unused seats";
  }

  return row.currentNextAction;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
