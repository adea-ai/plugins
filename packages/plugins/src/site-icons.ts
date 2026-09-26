import { inspectIconBytes, MAX_ICON_BYTES, type IconContentType } from './icons.js'

/**
 * Site icon discovery, for products that ship no brand mark of their own.
 *
 * Many plugins are a thin wrapper over a vendor's API: the content carries no
 * logo, and the declared homepage is the only pointer to the vendor. Fetching
 * that site's icon once at publish time, verifying it and mirroring it as a
 * release asset replaces a per-render favicon lookup in the client.
 */
export const SITE_ICON_MAX_HTML_BYTES = 4 * 1024 * 1024

/**
 * Only the document head is parsed. Icon links are declared there, and vendor
 * landing pages are frequently several megabytes of markup and script.
 */
export const SITE_ICON_HEAD_BYTES = 256 * 1024

/** Hosts that serve repository chrome rather than a product brand. */
const REPOSITORY_HOSTS =
  /(^|\.)(github\.com|githubusercontent\.com|gitlab\.com|bitbucket\.org|codeberg\.org|sourceforge\.net|gitee\.com)$/

export interface SiteIcon {
  readonly url: string
  /** The product homepage the icon was discovered from. */
  readonly homepage: string
  readonly bytes: Uint8Array
  readonly contentType: IconContentType
  readonly digest: string
}

/**
 * Whether a homepage can stand in for a product brand.
 *
 * Only HTTPS sites qualify: a repository URL would yield the forge's own logo,
 * and a non-routable host is a request forgery risk rather than a vendor site.
 */
export function isVendorHomepage(homepage: string | undefined): boolean {
  if (!homepage) return false
  let parsed: URL
  try {
    parsed = new URL(homepage)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return isPublicHostname(parsed.hostname) && !REPOSITORY_HOSTS.test(parsed.hostname)
}

/** Rejects loopback, link-local, private and internal hostnames. */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false
  if (host.endsWith('.internal') || host.endsWith('.home.arpa')) return false
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd'))
    return false
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number) as [number, number]
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    return true
  }
  // A bare hostname label has no public site behind it.
  return host.includes('.')
}

/**
 * Extracts icon URLs from a document head, best candidate first.
 *
 * `apple-touch-icon` is preferred because it is a square PNG sized for a home
 * screen; declared `icon` links follow in declared order; `/favicon.ico` is the
 * conventional last resort when nothing is declared.
 */
export function discoverSiteIcons(html: string, baseUrl: string): readonly string[] {
  const candidates: { href: string; rank: number }[] = []
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? []
  for (const tag of linkTags) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? ''
    if (!/\b(apple-touch-icon|icon|shortcut|mask-icon)\b/.test(rel)) continue
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    const sizes = /\bsizes\s*=\s*["']?([0-9]+x[0-9]+)/i.exec(tag)?.[1]
    const edge = sizes ? Number.parseInt(sizes, 10) : 180
    // Apple touch icons lead; larger declared sizes lead within a group.
    const rank = rel.includes('apple-touch-icon') ? 0 : rel.includes('mask-icon') ? 2 : 1
    candidates.push({ href, rank: rank * 1000 + Math.max(0, 512 - (edge || 180)) })
  }
  const resolved: { url: string; rank: number }[] = []
  for (const candidate of candidates.toSorted((left, right) => left.rank - right.rank)) {
    try {
      const url = new URL(candidate.href, baseUrl)
      if (url.protocol !== 'https:' || !isPublicHostname(url.hostname)) continue
      resolved.push({ url: url.toString(), rank: candidate.rank })
    } catch {
      continue
    }
  }
  // The conventional location is always the last candidate: a site whose
  // declared icon turns out to be unusable can still resolve through it.
  try {
    const fallback = new URL('/favicon.ico', baseUrl)
    if (fallback.protocol === 'https:' && isPublicHostname(fallback.hostname))
      resolved.push({ url: fallback.toString(), rank: 5000 })
  } catch {
    // An unparseable base leaves the declared candidates only.
  }
  return [...new Set(resolved.toSorted((l, r) => l.rank - r.rank).map((item) => item.url))]
}

export interface SiteIconFetcher {
  readonly fetchText: (url: string) => Promise<string>
  readonly fetchBytes: (url: string) => Promise<Uint8Array>
  readonly digest: (bytes: Uint8Array) => string
}

/**
 * Resolves the best usable icon for a vendor homepage.
 *
 * Every candidate is inspected with the same gate as an in-content mark, so a
 * site that serves an oversized, unsupported or scripted image yields no icon
 * rather than a mirrored liability.
 */
export async function resolveSiteIcon(
  homepage: string,
  fetcher: SiteIconFetcher
): Promise<SiteIcon | { readonly failed: string }> {
  if (!isVendorHomepage(homepage)) return { failed: 'NOT_VENDOR_HOMEPAGE' }
  let html: string
  try {
    html = await fetcher.fetchText(homepage)
  } catch (error) {
    return { failed: `HOMEPAGE_FETCH_FAILED: ${message(error)}` }
  }
  if (html.length > SITE_ICON_MAX_HTML_BYTES) return { failed: 'HOMEPAGE_TOO_LARGE' }
  for (const url of discoverSiteIcons(html.slice(0, SITE_ICON_HEAD_BYTES), homepage)) {
    let bytes: Uint8Array
    try {
      bytes = await fetcher.fetchBytes(url)
    } catch {
      continue
    }
    if (bytes.byteLength > MAX_ICON_BYTES) continue
    const inspected = inspectIconBytes(bytes)
    if (!('contentType' in inspected)) continue
    return {
      url,
      homepage,
      bytes,
      contentType: inspected.contentType,
      digest: fetcher.digest(bytes),
    }
  }
  return { failed: 'NO_USABLE_ICON' }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
