export type SupplierForIdentityMatch = {
  id: string;
  monthlySpend: number | null;
  source?: string | null;
  supplierDomain: string | null;
  supplierName: string;
};

export type IdentitySignal = {
  appDomain: string | null;
  appName: string;
  eventName?: string | null;
  eventTime: string | null;
  source: "saml" | "oauth" | "authorized_app";
  success?: boolean | null;
  userEmail: string | null;
  usersCount?: number;
};

export type SupplierIdentityDashboardRow = {
  activeGoogleUsersCount: number;
  confidence: "high" | "medium" | "low" | "unknown";
  identityMode: "saml" | "oauth" | "authorized_app" | "unknown";
  lastSignalAt: string | null;
  matchedAppDomain: string | null;
  matchedAppName: string | null;
  matchConfidence: number;
  matchSource: "domain" | "normalized_name" | "known_alias" | "fuzzy" | "none";
  monthlySpend: number | null;
  needsAppUsage: boolean;
  recommendedNextStep: string;
  supplierDomain: string | null;
  supplierId: string;
  supplierName: string;
  suspendedUsersWithSignalOrToken: number;
  usersWithSignal30d: number;
  usersWithSignal90d: number;
  usersWithSignal180d: number;
  visibleViaGoogle: boolean;
};

export type SupplierIdentityMatchResult = {
  matchedAppDomain: string | null;
  matchedAppName: string | null;
  matchConfidence: number;
  matchSource: SupplierIdentityDashboardRow["matchSource"];
};

const KNOWN_ALIAS_TARGETS: Record<string, string> = {
  aircall: "aircall",
  apollo: "apollo",
  "apollo graphql": "apollo",
  chatgpt: "openai",
  fly: "fly",
  "fly io": "fly",
  fullenrich: "fullenrich",
  google: "google",
  "google chrome": "google",
  luma: "luma",
  neon: "neon",
  "neon console": "neon",
  n8n: "n8n",
  notion: "notion",
  "notion calendar": "notion",
  "notion mail": "notion",
  openai: "openai",
  qonto: "qonto",
  slack: "slack",
  trigger: "trigger",
  "trigger dev": "trigger",
  vercel: "vercel",
  wework: "wework",
};

const KNOWN_NORMALIZED_NAME_DOMAINS: Record<string, string> = {
  apollo: "apollographql.com",
  "apollo graphql": "apollographql.com",
  chatgpt: "chatgpt.com",
  "google chrome": "google.com",
  luma: "lumalabs.ai",
  "neon console": "neon.tech",
  "notion calendar": "notion.so",
  "notion mail": "notion.so",
};

const KNOWN_ALIAS_DOMAINS: Record<string, string> = {
  aircall: "aircall.io",
  apollo: "apollographql.com",
  fly: "fly.io",
  fullenrich: "fullenrich.com",
  google: "google.com",
  luma: "lumalabs.ai",
  neon: "neon.tech",
  n8n: "n8n.io",
  notion: "notion.so",
  openai: "openai.com",
  qonto: "qonto.com",
  slack: "slack.com",
  trigger: "trigger.dev",
  vercel: "vercel.com",
  wework: "wework.com",
};

const NEXT_ACTIONS: Record<string, string> = {
  aircall: "Fetch Aircall users and call activity",
  fly: "Fetch org members, apps, machines, volumes",
  fullenrich: "Fetch workspace members and credit consumption",
  neon: "Fetch org members, projects, compute/storage usage",
  n8n: "Fetch users, workflows, executions",
  openai: "Fetch OpenAI usage by project, API key, and model",
  qonto: "SSO not useful; inspect users, roles, cards, accounts",
  vercel: "Fetch team members, projects, deployments, build usage",
  wework: "SSO not useful; inspect contract and bookings",
};

