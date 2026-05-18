import assert from "node:assert/strict";
import test from "node:test";
import { buildLogoSearchQueries } from "./logoSearchQueries.ts";

test("builds normalized Logo.dev search queries", () => {
  assert.deepEqual(buildLogoSearchQueries("AIRBNB FR"), [
    "AIRBNB FR",
    "AIRBNB",
  ]);
  assert.deepEqual(buildLogoSearchQueries("OpenAI*123 SAS"), [
    "OpenAI*123 SAS",
    "OpenAI SAS",
  ]);
});
