# Procurement Agent

Next.js app for SaaS spend and usage intelligence. Google Workspace provides
identity and SSO visibility. Pennylane provides supplier invoice data used to
infer contracts and renewal dates.

## Setup

Create `.env.local` from `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google/callback
GOOGLE_WORKSPACE_SCOPES="https://www.googleapis.com/auth/admin.directory.user.readonly https://www.googleapis.com/auth/admin.reports.audit.readonly https://www.googleapis.com/auth/admin.reports.usage.readonly"
ENCRYPTION_KEY=...
PENNYLANE_API_TOKEN=...
PENNYLANE_API_BASE_URL=https://app.pennylane.com/api/external/v2
PENNYLANE_SYNC_LOOKBACK_MONTHS=24
AI_CONTRACT_EXTRACTION_ENABLED=false
OPENAI_API_KEY=...
OPENAI_CONTRACT_EXTRACTION_MODEL=gpt-5-mini
```

The Pennylane token needs read-only Company API scopes for supplier invoices and
suppliers:

- `supplier_invoices:readonly` or `supplier_invoices:all`
- `suppliers:readonly` or `suppliers:all`

Tokens and API keys are only used server-side and must not be exposed to the
frontend.

For uploaded Pennylane invoices whose supplier metadata is empty or unreliable,
the sync can extract supplier and period hints from PDF attachments with
`pdftotext` when the binary is installed locally. PDF extraction is best-effort:
if it fails, the invoice is skipped unless metadata already links it to a
Google-visible supplier.

Optional AI contract extraction can be enabled with
`AI_CONTRACT_EXTRACTION_ENABLED=true`. The sync still uses `pdftotext` for raw
text extraction first, then sends only SSO-relevant ambiguous invoice text to
OpenAI Structured Outputs. Deterministic fields keep priority; AI output is used
to fill missing contract fields such as period, frequency, recurring amount,
product, plan, or seats. The raw AI result, model, prompt version, confidence,
missing fields, and conflicts are stored in
`raw_json.ai_contract_extraction`/`extracted_fields_json` for audit.
Possible contract-to-app matches are also reviewed by AI using the same OpenAI
key and model configuration.

## Run Locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/app/contracts` to sync Pennylane and inspect
contracts, renewal dates, missing contracts, and matches that need review.

## Pennylane Sync

The MVP sync is synchronous and idempotent:

1. `POST /api/pennylane/sync`
2. Fetch supplier invoices from `/supplier_invoices` using cursor pagination.
3. Fetch suppliers from `/suppliers`.
4. Upsert invoices into `pennylane_supplier_invoices`.
5. Optionally enrich ambiguous SSO-relevant invoices with AI structured
   extraction.
6. Infer contracts into `contracts`.
7. Match contracts against Google-visible `saas_suppliers`.
8. Rebuild `contract_app_links`.

The contract pipeline intentionally uses Google Workspace as a filter. Pennylane
supplier invoices that cannot be linked to a Google-visible supplier are skipped
for the contracts UI, so generic expenses do not flood the renewal workflow.
“Missing contracts” are generated only for curated paid suppliers with Google
visibility, not for every OAuth app discovered automatically.

Repeated syncs update existing rows by external IDs and stable contract keys
instead of creating duplicates.

Contracts with no newer Pennylane invoice after the expected renewal date plus a
frequency-specific grace period are marked `possibly_cancelled`. The current
grace periods are 45 days for monthly contracts, 120 days for quarterly
contracts, and 400 days for annual contracts. These contracts are excluded from
active spend and future renewal occurrences, but remain visible in review.

## Tests

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm lint
pnpm build
```

## MVP Limits

- Pennylane does not necessarily expose a first-class contract object.
- Renewal dates are inferred from supplier invoices and invoice service periods.
- PDF/attachment contract extraction is isolated behind the Pennylane client and
  currently depends on local `pdftotext` availability.
- AI extraction is optional and only assists ambiguous invoices; it does not
  replace deterministic matching or create contracts outside the SSO-filtered
  Pennylane flow.
- Cancellation deadlines, notice periods, and auto-renew clauses are often
  unavailable without legal contract documents.
- Google Workspace signals are identity/SSO signals, not proof of product usage.
  The UI uses wording like "No recent Google SAML usage signal" instead of
  "unused".
