export type GoogleFrontendStatus =
  | "not_connected"
  | "connected"
  | "syncing"
  | "error";

export function toGoogleFrontendStatus(
  status: string | null | undefined,
): GoogleFrontendStatus {
  if (!status || status === "not_connected" || status === "disconnected") {
    return "not_connected";
  }

  if (status === "connected") {
    return "connected";
  }

  if (status === "syncing") {
    return "syncing";
  }

  return "error";
}

export function isGooglePermissionError(
  status: string | null | undefined,
  lastError: string | null | undefined,
): boolean {
  if (
    status === "permission_error" ||
    status === "connected_but_insufficient_permissions" ||
    status === "failed_permissions"
  ) {
    return true;
  }

  const normalizedError = (lastError ?? "").toLowerCase();

  return (
    normalizedError.includes("permission") ||
    normalizedError.includes("admin sdk") ||
    normalizedError.includes("directory and reports")
  );
}
