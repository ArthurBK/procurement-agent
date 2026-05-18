import { subMonths } from "date-fns";

export type PennylaneClientConfig = {
  apiToken?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type PennylaneListResponse<T> = {
  has_more?: boolean;
  items?: T[];
  next_cursor?: string | null;
};

export type PennylaneSupplierInvoiceApiRow = Record<string, unknown>;
export type PennylaneSupplierApiRow = Record<string, unknown>;

export class PennylaneApiError extends Error {
  readonly responseBody: unknown;
  readonly status: number;

  constructor(
    message: string,
    status: number,
    responseBody: unknown = null,
  ) {
    super(message);
    this.responseBody = responseBody;
    this.status = status;
  }
}

const DEFAULT_BASE_URL = "https://app.pennylane.com/api/external/v2";
const MAX_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 30_000;

export function getPennylaneSyncLookbackMonths(): number {
  const rawValue = process.env.PENNYLANE_SYNC_LOOKBACK_MONTHS;
  const parsedValue = rawValue ? Number(rawValue) : 24;

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? Math.floor(parsedValue)
    : 24;
}

export function getPennylaneLookbackStartDate(now = new Date()): string {
  return subMonths(now, getPennylaneSyncLookbackMonths())
    .toISOString()
    .slice(0, 10);
}

export class PennylaneClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: PennylaneClientConfig = {}) {
    this.apiToken = config.apiToken ?? requireEnv("PENNYLANE_API_TOKEN");
    this.baseUrl = normalizeBaseUrl(
      config.baseUrl ?? process.env.PENNYLANE_API_BASE_URL ?? DEFAULT_BASE_URL,
    );
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? getPennylaneApiTimeoutMs();
  }

  async testConnection(): Promise<Record<string, unknown>> {
    return this.getJson<Record<string, unknown>>("/me");
  }

  async listSupplierInvoices({
    fromDate,
    toDate,
  }: {
    fromDate: string;
    toDate?: string;
  }): Promise<PennylaneSupplierInvoiceApiRow[]> {
    return this.listPaginated<PennylaneSupplierInvoiceApiRow>(
      "/supplier_invoices",
      {
        filter: JSON.stringify([
          { field: "date", operator: "gteq", value: fromDate },
          ...(toDate ? [{ field: "date", operator: "lteq", value: toDate }] : []),
        ]),
        limit: MAX_LIMIT,
        sort: "date",
        use_2026_api_changes: true,
      },
    );
  }

  async getSupplierInvoice(
    invoiceId: string,
  ): Promise<PennylaneSupplierInvoiceApiRow> {
    return this.getJson<PennylaneSupplierInvoiceApiRow>(
      `/supplier_invoices/${encodeURIComponent(invoiceId)}`,
      {
        use_2026_api_changes: true,
      },
    );
  }

  async listSuppliers(): Promise<PennylaneSupplierApiRow[]> {
    return this.listPaginated<PennylaneSupplierApiRow>("/suppliers", {
      limit: MAX_LIMIT,
    });
  }

  async getLinkedResource<T>(url: string): Promise<T> {
    return this.fetchJsonWithRetry<T>(new URL(url));
  }

  async getAttachmentBytes(attachmentUrl: string): Promise<ArrayBuffer | null> {
    let response: Response;

    try {
      response = await this.fetchImpl(attachmentUrl, {
        headers: {
          Accept: "application/pdf,application/octet-stream",
        },
        signal: createTimeoutSignal(this.timeoutMs),
      });
    } catch {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    return response.arrayBuffer();
  }

  private async listPaginated<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
  ): Promise<T[]> {
    let cursor: string | undefined;
    const items: T[] = [];

    do {
      const response = await this.getJson<PennylaneListResponse<T>>(path, {
        ...query,
        cursor,
      });

      items.push(...(response.items ?? []));
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    return items;
  }

  private async getJson<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return this.fetchJsonWithRetry<T>(url);
  }

  private async fetchJsonWithRetry<T>(url: URL): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;

      try {
        response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.apiToken}`,
          },
          signal: createTimeoutSignal(this.timeoutMs),
        });
      } catch (error) {
        lastError = new Error(
          isAbortError(error)
            ? `Pennylane API request timed out after ${this.timeoutMs}ms.`
            : `Pennylane API request failed: ${
                error instanceof Error ? error.message : "unknown network error"
              }`,
        );
        await sleep(250 * 2 ** attempt);
        continue;
      }

      if (response.ok) {
        return (await response.json()) as T;
      }

      const responseBody = await readResponseBody(response);
      const message = buildPennylaneErrorMessage(response.status, responseBody);

      if (response.status !== 429 && response.status < 500) {
        throw new PennylaneApiError(message, response.status, responseBody);
      }

      lastError = new PennylaneApiError(message, response.status, responseBody);
      await sleep(250 * 2 ** attempt);
    }

    throw lastError ?? new Error("Pennylane request failed.");
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}

export function getPennylaneApiTimeoutMs(): number {
  const rawValue = process.env.PENNYLANE_API_TIMEOUT_MS;
  const parsedValue = rawValue ? Number(rawValue) : DEFAULT_TIMEOUT_MS;

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? Math.floor(parsedValue)
    : DEFAULT_TIMEOUT_MS;
}

function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  const timeout = (
    AbortSignal as typeof AbortSignal & {
      timeout?: (milliseconds: number) => AbortSignal;
    }
  ).timeout;

  return timeout ? timeout(timeoutMs) : undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildPennylaneErrorMessage(status: number, body: unknown): string {
  if (status === 401 || status === 403) {
    return "Pennylane token is invalid or missing required read-only scopes.";
  }

  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.detail;

    if (typeof message === "string") {
      return `Pennylane API request failed (${status}): ${message}`;
    }
  }

  return `Pennylane API request failed with status ${status}.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
