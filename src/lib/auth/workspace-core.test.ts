import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkspaceAuthError,
  chooseRoleForNewMember,
  createWorkspaceNameFromDomain,
  createWorkspaceSlugFromDomain,
  getEnterpriseEmailDomain,
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
