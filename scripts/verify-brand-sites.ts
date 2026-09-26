import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createSiteIconFetcher, SITE_FETCH_TIMEOUT_MS } from '../packages/plugins/src/index.js'
import { parseProductIconOverrides } from '../packages/plugins/src/icons.js'
import { resolveSiteIcon } from '../packages/plugins/src/site-icons.js'

/**
 * Re-resolves every curated site override against the policy a live build uses.
 *
 * A site override is a promise that the vendor's own page yields a usable mark.
 * When that stops being true — the page moves, the icon is dropped, the host
 * starts answering 403 — the next live build silently publishes a monogram
 * again, and nothing reports it. This walks the configured list and says which
 * entries no longer resolve.
 *
 * The fetcher is the build's own, headers included. A verifier carrying its own
 * `accept`/`user-agent` reports sites healthy that the build then fails to
 * resolve, which is how a curated entry can rot unnoticed.
 */
const flags = new Set(process.argv.slice(2))
const strict = flags.has('--strict')
const asJson = flags.has('--json')

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
  // One deadline per site, as a live build gives each product: a vendor that
  // never answers spends its own budget and not the next site's.
  const result = await resolveSiteIcon(
    site,
    createSiteIconFetcher(AbortSignal.timeout(SITE_FETCH_TIMEOUT_MS))
  )
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
