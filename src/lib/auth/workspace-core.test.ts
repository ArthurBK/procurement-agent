import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkspaceAuthError,
  chooseRoleForNewMember,
  createWorkspaceNameFromDomain,
  createWorkspaceSlugFromDomain,
  getEnterpriseEmailDomain,
  getSafeAuthRedirectPath,
  isPublicEmailDomain,
  normalizeUserEmail,
} from "./workspace-core.ts";

test("normalizes Google account email before workspace resolution", () => {
  assert.equal(normalizeUserEmail(" Arthur@Example.COM "), "arthur@example.com");
});

test("extracts enterprise domains and blocks public email domains", () => {
  assert.equal(getEnterpriseEmailDomain("owner@acme.com"), "acme.com");
  assert.equal(isPublicEmailDomain("gmail.com"), true);
  assert.throws(
    () => getEnterpriseEmailDomain("owner@gmail.com"),
    (error) =>
      error instanceof WorkspaceAuthError &&
      error.code === "public_email_domain" &&
      error.status === 403,
  );
});

test("derives deterministic workspace display values from domain", () => {
  assert.equal(createWorkspaceNameFromDomain("acme.co"), "Acme Co");
  assert.equal(createWorkspaceSlugFromDomain("acme.co"), "acme-co");
});

test("assigns owner to first workspace member and member afterwards", () => {
  assert.equal(chooseRoleForNewMember(0), "owner");
  assert.equal(chooseRoleForNewMember(1), "member");
});

test("keeps auth redirect paths inside the app", () => {
  assert.equal(getSafeAuthRedirectPath("/app/contracts"), "/app/contracts");
  assert.equal(getSafeAuthRedirectPath(["/app/usage/identity"]), "/app/usage/identity");
  assert.equal(getSafeAuthRedirectPath("https://example.com"), "/app/usage/identity");
  assert.equal(getSafeAuthRedirectPath("//example.com"), "/app/usage/identity");
  assert.equal(getSafeAuthRedirectPath("/login"), "/app/usage/identity");
  assert.equal(getSafeAuthRedirectPath("/auth/callback"), "/app/usage/identity");
});
