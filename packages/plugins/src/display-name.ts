/**
 * Display-name normalization for catalog plugins.
 *
 * Marketplace manifests are inconsistent: a vendor names a plugin `Gmail`, the
 * next one names it `zapier`, and a curated source names it
 * `aws-agents-for-devsecops`. The UI renders those strings verbatim, so one
 * list reads `Zapier` and the next reads `zapier` beside it. This turns a
 * slug-shaped name into the title-cased form a person would write, in the
 * catalog, so every consumer shows the same thing without its own guesswork.
 *
 * Two rules keep it from "correcting" names that are already right:
 *
 * - a token that carries any uppercase is left exactly as it is, which
 *   preserves vendor casing (`Gmail`, `iMessage`, `eToro`, `PDF Viewer`) and
 *   makes the function idempotent;
 * - a token with a published non-title-case form comes from `BRAND_TOKENS`
 *   instead of the general rule, because title-casing `npm` → `Npm` or
 *   `github` → `Github` is exactly the inconsistency this exists to remove.
 */
const BRAND_TOKENS: Readonly<Record<string, string>> = {
  '42crunch': '42Crunch',
  adlc: 'ADLC',
  ai: 'AI',
  bigquery: 'BigQuery',
  brightdata: 'Bright Data',
  amd: 'AMD',
  alloydb: 'AlloyDB',
  api: 'API',
  apis: 'APIs',
  aws: 'AWS',
  cds: 'CDS',
  ckeditor: 'CKEditor',
  clickhouse: 'ClickHouse',
  cli: 'CLI',
  coderabbit: 'CodeRabbit',
  crowdsec: 'CrowdSec',
  crm: 'CRM',
  crowdstrike: 'CrowdStrike',
  css: 'CSS',
  dak: 'DAK',
  dominodatalab: 'Domino Data Lab',
  datadog: 'Datadog',
  fullstory: 'FullStory',
  gitkraken: 'GitKraken',
  devops: 'DevOps',
  devsecops: 'DevSecOps',
  gcp: 'GCP',
  github: 'GitHub',
  gitlab: 'GitLab',
  graphql: 'GraphQL',
  html: 'HTML',
  huggingface: 'Hugging Face',
  ibm: 'IBM',
  idmp: 'IDMP',
  imessage: 'iMessage',
  ios: 'iOS',
  javascript: 'JavaScript',
  json: 'JSON',
  k8s: 'Kubernetes',
  langchain: 'LangChain',
  llm: 'LLM',
  llms: 'LLMs',
  logrocket: 'LogRocket',
  lsp: 'LSP',
  lseg: 'LSEG',
  macos: 'macOS',
  md: 'MD',
  mcp: 'MCP',
  mongodb: 'MongoDB',
  oracledb: 'Oracle Database',
  pagerduty: 'PagerDuty',
  planetscale: 'PlanetScale',
  posthog: 'PostHog',
  mysql: 'MySQL',
  ngs: 'NGS',
  nosql: 'NoSQL',
  nvidia: 'NVIDIA',
  ocr: 'OCR',
  openai: 'OpenAI',
  paypal: 'PayPal',
  pdf: 'PDF',
  postgres: 'Postgres',
  postgresql: 'PostgreSQL',
  pytorch: 'PyTorch',
  sap: 'SAP',
  sdk: 'SDK',
  seo: 'SEO',
  servicenow: 'ServiceNow',
  sql: 'SQL',
  sre: 'SRE',
  tensorflow: 'TensorFlow',
  terraform: 'Terraform',
  twg: 'TWG',
  typescript: 'TypeScript',
  ui: 'UI',
  ui5: 'UI5',
  ux: 'UX',
  whatsapp: 'WhatsApp',
  wordpress: 'WordPress',
  youtube: 'YouTube',
}

/** Articles, conjunctions and prepositions stay lowercase inside a name. */
const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

/**
 * Names whose slug form hides a domain or an initialism, which the token rules
 * below cannot recover: `monday-com` is `monday.com`, not `Monday Com`.
 */
const FULL_NAMES: Readonly<Record<string, string>> = {
  'bigdata-com': 'BigData.com',
  'incident-io': 'Incident.io',
  'monday-com': 'Monday.com',
  vpai: 'VPAI',
}

/**
 * Title-cases a slug-shaped name and leaves a properly cased one alone.
 *
 * Separators become spaces (`adobe-for-creativity` → `Adobe for Creativity`),
 * but a dot does not, so domain-style names keep their shape
 * (`monday.com` → `Monday.com`).
 */
export function normalizeDisplayName(value: string): string {
  const trimmed = value.trim()
  const known = FULL_NAMES[trimmed.toLowerCase()]
  if (known !== undefined) return known
  const tokens = trimmed.split(/[-_\s]+/u).filter(Boolean)
  if (tokens.length === 0) return value
  return tokens
    .map((token, index) => {
      const key = token.toLowerCase()
      const brand = BRAND_TOKENS[key]
      if (brand !== undefined) return brand
      // Any uppercase means the vendor already chose a casing.
      if (/\p{Lu}/u.test(token)) return token
      if (index > 0 && SMALL_WORDS.has(key)) return key
      return `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`
    })
    .join(' ')
}