export function buildSupplierIdentityDashboard({
  activeGoogleUsersCount,
  now = new Date(),
  signals,
  suppliers,
  suspendedUserEmails,
}: {
  activeGoogleUsersCount: number;
  now?: Date;
  signals: IdentitySignal[];
  suppliers: SupplierForIdentityMatch[];
  suspendedUserEmails: Set<string>;
}): SupplierIdentityDashboardRow[] {
  return dedupeIdentitySuppliers(
    suppliers.map(normalizeSupplierForIdentityMatch),
  ).map((supplier) => {
    const matchedSignals = signals
      .map((signal) => ({
        match: matchSupplierToSignal(supplier, signal),
        signal,
      }))
      .filter(({ match }) => match.matchConfidence > 0)
      .sort((left, right) => right.match.matchConfidence - left.match.matchConfidence);
    const bestMatch = matchedSignals[0]?.match ?? {
      matchedAppDomain: null,
      matchedAppName: null,
      matchConfidence: 0,
      matchSource: "none" as const,
    };
    const allMatchedSignals = matchedSignals.map(({ signal }) => signal);
    const activeMatchedSignals = matchedSignals
      .filter(({ signal }) => isSamlLoginUsageSignal(signal))
      .map(({ signal }) => signal);
    const bestSource =
      pickIdentityMode(activeMatchedSignals) ?? pickIdentityMode(allMatchedSignals);
    const scopedSignals = activeMatchedSignals.filter(
      (signal) => signal.source === bestSource,
    );
    const lastSignalAt = getLastSignalAt(activeMatchedSignals);
    const users30 = countUsersWithinDays(scopedSignals, now, 30);
    const users90 = countUsersWithinDays(scopedSignals, now, 90);
    const users180 = countUsersWithinDays(scopedSignals, now, 180);
    const identityMode = bestSource ?? "unknown";

    return {
      activeGoogleUsersCount,
      confidence: inferUsageConfidence(identityMode, users90, lastSignalAt, now),
      identityMode,
      lastSignalAt,
      matchedAppDomain: bestMatch.matchedAppDomain,
      matchedAppName: bestMatch.matchedAppName,
      matchConfidence: bestMatch.matchConfidence,
      matchSource: bestMatch.matchSource,
      monthlySpend: supplier.monthlySpend,
      needsAppUsage: true,
      recommendedNextStep: getRecommendedNextStep(supplier, identityMode),
      supplierDomain: supplier.supplierDomain,
      supplierId: supplier.id,
      supplierName: supplier.supplierName,
      suspendedUsersWithSignalOrToken: countSuspendedUsersWithSignal(
        activeMatchedSignals,
        suspendedUserEmails,
      ),
      usersWithSignal30d: users30,
      usersWithSignal90d: users90,
      usersWithSignal180d: users180,
      visibleViaGoogle: allMatchedSignals.length > 0,
    };
  });
}

export function dedupeIdentitySuppliers(
  suppliers: SupplierForIdentityMatch[],
): SupplierForIdentityMatch[] {
  const dedupedSuppliers: SupplierForIdentityMatch[] = [];

  for (const supplier of suppliers) {
    const existingSupplierIndex = dedupedSuppliers.findIndex((existingSupplier) =>
      isSameIdentitySupplier(existingSupplier, supplier),
    );

    if (existingSupplierIndex === -1) {
      dedupedSuppliers.push(supplier);
      continue;
    }

    if (shouldReplaceSupplier(dedupedSuppliers[existingSupplierIndex], supplier)) {
      dedupedSuppliers[existingSupplierIndex] = supplier;
    }
  }

  return dedupedSuppliers;
}

export function isSameIdentitySupplier(
  left: Pick<SupplierForIdentityMatch, "supplierDomain" | "supplierName">,
  right: Pick<SupplierForIdentityMatch, "supplierDomain" | "supplierName">,
): boolean {
  const leftName = normalizeIdentityName(left.supplierName);
  const rightName = normalizeIdentityName(right.supplierName);

  if (leftName && rightName && leftName === rightName) {
    return true;
  }

  const leftAliasTarget = getKnownAliasTarget(leftName);
  const rightAliasTarget = getKnownAliasTarget(rightName);

  if (
    leftAliasTarget &&
    leftAliasTarget === rightAliasTarget &&
    (leftName === leftAliasTarget || rightName === rightAliasTarget)
  ) {
    return true;
  }

  const leftNameDomain = getDomainOnlyName(left.supplierName);
  const rightNameDomain = getDomainOnlyName(right.supplierName);
  const leftDomain = getSupplierDomain(left);
  const rightDomain = getSupplierDomain(right);

  return Boolean(
    (leftNameDomain && rightDomain && leftNameDomain === rightDomain) ||
      (rightNameDomain && leftDomain && rightNameDomain === leftDomain),
  );
}

