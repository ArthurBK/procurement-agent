import assert from "node:assert/strict";
import test from "node:test";
import {
  isGooglePermissionError,
  toGoogleFrontendStatus,
} from "./frontendStatus.ts";

test("maps backend Google statuses to frontend connector states", () => {
  assert.equal(toGoogleFrontendStatus(null), "not_connected");
  assert.equal(toGoogleFrontendStatus("disconnected"), "not_connected");
  assert.equal(toGoogleFrontendStatus("connected"), "connected");
  assert.equal(toGoogleFrontendStatus("syncing"), "syncing");
  assert.equal(
    toGoogleFrontendStatus("connected_but_insufficient_permissions"),
    "error",
  );
});

test("detects Google permission errors from status or message", () => {
  assert.equal(isGooglePermissionError("permission_error", null), true);
  assert.equal(
    isGooglePermissionError(
      "error",
      "Please connect with a Google Workspace admin that has access to Admin SDK Directory and Reports.",
    ),
    true,
  );
  assert.equal(isGooglePermissionError("error", "Google refresh token was revoked."), false);
});
