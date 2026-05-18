export const LOGO_DEV_IMAGE_SIZE = 128;

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  let domain = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./, "")
    .replace(/\.$/, "");

  const portStartIndex = domain.indexOf(":");

  if (portStartIndex !== -1) {
    domain = domain.slice(0, portStartIndex);
  }

  if (
    domain.length === 0 ||
    !domain.includes(".") ||
    /\s/.test(domain) ||
    !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)
  ) {
    return null;
  }

  return domain;
}

export function buildLogoUrl(domain: string | null | undefined): string | null {
  const normalizedDomain = normalizeDomain(domain);
  const token = process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY?.trim();

  if (!normalizedDomain || !token) {
    return null;
  }

  return `https://img.logo.dev/${normalizedDomain}?token=${encodeURIComponent(
    token,
  )}&size=${LOGO_DEV_IMAGE_SIZE}&format=png&fallback=monogram`;
}
