import assert from "node:assert/strict";
import test from "node:test";
import {
  PennylaneApiError,
  PennylaneClient,
} from "./client.ts";

test("PennylaneClient sends bearer token", async () => {
  const requests: Request[] = [];
  const client = new PennylaneClient({
    apiToken: "secret-token",
    baseUrl: "https://example.test/api/external/v2",
    fetchImpl: async (input, init) => {
      requests.push(new Request(input, init));

      return Response.json({ company: { name: "Acme" } });
    },
  });

  await client.testConnection();

  assert.equal(requests[0].headers.get("authorization"), "Bearer secret-token");
  assert.equal(requests[0].url, "https://example.test/api/external/v2/me");
});

test("PennylaneClient follows cursor pagination", async () => {
  const urls: string[] = [];
  const client = new PennylaneClient({
    apiToken: "secret-token",
    baseUrl: "https://example.test/api/external/v2",
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);

      if (!url.includes("cursor=")) {
        return Response.json({
          has_more: true,
          items: [{ id: 1 }],
          next_cursor: "next-page",
        });
      }

      return Response.json({
        has_more: false,
        items: [{ id: 2 }],
        next_cursor: null,
      });
    },
  });

  const invoices = await client.listSupplierInvoices({ fromDate: "2025-01-01" });

  assert.deepEqual(invoices, [{ id: 1 }, { id: 2 }]);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /filter=/);
  assert.match(urls[1], /cursor=next-page/);
});

test("PennylaneClient throws HTTP errors without leaking token", async () => {
  const client = new PennylaneClient({
    apiToken: "secret-token",
    baseUrl: "https://example.test/api/external/v2",
    fetchImpl: async () =>
      Response.json({ message: "Forbidden" }, { status: 403 }),
  });

  await assert.rejects(
    () => client.listSuppliers(),
    (error) => {
      assert.equal(error instanceof PennylaneApiError, true);
      assert.equal((error as PennylaneApiError).status, 403);
      assert.doesNotMatch((error as Error).message, /secret-token/);

      return true;
    },
  );
});
