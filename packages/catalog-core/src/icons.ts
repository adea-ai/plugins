/**
 * Compile-time icon resolution.
 *
 * Marketplaces do not declare an icon field, so a plugin's mark is a file in
 * its own content (`assets/logo.svg`, `assets/icon-large.png`, ...). Resolving
 * one at compile time removes a runtime guess from consumers, and mirroring the
 * bytes at publish time removes the upstream fetch entirely.
 */

/** Why a candidate file was rejected as an icon. */
export type IconRejection =
  | 'CONTENT_TYPE_UNSUPPORTED'
  | 'EMPTY_FILE'
  | 'SIZE_LIMIT_EXCEEDED'
  | 'SVG_ACTIVE_CONTENT'
  | 'SVG_EXTERNAL_REFERENCE'

/** Content types the catalog will publish as a brand mark. */
export type IconContentType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'
  | 'image/x-icon'

/** Icon file size ceiling; a brand mark is never a large asset. */
export const MAX_ICON_BYTES = 1024 * 1024

const SUPPORTED_EXTENSIONS = ['svg', 'png', 'webp', 'jpg', 'jpeg', 'gif', 'ico'] as const

/** Ranked basenames; earlier entries win. Variants sort by the rank of the stem. */
const STEM_RANK: Readonly<Record<string, number>> = {
  icon: 0,
  appicon: 0,
  'app-icon': 0,
  avatar: 2,
  logo: 3,
  mark: 4,
  brand: 4,
}
const EXTENSION_RANK: Readonly<Record<string, number>> = {
  svg: 0,
  png: 1,
  webp: 2,
  ico: 3,
  jpg: 4,
  jpeg: 5,
  gif: 6,
}
/** Preferred containers, best first. Files outside these are considered last. */
const DIRECTORY_RANK: Readonly<Record<string, number>> = {
  assets: 0,
  '.assets': 1,
  img: 2,
  images: 3,
  media: 4,
  static: 5,
}
/** Files that are documentation, screenshots or brand collateral, not marks. */
const EXCLUDED =
  /(screenshot|screen-shot|preview|example|sample|demo|mockup|diagram|architecture|flowchart|flow-|banner|hero|cover|thumbnail|chart|graph|illustration|photo)/
/** Repository infrastructure: CI images and templates, never a product mark. */
const EXCLUDED_DIRECTORIES = ['.github', '.gitlab']

const MARK_WORDS = new Set([
  'icon',
  'appicon',
  'avatar',
  'logo',
  'mark',
  'brand',
  'logomark',
  'wordmark',
])
const VARIANT_WORDS = new Set([
  'large',
  'small',
  'light',
  'dark',
  'mono',
  'white',
  'black',
  'positive',
  'negative',
  'color',
  'colour',
  'primary',
  'secondary',
  'horizontal',
  'vertical',
  'square',
  'flat',
  'glyph',
])

/**
 * Splits a file name into mark tokens. Separators are normalised because
 * vendors write marks as `logo.svg`, `atlan-logo.png`, `Dynatrace_Logo_color_positive.png`
 * or `cs logo big.png` alike.
 */
function splitName(basename: string): { stems: string[]; marks: boolean; size: number } {
  const withoutExtension = basename.slice(0, basename.lastIndexOf('.'))
  const words = withoutExtension
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
  const size = words.some((word) => word === 'small') ? 1 : 0
  const marks = words.some((word) => MARK_WORDS.has(word))
  const stems = words.filter((word) => !MARK_WORDS.has(word) && !VARIANT_WORDS.has(word))
  return { stems, marks, size }
}

/**
 * Chooses one icon file from a release's file index, deterministically.
 *
 * Preference: `assets/icon.svg` before `assets/icon.png` before `assets/logo.*`,
 * an `icon`/`logo` stem before `avatar`/`mark`/`brand`, an `assets` directory
 * before other asset directories, SVG before raster for the same stem, and a
 * `-large` variant before `-small`. Anything that looks like documentation or a
 * screenshot is never selected. Ties break on path so the result is stable.
 */
