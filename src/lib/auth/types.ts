export type MemberRole = "owner" | "member";

export type IntegrationRequestContext = {
  organizationId: string;
  userId: string;
};

export type WorkspaceContext = IntegrationRequestContext & {
  organizationName: string;
  organizationSlug: string;
  role: MemberRole;
  userEmail: string;
  workspaceDomain: string;
};
