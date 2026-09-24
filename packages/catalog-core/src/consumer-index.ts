import type { Catalog, Plugin, PluginRelease } from '@adea-ai/catalog-schema'
import { iconAssetName, type IconContentType } from './icons.js'

/**
 * Placement policy that decides which source variant represents a product.
 * Trusted compiler configuration; never derived from upstream plugin content.
 */
export interface ProductPreference {
  readonly schemaVersion: 1
  readonly sourcePreference: readonly string[]
  readonly canonicalOverrides?: Readonly<Record<string, string>>
}

/**
 * Source order used when no variant is published by the product's own vendor.
 * The Claude Code marketplace leads because it carries the largest catalog;
 * the knowledge-work marketplace re-publishes many of the same products.
 */
export const DEFAULT_SOURCE_PREFERENCE: readonly string[] = [
  'claude-official',
  'cursor-official',
  'openai-official',
  'knowledge-work-official',
]

export const DEFAULT_TOP_COUNT = 6

export function parseProductPreference(input: unknown): ProductPreference {
  if (typeof input !== 'object' || input === null) throw new Error('PRODUCT_PREFERENCE_INVALID')
  const raw = input as Partial<ProductPreference>
  if (raw.schemaVersion !== 1) throw new Error('PRODUCT_PREFERENCE_INVALID')
  if (
    !Array.isArray(raw.sourcePreference) ||
    raw.sourcePreference.length === 0 ||
    raw.sourcePreference.some((value) => typeof value !== 'string' || value.length === 0)
  )
    throw new Error('PRODUCT_PREFERENCE_INVALID')
  if (new Set(raw.sourcePreference).size !== raw.sourcePreference.length)
    throw new Error('PRODUCT_PREFERENCE_DUPLICATE_SOURCE')
  const overrides = raw.canonicalOverrides
  if (overrides !== undefined) {
    if (typeof overrides !== 'object' || overrides === null)
      throw new Error('PRODUCT_PREFERENCE_INVALID')
    for (const [productKey, pluginId] of Object.entries(overrides))
      if (typeof pluginId !== 'string' || !pluginId.startsWith('plugin:'))
        throw new Error(`PRODUCT_PREFERENCE_OVERRIDE_INVALID: ${productKey}`)
  }
  return {
    schemaVersion: 1,
    sourcePreference: [...raw.sourcePreference],
    ...(overrides ? { canonicalOverrides: { ...overrides } } : {}),
  }
}

/**
 * A brand mark resolved at compile time and mirrored into the catalog release,
 * so a client renders it without a second lookup or an upstream fetch.
 */
export interface ProductIcon {
  /** `content` is the vendor's own plugin file; `favicon` is the product site's. */
  readonly kind: 'content' | 'favicon'
  /** Release asset name; fetch it from the release for this `catalogId`. */
  readonly asset: string
  readonly digest: string
  readonly contentType: IconContentType
  readonly bytes: number
  /** Plugin-relative path the mark came from, for `content`. */
  readonly path: string | null
  /** Site icon URL, for `favicon`. */
  readonly url: string | null
  readonly homepage: string | null
}

/**
 * Deterministic rendering hint for a product without a brand mark: initials and
 * a stable hue. Clients draw it locally, which keeps it crisp, themable and
 * free of a network request.
 */
export interface ProductMonogram {
  readonly text: string
  readonly hue: number
}

/** One installable product, resolved from every source variant that publishes it. */ /** One installable product, resolved from every source variant that publishes it. */
export interface ConsumerProduct {
  readonly productKey: string
  readonly pluginId: string
  readonly variantPluginIds: readonly string[]
  readonly variantsIdentical: boolean
  readonly displayName: string
  readonly upstreamName: string
  readonly description: string
  readonly sourceId: string
  readonly categories: readonly string[]
  readonly primaryCategory: string
  readonly license: string
  readonly homepage?: string
  readonly capabilitySummary: Readonly<Record<string, number>>
  readonly compatibility: Readonly<Record<string, string>>
  readonly releaseId: string
  readonly keywords: readonly string[]
  readonly icon: ProductIcon | null
  readonly monogram: ProductMonogram
}

export interface ConsumerCategory {
  readonly category: string
  readonly productCount: number
  readonly pluginCount: number
  readonly pluginIds: readonly string[]
  readonly productKeys: readonly string[]
  readonly topProductKeys: readonly string[]
  /** Artifact that carries full records for `topProductKeys`. */
  readonly shelfArtifact: string
  /** Artifact that carries full records for every product in the category. */
  readonly listArtifact: string
}