export function selectIconPath(fileIndex: readonly string[]): string | null {
  let best: { path: string; score: readonly number[] } | null = null
  for (const raw of fileIndex) {
    const path = raw.replace(/^\.?\//, '')
    if (path.includes('..')) continue
    const segments = path.split('/')
    const basename = segments.pop() ?? ''
    const extension = basename.slice(basename.lastIndexOf('.') + 1).toLowerCase()
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extension)) continue
    if (EXCLUDED.test(basename)) continue
    const directories = segments.map((segment) => segment.toLowerCase())
    if (directories.some((segment) => EXCLUDED.test(segment))) continue
    if (directories.some((segment) => EXCLUDED_DIRECTORIES.includes(segment))) continue
    const { stems, marks, size } = splitName(basename)
    const single = stems.length === 1 ? stems[0]! : undefined
    const stemRank = marks ? (single ? (STEM_RANK[single] ?? 0) : 0) : undefined
    const nested = directories.filter((segment) => DIRECTORY_RANK[segment] !== undefined)
    // A mark named as one — `logo.svg`, `atlan-logo.png`, `cs_logo_large.png` —
    // is accepted anywhere, including the plugin root. An unnamed image must sit
    // in a known asset directory, because a bare `banner.png` at the root is as
    // likely to be documentation as a brand mark.
    const directoryRank =
      nested.length > 0
        ? (DIRECTORY_RANK[nested[nested.length - 1]!] ?? 0)
        : stemRank === undefined
          ? Number.POSITIVE_INFINITY
          : 0
    if (!Number.isFinite(directoryRank)) continue
    const score = [stemRank ?? 5, directoryRank, size, EXTENSION_RANK[extension] ?? 9, path.length]
    if (!best || compareScore(score, best.score) < 0) best = { path, score }
  }
  return best ? best.path : null
}

