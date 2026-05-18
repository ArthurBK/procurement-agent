export function sanitizePostgresValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizePostgresString(value);
  }

  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePostgresValue(item));
  }

  if (value && typeof value === "object") {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        sanitizePostgresString(key),
        sanitizePostgresValue(entryValue),
      ]),
    );
  }

  return value;
}

export function sanitizePostgresString(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\\u0000/gi, "");
}
