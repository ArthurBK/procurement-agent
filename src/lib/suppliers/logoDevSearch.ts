import { buildLogoUrl, normalizeDomain } from "./logo.ts";

export type LogoDevSearchResult = {
  name: string;
  domain: string;
  logoUrl: string | null;
};

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

  return body
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
    .slice(0, 10);
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