export function normalizeIdentityName(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\b(inc|llc|ltd|limited|sas|sarl|gmbh|corp|corporation)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveIdentitySupplierDomain({
  source,
  supplierDomain,
  supplierName,
}: {
  source?: string | null;
  supplierDomain: string | null;
  supplierName: string | null | undefined;
}): string | null {
  const nameDomain = getDomainOnlyName(supplierName ?? "");
  const knownDomain = getKnownIdentityDomain(normalizeIdentityName(supplierName));
  const storedDomain = extractDomain(supplierDomain ?? "");

  if (source === "google_workspace") {
    return nameDomain ?? knownDomain;
  }

  return storedDomain ?? nameDomain ?? knownDomain;
}

export function matchSupplierToSignal(
  supplier: SupplierForIdentityMatch,
  signal: IdentitySignal,
): SupplierIdentityMatchResult {
  const supplierDomain = supplier.supplierDomain?.toLowerCase() ?? null;
  const signalDomain =
    signal.appDomain ?? extractDomain(signal.appName)?.toLowerCase() ?? null;

  if (supplierDomain && signalDomain && supplierDomain === signalDomain) {
    return {
      matchedAppDomain: signalDomain,
      matchedAppName: signal.appName,
      matchConfidence: 1,
      matchSource: "domain",
    };
  }

  const supplierName = normalizeIdentityName(supplier.supplierName);
  const appName = normalizeIdentityName(signal.appName);

  if (supplierName && appName && supplierName === appName) {
    return {
      matchedAppDomain: signalDomain,
      matchedAppName: signal.appName,
      matchConfidence: 0.95,
      matchSource: "normalized_name",
    };
  }

  const appAliasTarget = getKnownAliasTarget(appName);
  const supplierAliasTarget = getKnownAliasTarget(supplierName);

  if (appAliasTarget && appAliasTarget === supplierAliasTarget) {
    return {
      matchedAppDomain: signalDomain,
      matchedAppName: signal.appName,
      matchConfidence: 0.9,
      matchSource: "known_alias",
    };
  }

  const similarity = diceCoefficient(supplierName, appName);

  if (similarity >= 0.82) {
    return {
      matchedAppDomain: signalDomain,
      matchedAppName: signal.appName,
      matchConfidence: Number(similarity.toFixed(2)),
      matchSource: "fuzzy",
    };
  }

  return {
    matchedAppDomain: null,
    matchedAppName: null,
    matchConfidence: 0,
    matchSource: "none",
  };
}

function shouldReplaceSupplier(
  existingSupplier: SupplierForIdentityMatch,
  candidateSupplier: SupplierForIdentityMatch,
): boolean {
  if (
    existingSupplier.monthlySpend === null &&
    candidateSupplier.monthlySpend !== null
  ) {
    return true;
  }

  if (!existingSupplier.supplierDomain && candidateSupplier.supplierDomain) {
    return true;
  }

  return (
    isDomainOnlyName(existingSupplier.supplierName) &&
    !isDomainOnlyName(candidateSupplier.supplierName)
  );
}

function isDomainOnlyName(value: string): boolean {
  return Boolean(getDomainOnlyName(value));
}

function getDomainOnlyName(value: string): string | null {
  const trimmedValue = value.trim().toLowerCase();
  const domain = extractDomain(trimmedValue);

  return domain && domain === trimmedValue ? domain : null;
}

function getSupplierDomain(
  supplier: Pick<SupplierForIdentityMatch, "supplierDomain" | "supplierName">,
): string | null {
  return (
    extractDomain(supplier.supplierDomain ?? "") ??
    getDomainOnlyName(supplier.supplierName)
  );
}

function pickIdentityMode(
  signals: IdentitySignal[],
): SupplierIdentityDashboardRow["identityMode"] | null {
  if (signals.some((signal) => signal.source === "saml")) {
    return "saml";
  }

  if (signals.some((signal) => signal.source === "oauth")) {
    return "oauth";
  }

  if (signals.some((signal) => signal.source === "authorized_app")) {
    return "authorized_app";
  }

  return null;
}

function countUsersWithinDays(
  signals: IdentitySignal[],
  now: Date,
  days: number,
): number {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;

  return new Set(
    signals.flatMap((signal) => {
      if (!signal.userEmail || !signal.eventTime) {
        return [];
      }

      return new Date(signal.eventTime).getTime() >= cutoff
        ? [signal.userEmail.toLowerCase()]
        : [];
    }),
  ).size;
}

function getLastSignalAt(signals: IdentitySignal[]): string | null {
  return (
    signals
      .flatMap((signal) => (signal.eventTime ? [signal.eventTime] : []))
      .sort()
      .at(-1) ?? null
  );
}

function countSuspendedUsersWithSignal(
  signals: IdentitySignal[],
  suspendedUserEmails: Set<string>,
): number {
  return new Set(
    signals.flatMap((signal) => {
      const userEmail = signal.userEmail?.toLowerCase();

      return userEmail && suspendedUserEmails.has(userEmail) ? [userEmail] : [];
    }),
  ).size;
}

function isSamlLoginUsageSignal(signal: IdentitySignal): boolean {
  const eventName = normalizeIdentityName(signal.eventName);

  if (signal.source === "saml") {
    return (
      signal.success !== false &&
      (eventName === "login_success" || !eventName.includes("fail"))
    );
  }

  return false;
}

function inferUsageConfidence(
  identityMode: SupplierIdentityDashboardRow["identityMode"],
  users90: number,
  lastSignalAt: string | null,
  now: Date,
): SupplierIdentityDashboardRow["confidence"] {
  if (identityMode === "unknown") {
    return "unknown";
  }

  if (!lastSignalAt) {
    return "low";
  }

  const signalAgeDays =
    (now.getTime() - new Date(lastSignalAt).getTime()) / (24 * 60 * 60 * 1000);

  if (identityMode === "saml" && users90 > 0 && signalAgeDays <= 90) {
    return "high";
  }

  if (identityMode === "oauth" && users90 > 0 && signalAgeDays <= 90) {
    return "medium";
  }

  if (identityMode === "authorized_app") {
    return users90 > 0 ? "medium" : "low";
  }

  return "low";
}

function getRecommendedNextStep(
  supplier: SupplierForIdentityMatch,
  identityMode: SupplierIdentityDashboardRow["identityMode"],
): string {
  const normalizedName = normalizeIdentityName(supplier.supplierName);
  const knownAlias = getKnownAliasTarget(normalizedName);

  if (knownAlias && NEXT_ACTIONS[knownAlias]) {
    return NEXT_ACTIONS[knownAlias];
  }

  if (identityMode === "unknown") {
    return "No recent Google identity signal; verify with the vendor API before drawing usage conclusions";
  }

  return "Fetch vendor users and product usage before making spend decisions";
}

export function getKnownAliasTarget(normalizedName: string): string | null {
  if (KNOWN_ALIAS_TARGETS[normalizedName]) {
    return KNOWN_ALIAS_TARGETS[normalizedName];
  }

  for (const [alias, target] of Object.entries(KNOWN_ALIAS_TARGETS)) {
    if (
      normalizedName === alias ||
      normalizedName.startsWith(`${alias} `) ||
      normalizedName.includes(` ${alias} `)
    ) {
      return target;
    }
  }

  return null;
}

export function getKnownIdentityDomain(normalizedName: string): string | null {
  if (KNOWN_NORMALIZED_NAME_DOMAINS[normalizedName]) {
    return KNOWN_NORMALIZED_NAME_DOMAINS[normalizedName];
  }

  const aliasTarget = getKnownAliasTarget(normalizedName);

  return aliasTarget ? (KNOWN_ALIAS_DOMAINS[aliasTarget] ?? null) : null;
}

function normalizeSupplierForIdentityMatch(
  supplier: SupplierForIdentityMatch,
): SupplierForIdentityMatch {
  return {
    ...supplier,
    supplierDomain: resolveIdentitySupplierDomain({
      source: supplier.source,
      supplierDomain: supplier.supplierDomain,
      supplierName: supplier.supplierName,
    }),
  };
}

function extractDomain(value: string): string | null {
  const match = value.toLowerCase().match(/[a-z0-9-]+(\.[a-z0-9-]+)+/);

  return match?.[0] ?? null;
}

function diceCoefficient(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const leftBigrams = getBigrams(left);
  const rightBigrams = getBigrams(right);

  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return 0;
  }

  const rightCounts = new Map<string, number>();

  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1);
  }

  let intersection = 0;

  for (const bigram of leftBigrams) {
    const count = rightCounts.get(bigram) ?? 0;

    if (count > 0) {
      intersection += 1;
      rightCounts.set(bigram, count - 1);
    }
  }

  return (2 * intersection) / (leftBigrams.length + rightBigrams.length);
}

function getBigrams(value: string): string[] {
  const compact = value.replace(/\s+/g, "");

  return Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) =>
    compact.slice(index, index + 2),
  );
}
