import type { MemberRole } from "./types";

export type WorkspaceAuthErrorCode =
  | "authentication_required"
  | "email_required"
  | "public_email_domain"
  | "workspace_membership_required";

export class WorkspaceAuthError extends Error {
  code: WorkspaceAuthErrorCode;
  status: 401 | 403;

  constructor(
    code: WorkspaceAuthErrorCode,
    message: string,
    status: 401 | 403 = code === "authentication_required" ? 401 : 403,
  ) {
    super(message);
    this.name = "WorkspaceAuthError";
    this.code = code;
    this.status = status;
  }
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  "aol.com",
  "free.fr",
  "gmail.com",
  "gmx.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.fr",
  "icloud.com",
  "laposte.net",
  "live.com",
  "mac.com",
  "me.com",
  "msn.com",
  "orange.fr",
  "outlook.com",
  "outlook.fr",
  "proton.me",
  "protonmail.com",
  "wanadoo.fr",
  "yahoo.com",
  "yahoo.fr",
]);

export function normalizeUserEmail(email: string | null | undefined): string {
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new WorkspaceAuthError(
      "email_required",
      "A Google account with a verified email is required.",
    );
  }

  return normalizedEmail;
}

export function getEnterpriseEmailDomain(
  email: string | null | undefined,
): string {
  const normalizedEmail = normalizeUserEmail(email);
  const domain = normalizedEmail.split("@").at(1)?.trim().toLowerCase();

  if (!domain) {
    throw new WorkspaceAuthError(
      "email_required",
      "A Google account with a verified email is required.",
    );
  }

  if (isPublicEmailDomain(domain)) {
    throw new WorkspaceAuthError(
      "public_email_domain",
      "Use a company Google account to create or join a workspace.",
    );
  }

  return domain;
}

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

export function createWorkspaceNameFromDomain(domain: string): string {
  return domain
    .split(".")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function createWorkspaceSlugFromDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function chooseRoleForNewMember(memberCount: number): MemberRole {
  return memberCount === 0 ? "owner" : "member";
}

export function authContextErrorToResponse(error: unknown): Response | null {
  if (!(error instanceof WorkspaceAuthError)) {
    return null;
  }

  return Response.json({ errors: [error.message], code: error.code }, {
    status: error.status,
  });
}
