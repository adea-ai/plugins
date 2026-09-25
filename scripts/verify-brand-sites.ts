import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { byteDigest } from '../packages/catalog-core/src/index.js'
import { parseProductIconOverrides } from '../packages/catalog-core/src/icons.js'
import { resolveSiteIcon, type SiteIconFetcher } from '../packages/catalog-core/src/site-icons.js'

/**
 * Re-resolves every curated site override against the policy a live build uses.
 *
 * A site override is a promise that the vendor's own page yields a usable mark.
 * When that stops being true — the page moves, the icon is dropped, the host
 * starts answering 403 — the next live build silently publishes a monogram
 * again, and nothing reports it. This walks the configured list and says which
 * entries no longer resolve.
 */
const flags = new Set(process.argv.slice(2))
const strict = flags.has('--strict')
const asJson = flags.has('--json')

const fetcher: SiteIconFetcher = {
  fetchText: async (url) => {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'adea-catalog-curation/1.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  },
  fetchBytes: async (url) => {
    const response = await fetch(url, {
      headers: { accept: 'image/*', 'user-agent': 'adea-catalog-curation/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  },
  digest: (bytes) => byteDigest(bytes),
}

const configPath = join(process.cwd(), 'config', 'product-icons.json')
const overrides = parseProductIconOverrides(JSON.parse(await fs.readFile(configPath, 'utf8')))
const sites = Object.entries(overrides.overrides)
  .flatMap(([productKey, value]) =>
    typeof value === 'string' && value.startsWith('https://') ? [[productKey, value] as const] : []
  )
  .toSorted(([left], [right]) => left.localeCompare(right))

const resolved: Record<string, string> = {}
const failures: Record<string, string> = {}
for (const [productKey, site] of sites) {
  const result = await resolveSiteIcon(site, fetcher)
  if ('failed' in result) {
    failures[productKey] = `${site}: ${result.failed}`
    if (!asJson) console.error(`FAIL  ${productKey.padEnd(34)} ${site.padEnd(46)} ${result.failed}`)
    continue
  }
  resolved[productKey] = result.url
  if (!asJson)
    console.log(
      `ok    ${productKey.padEnd(34)} ${site.padEnd(46)} ${result.contentType} ${result.bytes.byteLength}B`
    )
}

const summary = {
  resolvedCount: Object.keys(resolved).length,
  failureCount: Object.keys(failures).length,
  total: sites.length,
  resolved,
  failures,
}
if (asJson) console.log(JSON.stringify(summary, null, 2))
else
  console.log(
    `\n${summary.resolvedCount} of ${sites.length} curated sites resolve a mark; ${summary.failureCount} do not.`
  )
// A vendor site can be down for a day, so a curator runs this before a
// republication; CI stays out of it unless --strict is asked for.
process.exit(strict && summary.failureCount > 0 ? 1 : 0)