/** A curated name that no longer resolves to a product in its category. */
export interface LeadingDiagnostic {
  readonly category: string
  readonly name: string
  readonly reason: 'UNKNOWN_CATEGORY' | 'PRODUCT_NOT_FOUND' | 'PRODUCT_NOT_IN_CATEGORY'
}

/** Brand-mark coverage, so an incomplete set is visible rather than implied. */
export interface IconCoverage {
  readonly total: number
  readonly content: number
  readonly favicon: number
  readonly monogramOnly: number
  /** Products still rendering a monogram, in display order: the curation list. */
  readonly monogramProductKeys: readonly string[]
}

export function iconCoverage(index: Pick<ConsumerIndex, 'products'>): IconCoverage {
  const products = Object.values(index.products)
  const monogramOnly = products
    .filter((product) => !product.icon)
    .map((product) => product.productKey)
    .toSorted()
  return {
    total: products.length,
    content: products.filter((product) => product.icon?.kind === 'content').length,
    favicon: products.filter((product) => product.icon?.kind === 'favicon').length,
    monogramOnly: monogramOnly.length,
    monogramProductKeys: monogramOnly,
  }
}

export interface ConsumerIndex {
  readonly topCount: number
  readonly sourcePreference: readonly string[]
  readonly counts: {
    readonly plugins: number
    readonly products: number
    readonly redundantPlugins: number
  }
  readonly products: Readonly<Record<string, ConsumerProduct>>
  readonly categories: readonly ConsumerCategory[]
  readonly diagnostics: readonly LeadingDiagnostic[]
  /** Present on the navigation artifact; summarised from `products`. */
  readonly iconCoverage?: IconCoverage
}

function isHumanFormatted(value: string): boolean {
  return /[A-Z]/.test(value) || /\s/.test(value)
}

/**
 * Prefers content published by the product's own vendor over a marketplace's
 * own wrapper package, then applies the configured source order.
 */
function selectCanonical(
  variants: readonly Plugin[],
  sourceRepository: ReadonlyMap<string, string>,
  preference: ProductPreference
): Plugin {
  const override = preference.canonicalOverrides?.[variants[0]?.productGroupingKey ?? '']
  const overridden = override ? variants.find((plugin) => plugin.pluginId === override) : undefined
  if (overridden) return overridden
  const rank = (plugin: Plugin): number => {
    const index = preference.sourcePreference.indexOf(plugin.sourceId)
    return index === -1 ? preference.sourcePreference.length : index
  }
  // A variant with no resolved release repository proves nothing about its
  // origin, so it is treated as marketplace-shipped rather than vendor-published.
  const vendorPublished = (plugin: Plugin): boolean => {
    const repository = plugin.availableReleases[0]?.resolvedRepositoryUrl
    return repository !== undefined && repository !== sourceRepository.get(plugin.sourceId)
  }
  return [...variants].toSorted(
    (left, right) =>
      Number(vendorPublished(right)) - Number(vendorPublished(left)) ||
      rank(left) - rank(right) ||
      Number(isHumanFormatted(right.displayName)) - Number(isHumanFormatted(left.displayName)) ||
      left.pluginId.localeCompare(right.pluginId)
  )[0]!
}

/** Picks the most presentable label among a product's variants. */
function selectDisplayName(variants: readonly Plugin[], canonical: Plugin): string {
  const formatted = variants
    .map((plugin) => plugin.displayName)
    .filter((value) => isHumanFormatted(value) && value !== '')
    .toSorted()
  return formatted[0] ?? canonical.displayName
}

export const SHELF_ARTIFACT_PREFIX = 'shelf-'
export const CATEGORY_ARTIFACT_PREFIX = 'category-'
export const CATALOG_INDEX_ARTIFACT = 'catalog-index.v1.json'

/** Shard artifact names are derived from the category so they stay stable. */
export function shardArtifactNames(category: string): {
  shelf: string
  list: string
} {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(category))
    throw new Error(`CATEGORY_SLUG_INVALID: ${category}`)
  return {
    shelf: `${SHELF_ARTIFACT_PREFIX}${category}.v1.json`,
    list: `${CATEGORY_ARTIFACT_PREFIX}${category}.v1.json`,
  }
}

/** The release a product's install target pins, when it is still resolvable. */
function currentRelease(plugin: Plugin): PluginRelease | undefined {
  return (
    plugin.availableReleases.find((release) => release.releaseId === plugin.currentReleaseId) ??
    plugin.availableReleases[0]
  )
}

