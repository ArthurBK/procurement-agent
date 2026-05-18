import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizePostgresString,
  sanitizePostgresValue,
} from "./postgresSanitize.ts";

test("removes null bytes from strings before Postgres jsonb writes", () => {
  assert.equal(sanitizePostgresString("Air\u0000call"), "Aircall");
  assert.equal(sanitizePostgresString("Air\\u0000call"), "Aircall");
});

test("sanitizes nested invoice payloads before Postgres jsonb writes", () => {
  const value = sanitizePostgresValue({
    label: "Invoice\u0000",
    nested: [{ pdf_text: "PDF\\u0000 text" }],
    optional: undefined,
  });

  assert.deepEqual(value, {
    label: "Invoice",
    nested: [{ pdf_text: "PDF text" }],
    optional: null,
  });
});
