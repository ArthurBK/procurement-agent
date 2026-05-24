import { buildLogoUrl, normalizeDomain } from "./logo.ts";
import { buildLogoSearchQueries } from "./logoSearchQueries.ts";
import {
  getKnownSaasBrand,
  normalizeKnownSaasName,
} from "./knownSaasBrands.ts";

export type LogoDevSearchResult = {
  name: string;
  domain: string;
  logoUrl: string | null;
};

export type SupplierLogoProfileForRepair = {
  display_name?: string | null;
  domain: string | null;
  logo_source: string;
  logo_url: string | null;
};

const MIN_AUTO_MATCH_SCORE = 80;
const KNOWN_SAAS_MATCH_SCORE = 250;
const PRIMARY_DOMAIN_TLDS = new Set([
  "ai",
  "app",
  "com",
  "dev",
  "io",
  "net",
  "so",
]);
export async function searchLogoDevBrands(
  query: string,
): Promise<LogoDevSearchResult[]> {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 2) {
    return [];
  }

  const secretKey = process.env.LOGO_DEV_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new Error("LOGO_DEV_SECRET_KEY is not configured");
  }

  const searchParams = new URLSearchParams({
    q: trimmedQuery,
    strategy: "match",
  });
  const response = await fetch(
    `https://api.logo.dev/search?${searchParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Logo.dev Brand Search failed with status ${response.status}`,
    );
  }

  let body: unknown;

  try {
    body = (await response.json()) as unknown;
  } catch {
    throw new Error("Unable to parse Logo.dev Brand Search response");
  }

  if (!Array.isArray(body)) {
    return [];
  }

  const results = body
    .flatMap((item): LogoDevSearchResult[] => {
      if (!isSearchResultRow(item)) {
        return [];
      }

      const domain = normalizeDomain(item.domain);

      if (!domain) {
        return [];
      }

      return [
        {
          domain,
          logoUrl: buildLogoUrl(domain),
          name: item.name,
        },
      ];
    })
    .slice(0, 25);

  return rankLogoDevSearchResults(trimmedQuery, results).slice(0, 10);
}

export async function searchLogoDevBrandsForName(
  displayName: string,
): Promise<LogoDevSearchResult[]> {
  const results: LogoDevSearchResult[] = [];
  const knownResult = getKnownSaasLogoResult(displayName);

  if (knownResult) {
    results.push(knownResult);
  }

  for (const query of buildLogoSearchQueries(displayName)) {
    results.push(...(await searchLogoDevBrands(query)));
  }

  return rankLogoDevSearchResults(displayName, dedupeLogoResults(results)).slice(
    0,
    10,
  );
}

export function pickBestLogoDevSearchResult(
  displayName: string,
  results: LogoDevSearchResult[],
): LogoDevSearchResult | null {
  const knownResult = getKnownSaasLogoResult(displayName);

  if (knownResult?.logoUrl) {
    return knownResult;
  }

  const [best] = rankLogoDevSearchResults(displayName, results).filter(
    (result) => result.logoUrl,
  );

  if (!best) {
    return null;
  }

  return scoreLogoDevSearchResult(displayName, best) >= MIN_AUTO_MATCH_SCORE
    ? best
    : null;
}

export function shouldRepairLogoDevProfile({
  displayName,
  profile,
}: {
  displayName: string;
  profile: SupplierLogoProfileForRepair | undefined;
}): LogoDevSearchResult | null {
  if (!profile || profile.logo_source !== "logo_dev") {
    return null;
  }

  const best = pickBestLogoDevSearchResult(displayName, []);
  const currentDomain = normalizeDomain(profile.domain);

  if (!best?.logoUrl || currentDomain === best.domain) {
    return null;
  }

  return best;
}

export function rankLogoDevSearchResults(
  displayName: string,
  results: LogoDevSearchResult[],
): LogoDevSearchResult[] {
  return [...results].sort((left, right) => {
    const scoreDelta =
      scoreLogoDevSearchResult(displayName, right) -
      scoreLogoDevSearchResult(displayName, left);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.name.localeCompare(right.name);
  });
}

function scoreLogoDevSearchResult(
  displayName: string,
  result: LogoDevSearchResult,
): number {
  const knownResult = getKnownSaasLogoResult(displayName);

  if (knownResult?.domain === result.domain) {
    return KNOWN_SAAS_MATCH_SCORE;
  }

  const target = normalizeLogoMatchText(displayName);
  const targetCompact = compactLogoMatchText(target);
  const resultName = normalizeLogoMatchText(result.name);
  const resultNameCompact = compactLogoMatchText(resultName);
  const domainStem = getDomainStem(result.domain);
  const domainStemCompact = compactLogoMatchText(domainStem);
  const tld = result.domain.split(".").at(-1) ?? "";
  let score = result.logoUrl ? 5 : 0;

  if (!target || !resultName) {
    return score;
  }

  if (resultName === target) {
    score += 90;
  } else if (resultNameCompact === targetCompact) {
    score += 86;
  } else if (target.includes(resultName) && resultName.length >= 3) {
    score += 72;
  } else if (resultName.includes(target) && target.length >= 3) {
    score += 58;
  } else {
    score += diceCoefficient(targetCompact, resultNameCompact) * 50;
  }

  if (domainStem === target || domainStemCompact === targetCompact) {
    score += 36;
  } else if (domainStemCompact.startsWith(targetCompact) && targetCompact.length >= 4) {
    score += 10;
  } else if (targetCompact.startsWith(domainStemCompact) && domainStemCompact.length >= 4) {
    score += 12;
  }

  if (PRIMARY_DOMAIN_TLDS.has(tld)) {
    score += tld === "com" ? 8 : 5;
  }

  if (
    resultNameCompact.includes(targetCompact) &&
    resultNameCompact !== targetCompact
  ) {
    score -= 18;
  }

  if (
    domainStemCompact.includes(targetCompact) &&
    domainStemCompact !== targetCompact
  ) {
    score -= 28;
  }

  if (targetCompact.includes(domainStemCompact) && domainStemCompact.length < 5) {
    score -= 12;
  }

  return score;
}

function getKnownSaasLogoResult(displayName: string): LogoDevSearchResult | null {
  const brand = getKnownSaasBrand(displayName);

  if (!brand) {
    return null;
  }

  return {
    domain: brand.domain,
    logoUrl: buildLogoUrl(brand.domain),
    name: brand.name,
  };
}

function normalizeLogoMatchText(input: string): string {
  return normalizeKnownSaasName(input);
}

function compactLogoMatchText(input: string): string {
  return input.replace(/\s+/g, "");
}

function getDomainStem(domain: string): string {
  const normalizedDomain = normalizeDomain(domain);

  return normalizeLogoMatchText(normalizedDomain?.split(".")[0] ?? "");
}

function dedupeLogoResults(
  results: LogoDevSearchResult[],
): LogoDevSearchResult[] {
  const resultsByDomain = new Map<string, LogoDevSearchResult>();

  for (const result of results) {
    if (!resultsByDomain.has(result.domain)) {
      resultsByDomain.set(result.domain, result);
    }
  }

  return Array.from(resultsByDomain.values());
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
  return Array.from({ length: Math.max(0, value.length - 1) }, (_, index) =>
    value.slice(index, index + 2),
  );
}

function isSearchResultRow(
  value: unknown,
): value is { name: string; domain: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).name === "string" &&
    typeof (value as Record<string, unknown>).domain === "string"
  );
}