/** Prefers the canonical variant's mark, then any variant that has one. */
function selectProductIcon(variants: readonly Plugin[], canonical: Plugin): ProductIcon | null {
  const ordered = [canonical, ...variants.filter((plugin) => plugin !== canonical)]
  for (const plugin of ordered) {
    const icon = currentRelease(plugin)?.icon
    if (!icon) continue
    return {
      kind: icon.kind,
      asset: iconAssetName(icon.digest, icon.contentType),
      digest: icon.digest,
      contentType: icon.contentType,
      bytes: icon.bytes,
      path: icon.kind === 'content' ? icon.path : null,
      url: icon.kind === 'favicon' ? icon.url : null,
      homepage: icon.kind === 'favicon' ? icon.homepage : null,
    }
  }
  return null
}

const MONOGRAM_HUE_OFFSETS = [0, 137, 274] as const

/**
 * Initials and a hue derived from the product key, so a product without a mark
 * still renders a stable tile instead of a blank one.
 */
export function monogramFor(displayName: string, productKey: string): ProductMonogram {
  const words = displayName.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const first = words[0] ?? productKey
  const second = words[1]
  const text = (
    words.length > 1 && second ? (first[0] ?? '') + (second[0] ?? '') : first.slice(0, 2)
  ).toUpperCase()
  let hash = 0
  for (const character of productKey) hash = (hash * 31 + character.codePointAt(0)!) % 360
  // Keep adjacent hues off each other so side-by-side tiles stay distinct.
  return { text: text || '?', hue: (hash + MONOGRAM_HUE_OFFSETS[hash % 3]!) % 360 }
}

function compactCompatibility(plugin: Plugin): Record<string, string> {
  return Object.fromEntries(
    Object.entries(plugin.harnessCompatibility).map(([harness, value]) => [harness, value.status])
  )
}

/**
 * Builds the deduplicated, pre-sorted consumer view of a catalog.
 *
 * Each product appears once, represented by its canonical variant, and each
 * category carries a display order plus the curated shelf of top products.
 * Nothing here is random: every order is either configured or derived from
 * stable identifiers.
 */
