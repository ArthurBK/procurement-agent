const DEFAULT_STALE_AFTER_MINUTES = 10;

export function getPennylaneSyncStaleAfterMs(): number {
  const rawValue = process.env.PENNYLANE_SYNC_STALE_AFTER_MINUTES;
  const parsedValue = rawValue ? Number(rawValue) : DEFAULT_STALE_AFTER_MINUTES;
  const minutes =
    Number.isFinite(parsedValue) && parsedValue > 0
      ? parsedValue
      : DEFAULT_STALE_AFTER_MINUTES;

  return minutes * 60 * 1000;
}

export function isPennylaneSyncRunStale({
  now = new Date(),
  staleAfterMs = getPennylaneSyncStaleAfterMs(),
  startedAt,
}: {
  now?: Date;
  staleAfterMs?: number;
  startedAt: string | null | undefined;
}): boolean {
  if (!startedAt) {
    return false;
  }

  const startedAtMs = new Date(startedAt).getTime();

  if (!Number.isFinite(startedAtMs)) {
    return false;
  }

  return now.getTime() - startedAtMs > staleAfterMs;
}

export function isPennylaneSyncingIntegrationStale({
  now = new Date(),
  staleAfterMs = getPennylaneSyncStaleAfterMs(),
  startedAt,
}: {
  now?: Date;
  staleAfterMs?: number;
  startedAt: string | null | undefined;
}): boolean {
  return (
    !startedAt ||
    isPennylaneSyncRunStale({
      now,
      staleAfterMs,
      startedAt,
    })
  );
}

export function buildStalePennylaneSyncMessage(startedAt: string | null): string {
  if (!startedAt) {
    return "Previous Pennylane sync did not finish and was marked failed so you can run sync again.";
  }

  return `Previous Pennylane sync started at ${startedAt} did not finish and was marked failed so you can run sync again.`;
}
