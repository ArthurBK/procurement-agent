export type KnownSaasBrand = {
  aliases: readonly string[];
  domain: string;
  name: string;
};

export const KNOWN_SAAS_BRANDS = [
  { name: "Airbnb", domain: "airbnb.com", aliases: ["airbnb"] },
  { name: "Anthropic", domain: "anthropic.com", aliases: ["anthropic"] },
  { name: "Canva", domain: "canva.com", aliases: ["canva pro", "canva teams"] },
  {
    name: "Claude",
    domain: "claude.ai",
    aliases: ["anthropic claude", "claude", "claude ai"],
  },
  { name: "Docker", domain: "docker.com", aliases: ["docker hub", "docker inc"] },
  {
    name: "ElevenLabs",
    domain: "elevenlabs.io",
    aliases: ["eleven labs", "elevenlabs", "elevenlabs io"],
  },
  { name: "Slack", domain: "slack.com", aliases: ["slack technologies"] },
  { name: "Notion", domain: "notion.so", aliases: ["notion labs"] },
  {
    name: "OpenAI",
    domain: "openai.com",
    aliases: ["chatgpt", "open ai", "openai api", "openai chatgpt"],
  },
  { name: "HubSpot", domain: "hubspot.com", aliases: ["hub spot"] },
  { name: "Stripe", domain: "stripe.com", aliases: ["stripe payments"] },
  {
    name: "Perplexity",
    domain: "perplexity.ai",
    aliases: ["perplexity", "perplexity ai", "perpplexity", "perpplexity ai"],
  },
  { name: "Salesforce", domain: "salesforce.com", aliases: ["salesforce.com"] },
  {
    name: "Zoom",
    domain: "zoom.us",
    aliases: ["zoom video", "zoom video communications"],
  },
  { name: "Figma", domain: "figma.com", aliases: ["figma inc"] },
  { name: "GitHub", domain: "github.com", aliases: ["github inc"] },
  { name: "GitLab", domain: "gitlab.com", aliases: ["gitlab inc"] },
  {
    name: "Atlassian",
    domain: "atlassian.com",
    aliases: ["jira", "confluence", "trello"],
  },
  { name: "Vercel", domain: "vercel.com", aliases: ["vercel inc"] },
  { name: "Datadog", domain: "datadoghq.com", aliases: ["datadog inc"] },
  { name: "Sentry", domain: "sentry.io", aliases: ["getsentry"] },
  { name: "Intercom", domain: "intercom.com", aliases: ["intercom inc"] },
  { name: "Zendesk", domain: "zendesk.com", aliases: ["zendesk inc"] },
  { name: "Dropbox", domain: "dropbox.com", aliases: ["dropbox inc"] },
  { name: "DocuSign", domain: "docusign.com", aliases: ["docu sign"] },
  {
    name: "Adobe",
    domain: "adobe.com",
    aliases: ["adobe systems", "adobe creative cloud"],
  },
  { name: "Shopify", domain: "shopify.com", aliases: ["shopify inc"] },
  {
    name: "Mailchimp",
    domain: "mailchimp.com",
    aliases: ["mail chimp", "intuit mailchimp"],
  },
  { name: "Zapier", domain: "zapier.com", aliases: ["zapier automation", "zapier inc"] },
  { name: "Make", domain: "make.com", aliases: ["integromat", "make.com"] },
  { name: "Asana", domain: "asana.com", aliases: ["asana inc"] },
  { name: "monday.com", domain: "monday.com", aliases: ["monday", "monday crm"] },
  { name: "ClickUp", domain: "clickup.com", aliases: ["click up"] },
  { name: "Airtable", domain: "airtable.com", aliases: ["airtable inc"] },
  { name: "Calendly", domain: "calendly.com", aliases: ["calendly llc"] },
] as const satisfies readonly KnownSaasBrand[];

const TRAILING_COMPANY_SUFFIXES = new Set([
  "ag",
  "bv",
  "co",
  "corp",
  "corporation",
  "france",
  "gmbh",
  "inc",
  "ireland",
  "limited",
  "llc",
  "ltd",
  "oy",
  "plc",
  "sa",
  "sarl",
  "sas",
  "sasu",
  "sl",
  "spa",
  "technologies",
]);
const TRAILING_MARKET_SUFFIXES = new Set([
  "au",
  "be",
  "ca",
  "ch",
  "de",
  "en",
  "es",
  "eu",
  "fr",
  "gb",
  "ie",
  "it",
  "jp",
  "nl",
  "pt",
  "uk",
  "us",
  "usa",
]);
const LEADING_BILLING_NOISE = new Set([
  "ach",
  "billing",
  "cb",
  "card",
  "invoice",
  "payment",
  "paiement",
  "pos",
  "purchase",
  "sepa",
  "subscription",
]);
const KNOWN_SAAS_BRANDS_BY_ALIAS = buildKnownSaasBrandAliasMap();

export function getKnownSaasBrand(input: string | null | undefined) {
  return KNOWN_SAAS_BRANDS_BY_ALIAS.get(normalizeKnownSaasName(input)) ?? null;
}

export function getKnownSaasDomain(input: string | null | undefined): string | null {
  return getKnownSaasBrand(input)?.domain ?? null;
}

export function normalizeKnownSaasName(input: string | null | undefined): string {
  const tokens = (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  while (tokens.length > 1 && LEADING_BILLING_NOISE.has(tokens[0] ?? "")) {
    tokens.shift();
  }

  while (
    tokens.length > 1 &&
    (TRAILING_COMPANY_SUFFIXES.has(tokens.at(-1) ?? "") ||
      TRAILING_MARKET_SUFFIXES.has(tokens.at(-1) ?? ""))
  ) {
    tokens.pop();
  }

  return tokens.join(" ");
}

function buildKnownSaasBrandAliasMap() {
  const brandsByAlias = new Map<string, KnownSaasBrand>();

  for (const brand of KNOWN_SAAS_BRANDS) {
    for (const value of [brand.name, brand.domain, ...brand.aliases]) {
      brandsByAlias.set(normalizeKnownSaasName(value), brand);
      brandsByAlias.set(normalizeKnownSaasName(value.split(".")[0] ?? value), brand);
    }
  }

  return brandsByAlias;
}