export function buildConsumerIndex(input: {
  readonly catalog: Pick<Catalog, 'plugins' | 'sources'>
  readonly leading?: Readonly<Record<string, readonly string[]>>
  readonly topCount?: number
  readonly preference?: ProductPreference
}): ConsumerIndex {
  const preference = input.preference ?? {
    schemaVersion: 1 as const,
    sourcePreference: [...DEFAULT_SOURCE_PREFERENCE],
  }
  const leading = input.leading ?? {}
  const topCount = input.topCount ?? DEFAULT_TOP_COUNT
  const sourceRepository = new Map(
    input.catalog.sources.map((source) => [source.sourceId, source.repositoryUrl])
  )
  const variantsByProduct = new Map<string, Plugin[]>()
  for (const plugin of input.catalog.plugins) {
    const list = variantsByProduct.get(plugin.productGroupingKey)
    if (list) list.push(plugin)
    else variantsByProduct.set(plugin.productGroupingKey, [plugin])
  }
  const products: Record<string, ConsumerProduct> = {}
  for (const [productKey, variants] of [...variantsByProduct].toSorted((left, right) =>
    left[0].localeCompare(right[0])
  )) {
    const canonical = selectCanonical(variants, sourceRepository, preference)
    const variantPluginIds = variants
      .map((plugin) => plugin.pluginId)
      .toSorted((left, right) =>
        left === canonical.pluginId
          ? -1
          : right === canonical.pluginId
            ? 1
            : left.localeCompare(right)
      )
    const releaseIds = new Set(variants.map((plugin) => plugin.currentReleaseId))
    const productCategories = [
      ...new Set(variants.flatMap((plugin) => plugin.categories)),
    ].toSorted()
    products[productKey] = {
      productKey,
      pluginId: canonical.pluginId,
      variantPluginIds,
      variantsIdentical: releaseIds.size === 1 && variants.length > 1,
      displayName: selectDisplayName(variants, canonical),
      upstreamName: canonical.upstreamPluginName,
      description:
        canonical.description || (variants.find((v) => v.description)?.description ?? ''),
      sourceId: canonical.sourceId,
      // A product's categories are the union across its variants: sources
      // disagree (one marketplace files Slack under productivity, another under
      // communication), and a product belongs wherever any variant is filed.
      categories: productCategories,
      primaryCategory: productCategories[0] ?? 'other',
      license: canonical.license.name,
      ...(canonical.homepage ? { homepage: canonical.homepage } : {}),
      capabilitySummary: { ...canonical.capabilitySummary },
      compatibility: compactCompatibility(canonical),
      releaseId: canonical.currentReleaseId,
      keywords: [...canonical.keywords],
      icon: selectProductIcon(variants, canonical),
      monogram: monogramFor(selectDisplayName(variants, canonical), productKey),
    }
  }

  const categoryNames = [
    ...new Set(input.catalog.plugins.flatMap((plugin) => plugin.categories)),
  ].toSorted()
  const diagnostics: LeadingDiagnostic[] = []
  // Resolve every curated name first, so a category's shelf can never lose a
  // curated product to another category that merely reached it by fill order.
  const curatedByCategory = new Map<string, string[]>()
  for (const category of categoryNames) {
    const members = input.catalog.plugins.filter((plugin) => plugin.categories.includes(category))
    const curated: string[] = []
    for (const name of leading[category] ?? []) {
      const matches = members.filter((plugin) => plugin.upstreamPluginName === name)
      if (matches.length === 0) {
        diagnostics.push({
          category,
          name,
          reason: variantsByProduct.has(name) ? 'PRODUCT_NOT_IN_CATEGORY' : 'PRODUCT_NOT_FOUND',
        })
        continue
      }
      const key = matches[0]!.productGroupingKey
      if (!curated.includes(key)) curated.push(key)
    }
    curatedByCategory.set(category, curated)
  }
  // A shelf product headlined once, assigned to the first category that curates
  // it. Every curated product is reserved up front, so a later category's fill
  // can never take it before its owner is processed.
  const curatedOwner = new Map<string, string>()
  for (const category of categoryNames)
    for (const productKey of curatedByCategory.get(category)!)
      if (!curatedOwner.has(productKey)) curatedOwner.set(productKey, category)
  const filled = new Set<string>()
  const categories: ConsumerCategory[] = categoryNames.map((category) => {
    const members = input.catalog.plugins.filter((plugin) => plugin.categories.includes(category))
    const curated = curatedByCategory.get(category)!
    const curatedRank = new Map(curated.map((key, index) => [key, index]))
    const productKeys = [...new Set(members.map((plugin) => plugin.productGroupingKey))].toSorted(
      (left, right) =>
        (curatedRank.get(left) ?? Number.POSITIVE_INFINITY) -
          (curatedRank.get(right) ?? Number.POSITIVE_INFINITY) || left.localeCompare(right)
    )
    const memberIds = new Set(members.map((plugin) => plugin.pluginId))
    // Curated first in configured order, canonical variant ahead of its own
    // variants, then alphabetical for a predictable browsing tail.
    const orderedIds: string[] = []
    for (const productKey of productKeys) {
      const product = products[productKey]!
      for (const pluginId of product.variantPluginIds)
        if (memberIds.has(pluginId)) orderedIds.push(pluginId)
    }
    // Curated products this category owns, then deterministic fill so a shelf
    // stays full without repeating a product another category already shows.
    const topProductKeys: string[] = []
    for (const productKey of productKeys) {
      if (topProductKeys.length === topCount) break
      if (curatedOwner.get(productKey) !== category) continue
      topProductKeys.push(productKey)
    }
    for (const productKey of productKeys) {
      if (topProductKeys.length === topCount) break
      if (curatedOwner.has(productKey) || filled.has(productKey)) continue
      topProductKeys.push(productKey)
      filled.add(productKey)
    }
    return {
      category,
      productCount: productKeys.length,
      pluginCount: members.length,
      pluginIds: orderedIds,
      productKeys,
      topProductKeys,
      shelfArtifact: shardArtifactNames(category).shelf,
      listArtifact: shardArtifactNames(category).list,
    }
  })
  for (const category of Object.keys(leading))
    if (!categoryNames.includes(category))
      for (const name of leading[category]!)
        diagnostics.push({ category, name, reason: 'UNKNOWN_CATEGORY' })
  return {
    topCount,
    sourcePreference: [...preference.sourcePreference],
    counts: {
      plugins: input.catalog.plugins.length,
      products: Object.keys(products).length,
      redundantPlugins: input.catalog.plugins.length - Object.keys(products).length,
    },
    products,
    categories,
    diagnostics: diagnostics.toSorted(
      (left, right) =>
        left.category.localeCompare(right.category) || left.name.localeCompare(right.name)
    ),
  }
}
