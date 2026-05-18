export function buildLogoSearchQueries(displayName: string): string[] {
  const trimmedDisplayName = displayName.trim();
  const withoutTrailingCountryCode = trimmedDisplayName.replace(
    /([a-z])([A-Z]{2})$/,
    "$1",
  );
  const normalizedWords = trimmedDisplayName
    .replace(/[._*+/\\-]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedWithoutCountryCode = normalizedWords.replace(
    /\s+[A-Z]{2}$/i,
    "",
  );

  return Array.from(
    new Set(
      [
        trimmedDisplayName,
        withoutTrailingCountryCode,
        normalizedWords,
        normalizedWithoutCountryCode,
      ].filter((query) => query.length >= 2),
    ),
  );
}