function compareScore(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

const SVG_ACTIVE_CONTENT =
  /<\s*script|<\s*foreignObject|<\s*iframe|<\s*use[^>]+href\s*=\s*["']?\s*(?:https?:)?\/\/|javascript:|<!ENTITY|<!DOCTYPE[^>]+\[|on(?:load|error|click|mouseover|focus|begin)\s*=/i
const SVG_EXTERNAL_REFERENCE = /(?:href|xlink:href|src|data|poster)\s*=\s*["']?\s*(?:https?:)?\/\//i

/** Sniffs a supported image type from magic bytes; SVG is detected as text. */
export function sniffContentType(bytes: Uint8Array): IconContentType | null {
  const ascii = (offset: number, length: number): string =>
    String.fromCharCode(...bytes.subarray(offset, offset + length))
  if (bytes.length >= 8 && ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png'
  if (bytes.length >= 3 && ascii(0, 3) === '\xff\xd8\xff') return 'image/jpeg'
  if (bytes.length >= 6 && ascii(0, 4) === 'GIF8') return 'image/gif'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  // Icon container: reserved(2), type 1 (icon) or 2 (cursor), count >= 1.
  if (
    bytes.length >= 6 &&
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    (bytes[2] === 1 || bytes[2] === 2) &&
    bytes[3] === 0 &&
    ((bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8)) > 0
  )
    return 'image/x-icon'
  if (bytes.length > 0) {
    // An XML prologue, a doctype and leading comments may all precede the root
    // element: exporters such as Adobe Illustrator and Figma emit them. What
    // matters is that the document's root element is `<svg>`, not `<html>`.
    const head = new TextDecoder()
      .decode(bytes.subarray(0, Math.min(bytes.length, 4096)))
      .trimStart()
      .replace(/^<\?xml[\s\S]*?\?>/i, '')
      .replace(/^<!DOCTYPE[^>]*?(?:\[[\s\S]*?\])?>/i, '')
      .replace(/^(?:\s*<!--[\s\S]*?-->)+/, '')
      .trimStart()
    if (/^<svg[\s>]/i.test(head)) return 'image/svg+xml'
  }
  return null
}

/**
 * Verifies icon bytes before they are published.
 *
 * SVG is text that a browser can execute when it is inlined, so active content
 * and external references are rejected outright. Consumers must still render a
 * mirrored SVG through an `<img>` element and never inline it into the DOM.
 */
export function inspectIconBytes(
  bytes: Uint8Array
): { contentType: IconContentType } | { rejected: IconRejection } {
  if (bytes.length === 0) return { rejected: 'EMPTY_FILE' }
  if (bytes.length > MAX_ICON_BYTES) return { rejected: 'SIZE_LIMIT_EXCEEDED' }
  const contentType = sniffContentType(bytes)
  if (!contentType) return { rejected: 'CONTENT_TYPE_UNSUPPORTED' }
  if (contentType === 'image/svg+xml') {
    const text = new TextDecoder().decode(bytes)
    if (SVG_ACTIVE_CONTENT.test(text)) return { rejected: 'SVG_ACTIVE_CONTENT' }
    if (SVG_EXTERNAL_REFERENCE.test(text)) return { rejected: 'SVG_EXTERNAL_REFERENCE' }
  }
  return { contentType }
}

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<IconContentType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
}

/**
 * Content-addressed asset name. Release assets cannot contain `/`, so the
 * digest prefix and extension form one flat name that any release can host.
 */
export function iconAssetName(digest: string, contentType: IconContentType): string {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType]
  if (!extension) throw new Error(`ICON_CONTENT_TYPE_UNSUPPORTED: ${contentType}`)
  const hex = digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest
  return `icon-${hex.slice(0, 32)}.${extension}`
}

/**
 * Curation override for a product's brand mark, keyed by product key.
 *
 * `null` publishes no mark; a path forces a file inside the plugin content; an
 * `https://` value names the vendor site to take the mark from. The override
 * exists because the selection rule is a heuristic over vendor filenames: many
 * products ship no conventional mark and declare nothing but a repository, and
 * a curator may know the real brand source.
 */
export interface ProductIconOverrides {
  readonly schemaVersion: 1
  readonly overrides: Readonly<Record<string, string | null>>
}

export function parseProductIconOverrides(input: unknown): ProductIconOverrides {
  if (typeof input !== 'object' || input === null) throw new Error('PRODUCT_ICONS_INVALID')
  const raw = input as Partial<ProductIconOverrides>
  if (raw.schemaVersion !== 1) throw new Error('PRODUCT_ICONS_INVALID')
  const overrides = raw.overrides
  if (typeof overrides !== 'object' || overrides === null) throw new Error('PRODUCT_ICONS_INVALID')
  for (const [productKey, value] of Object.entries(overrides)) {
    if (!/^[a-z0-9][a-z0-9-]{1,127}$/.test(productKey))
      throw new Error(`PRODUCT_ICONS_KEY_INVALID: ${productKey}`)
    if (value === null) continue
    if (typeof value !== 'string' || value.length === 0 || value.length > 1024)
      throw new Error(`PRODUCT_ICONS_PATH_INVALID: ${productKey}`)
    if (value.startsWith('https://')) {
      // Only the shape is checked here; site-icons applies the full host policy
      // when it resolves the mark, so a bad host simply yields no icon.
      if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(value))
        throw new Error(`PRODUCT_ICONS_SITE_UNSUPPORTED: ${productKey}`)
      continue
    }
    if (value.startsWith('/') || value.includes('..'))
      throw new Error(`PRODUCT_ICONS_PATH_INVALID: ${productKey}`)
  }
  return { schemaVersion: 1, overrides: { ...overrides } }
}

/**
 * Reads the override for a product: `forced` names a content path or `null` to
 * publish no mark, and `site` names a vendor site to take the mark from.
 */
export function iconOverrideFor(
  overrides: ProductIconOverrides | undefined,
  productKey: string
): { readonly forced?: string | null; readonly site?: string } | undefined {
  if (!overrides || !(productKey in overrides.overrides)) return undefined
  const value = overrides.overrides[productKey]
  if (value === null) return { forced: null }
  if (typeof value !== 'string') return undefined
  return value.startsWith('https://') ? { site: value } : { forced: value }
}
