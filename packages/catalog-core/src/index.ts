import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import {
  CatalogSchema,
  type Catalog,
  type CatalogSource,
  type Capability,
  type Harness,
  type HarnessCompatibility,
  type LicenseMetadata,
  type Plugin,
  type PluginRelease,
  type SecurityClassification,
  type SourceLockEntry,
  type SourcesLock,
  type PluginProvenance,
  HarnessSchema,
  SourcesLockSchema,
  PluginSchema,
} from '@adea-ai/catalog-schema'
import {
  canonicalRepositoryUrl,
  parseJsonDocument,
  parseMarketplaceManifest,
  safeRelativePath,
  type MarketplacePluginEntry,
  type ParsedMarketplace,
  type PluginSourceSpec,
  type SourceConfig,
} from '@adea-ai/source-adapters'

export interface CatalogPolicy {
  readonly allowedRepositoryProtocols: readonly string[]
  readonly allowedRepositoryHosts: readonly string[]
  readonly maxFilesPerPlugin: number
  readonly maxBytesPerPlugin: number
  readonly maxFileBytes: number
  readonly maxMarketplacePlugins: number
  readonly denyExecutableLifecycleScripts: boolean
  readonly publishRequiresCompleteContent: boolean
  readonly sensitiveCapabilityTypes: readonly string[]
}

export interface CategoryMap {
  readonly aliases: Readonly<Record<string, string>>
  readonly fallback: string
}

export interface ProductAliases {
  readonly aliases: Readonly<Record<string, string>>
}

export interface Snapshot {
  readonly files: ReadonlyMap<string, Uint8Array>
  readonly symlinks: readonly string[]
}

/** Trusted compiler extension; never loaded from upstream plugin content. */
export type ReleaseTransform = (
  release: PluginRelease,
  snapshot: Snapshot,
  pluginName: string
) => PluginRelease

export interface SnapshotLoader {
  load(repositoryUrl: string, commitSha: string, pluginSubdirectory: string): Promise<Snapshot>
}

export interface ResolvedSource {
  readonly config: SourceConfig
  readonly commitSha: string
  readonly manifestText: string
  readonly parsed: ParsedMarketplace
  readonly pluginPins: readonly PluginSourcePin[]
  readonly retrievedAt: string
  readonly manifestDigest: string
}

export interface PluginSourcePin {
  readonly pluginName: string
  readonly repositoryUrl: string
  readonly pluginSubdirectory: string
  readonly resolvedCommitSha: string
}

export interface SyncInput {
  readonly sources: readonly SourceConfig[]
  readonly categoryMap: CategoryMap
  readonly productAliases: ProductAliases
  readonly productCategories?: Record<string, string>
  readonly leading?: Record<string, readonly string[]>
  readonly policy: CatalogPolicy
  readonly mode?: 'live' | 'offline'
  readonly fixtureRoot?: string
  readonly sourceId?: string
  readonly metadataOnly?: boolean
  readonly dryRun?: boolean
  readonly existingLock?: SourcesLock
  readonly existingCatalog?: Catalog
  readonly fromLock?: SourcesLock
  readonly snapshotLoader?: SnapshotLoader
  readonly resolveExternalRefs?: boolean
  /** Rebuild even when source pins are unchanged (used for explicit format migrations). */
  readonly forceRebuild?: boolean
  readonly transformRelease?: ReleaseTransform
}

export interface SyncResult {
  readonly changed: boolean
  readonly dryRun: boolean
  readonly sourceHeads: readonly { sourceId: string; commitSha: string }[]
  readonly catalog?: Catalog
  readonly lock?: SourcesLock
  readonly artifacts?: GeneratedArtifacts
  readonly changeReport: ChangeReport
}

export interface ChangeReport {
  readonly schemaVersion: 1
  readonly changedSources: readonly string[]
  readonly addedPlugins: readonly string[]
  readonly removedPlugins: readonly string[]
  readonly changedPlugins: readonly string[]
  readonly permissionSensitiveChanges: readonly string[]
  readonly skippedPlugins: readonly SkippedPlugin[]
  readonly contentResolution: 'complete' | 'complete-with-skips' | 'metadata-only'
}

export type PluginSkipReasonCode =
  | 'GIT_SUBMODULE_UNSUPPORTED'
  | 'PLUGIN_FILE_TOO_LARGE'
  | 'PLUGIN_FILE_UNAVAILABLE'
  | 'PLUGIN_MANIFEST_INVALID'
  | 'PLUGIN_PATH_NOT_FOUND'
  | 'PLUGIN_SCHEMA_INVALID'
  | 'PLUGIN_SIZE_POLICY'
  | 'PLUGIN_SOURCE_UNAVAILABLE'
  | 'PLUGIN_TOO_LARGE'
  | 'PLUGIN_TOO_MANY_FILES'
  | 'SNAPSHOT_PATH_INVALID'
  | 'SYMLINK_ESCAPE'

export interface SkippedPlugin {
  readonly sourceId: string
  readonly pluginId: string
  readonly pluginName: string
  readonly reasonCode: PluginSkipReasonCode
  readonly securityReason: string
  readonly incompleteContent: true
  readonly paths: readonly string[]
}

export interface GeneratedArtifacts {
  readonly 'catalog.v1.json': string
  readonly 'catalog-summary.v1.json': string
  readonly 'sources.lock.json': string
  readonly 'compatibility.v1.json': string
  readonly 'categories.v1.json': string
  readonly 'integrity.json': string
}

const DEFAULT_POLICY: CatalogPolicy = {
  allowedRepositoryProtocols: ['https:'],
  allowedRepositoryHosts: ['github.com', 'www.github.com'],
  maxFilesPerPlugin: 4096,
  maxBytesPerPlugin: 50 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxMarketplacePlugins: 4096,
  denyExecutableLifecycleScripts: true,
  publishRequiresCompleteContent: false,
  sensitiveCapabilityTypes: [
    'mcp-server',
    'connector',
    'hook',
    'browser',
    'scheduled-task',
    'executable',
  ],
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}

export function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

export function bytesDigest(files: ReadonlyMap<string, Uint8Array>): string {
  const hash = createHash('sha256')
  for (const [path, bytes] of [...files.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    hash.update(`${path.length}:${path}:${bytes.byteLength}:`)
    hash.update(bytes)
  }
  return `sha256:${hash.digest('hex')}`
}

export function stablePluginId(sourceId: string, upstreamName: string): string {
  return `plugin:${slug(sourceId)}:${slug(upstreamName)}`
}

export function stableReleaseId(
  repositoryUrl: string,
  subdirectory: string,
  commitSha: string,
  contentDigest: string
): string {
  return `release:${digest({ repositoryUrl, subdirectory, commitSha, contentDigest }).slice('sha256:'.length)}`
}

export function normalizeCategory(value: string, map: CategoryMap): string {
  const key = value.trim().toLocaleLowerCase()
  return map.aliases[key] ?? (slug(key) || map.fallback)
}

export function productGroupingKey(name: string, aliases: ProductAliases): string {
  const key = name.trim().toLocaleLowerCase()
  return aliases.aliases[key] ?? slug(key)
}

export async function synchronize(input: SyncInput): Promise<SyncResult> {
  const mode = input.mode ?? 'live'
  const configs = input.sources.filter(
    (source) => !input.sourceId || source.sourceId === input.sourceId
  )
  if (configs.length === 0) throw new Error(`SOURCE_NOT_FOUND: ${input.sourceId ?? 'none'}`)
  const lockToUse = input.fromLock ?? input.existingLock
  const resolved = await mapWithConcurrency(configs, 4, (config) =>
    resolveSource(config, mode, input.fixtureRoot, lockToUse, input.fromLock !== undefined)
  )
  const sourceHeads = resolved.map(({ config, commitSha }) => ({
    sourceId: config.sourceId,
    commitSha,
  }))
  const unchanged =
    input.fromLock === undefined &&
    input.forceRebuild !== true &&
    input.existingLock !== undefined &&
    resolved.length === input.existingLock.sources.length &&
    resolved.every((source) => {
      const previous = input.existingLock?.sources.find(
        (entry) => entry.sourceId === source.config.sourceId
      )
      if (!previous) return false
      return (
        previous.resolvedCommitSha === source.commitSha &&
        previous.sourceManifestDigest === source.manifestDigest &&
        digest(previous.pluginPins) === digest(source.pluginPins)
      )
    })
  if (unchanged) {
    return {
      changed: false,
      dryRun: input.dryRun ?? false,
      sourceHeads,
      changeReport: {
        schemaVersion: 1,
        changedSources: [],
        addedPlugins: [],
        removedPlugins: [],
        changedPlugins: [],
        permissionSensitiveChanges: [],
        skippedPlugins: [],
        contentResolution: input.metadataOnly ? 'metadata-only' : 'complete',
      },
    }
  }

  const buildResult = await buildCatalogInternal({
    resolvedSources: resolved,
    categoryMap: input.categoryMap,
    ...(input.productCategories ? { productCategories: input.productCategories } : {}),
    ...(input.leading ? { leading: input.leading } : {}),
    productAliases: input.productAliases,
    policy: input.policy,
    metadataOnly: input.metadataOnly ?? false,
    snapshotLoader:
      input.snapshotLoader ??
      (mode === 'offline'
        ? new FixtureSnapshotLoader(input.fixtureRoot ?? 'fixtures', configs)
        : new NetworkSnapshotLoader(input.policy)),
    resolveExternalRefs: mode === 'live',
    ...(input.transformRelease ? { transformRelease: input.transformRelease } : {}),
  })
  const catalog = buildResult.catalog
  const lock = createSourcesLock(resolved)
  const artifacts = createArtifacts(orderLeadingPlugins(catalog, input.leading), lock)
  verifyArtifacts(artifacts)
  const report = createChangeReport(
    catalog,
    lock,
    input.existingLock,
    input.existingCatalog,
    buildResult.skippedPlugins
  )
  if (input.policy.publishRequiresCompleteContent && input.metadataOnly) {
    throw new Error('CATALOG_CONTENT_INCOMPLETE: publication requires complete content')
  }
  return {
    changed: true,
    dryRun: input.dryRun ?? false,
    sourceHeads,
    catalog,
    lock,
    artifacts,
    changeReport: report,
  }
}

export async function buildCatalog(input: {
  readonly resolvedSources: readonly ResolvedSource[]
  readonly categoryMap: CategoryMap
  readonly productAliases: ProductAliases
  readonly productCategories?: Record<string, string>
  readonly leading?: Record<string, readonly string[]>
  readonly policy?: CatalogPolicy
  readonly metadataOnly?: boolean
  readonly snapshotLoader: SnapshotLoader
  readonly resolveExternalRefs?: boolean
  readonly transformRelease?: ReleaseTransform
}): Promise<Catalog> {
  return (
    await buildCatalogInternal({
      resolvedSources: input.resolvedSources,
      categoryMap: input.categoryMap,
      productAliases: input.productAliases,
      policy: input.policy ?? DEFAULT_POLICY,
      metadataOnly: input.metadataOnly ?? false,
      snapshotLoader: input.snapshotLoader,
      resolveExternalRefs: input.resolveExternalRefs ?? false,
      ...(input.transformRelease ? { transformRelease: input.transformRelease } : {}),
      ...(input.productCategories ? { productCategories: input.productCategories } : {}),
      ...(input.leading ? { leading: input.leading } : {}),
    })
  ).catalog
}

interface BuildCatalogInput {
  readonly resolvedSources: readonly ResolvedSource[]
  readonly categoryMap: CategoryMap
  readonly productAliases: ProductAliases
  readonly productCategories?: Record<string, string>
  readonly leading?: Record<string, readonly string[]>
  readonly policy?: CatalogPolicy
  readonly metadataOnly?: boolean
  readonly snapshotLoader: SnapshotLoader
  readonly resolveExternalRefs?: boolean
  readonly transformRelease?: ReleaseTransform
}

interface BuildCatalogResult {
  readonly catalog: Catalog
  readonly skippedPlugins: readonly SkippedPlugin[]
}

async function buildCatalogInternal(input: BuildCatalogInput): Promise<BuildCatalogResult> {
  const policy = input.policy ?? DEFAULT_POLICY
  for (const source of input.resolvedSources) {
    assertRepositoryAllowed(source.config.repositoryUrl, policy)
    for (const entry of source.parsed.entries) {
      if (entry.source.kind === 'git') assertRepositoryAllowed(entry.source.repositoryUrl, policy)
    }
  }
  const sourceRecords: CatalogSource[] = input.resolvedSources
    .map(({ config, commitSha, retrievedAt, manifestDigest }) => ({
      sourceId: config.sourceId,
      displayName: config.displayName,
      repositoryUrl: canonicalRepositoryUrl(config.repositoryUrl),
      marketplaceDialect: config.marketplaceDialect,
      manifestPath: config.manifestPath,
      defaultBranch: config.defaultBranch,
      resolvedCommitSha: commitSha,
      retrievalTimestamp: retrievedAt,
      trustClassification: config.trustClassification,
      sourceManifestDigest: manifestDigest,
      synchronizationStatus: 'synchronized' as const,
    }))
    .toSorted((left, right) => left.sourceId.localeCompare(right.sourceId))
  let plugins: Plugin[] = []
  let skippedPlugins: SkippedPlugin[] = []
  for (const source of input.resolvedSources) {
    if (source.parsed.entries.length > policy.maxMarketplacePlugins)
      throw new Error('MARKETPLACE_TOO_MANY_PLUGINS')
    const normalized = await mapWithConcurrency(source.parsed.entries, 8, async (entry) => {
      try {
        const plugin = await normalizePlugin({
          source,
          entry,
          categoryMap: input.categoryMap,
          ...(input.productCategories ? { productCategories: input.productCategories } : {}),
          productAliases: input.productAliases,
          policy,
          metadataOnly: input.metadataOnly ?? false,
          snapshotLoader: input.snapshotLoader,
          resolveExternalRefs: input.resolveExternalRefs ?? true,
          ...(input.transformRelease ? { transformRelease: input.transformRelease } : {}),
        })
        try {
          return { plugin: PluginSchema.parse(plugin) }
        } catch {
          throw new PluginSafetyError('PLUGIN_SCHEMA_INVALID', [])
        }
      } catch (error) {
        const skipped = createSkippedPlugin(source, entry, error)
        if (!skipped) throw error
        return { skipped }
      }
    })
    const sourcePlugins: Plugin[] = []
    const sourceSkipped: SkippedPlugin[] = []
    for (const result of normalized) {
      if (result.plugin) sourcePlugins.push(result.plugin)
      if (result.skipped) sourceSkipped.push(result.skipped)
    }
    const weatherSkips = sourceSkipped.filter((skipped) =>
      UPSTREAM_WEATHER_SKIP_CODES.has(skipped.reasonCode)
    )
    if (source.parsed.entries.length > 0 && weatherSkips.length === source.parsed.entries.length)
      throw new PluginSafetyError('PLUGIN_SOURCE_UNAVAILABLE', [
        canonicalRepositoryUrl(source.config.repositoryUrl),
      ])
    for (const plugin of sourcePlugins) plugins.push(plugin)
    for (const skipped of sourceSkipped) skippedPlugins.push(skipped)
  }
  plugins = plugins.toSorted((left, right) => left.pluginId.localeCompare(right.pluginId))
  skippedPlugins = skippedPlugins.toSorted(
    (left, right) =>
      left.pluginId.localeCompare(right.pluginId) ||
      left.reasonCode.localeCompare(right.reasonCode) ||
      left.paths.join('\0').localeCompare(right.paths.join('\0'))
  )
  const body = {
    schemaVersion: 1 as const,
    generatedAt:
      sourceRecords
        .map((s) => s.retrievalTimestamp)
        .toSorted()
        .at(-1) ?? new Date(0).toISOString(),
    sources: sourceRecords,
    plugins,
  }
  return {
    catalog: CatalogSchema.parse({
      ...body,
      catalogId: `catalog:${digest(body).slice('sha256:'.length)}`,
    }),
    skippedPlugins,
  }
}

class PluginSafetyError extends Error {
  constructor(
    readonly reasonCode: PluginSkipReasonCode,
    readonly paths: readonly string[]
  ) {
    super(`${reasonCode}${paths.length > 0 ? `: ${paths.join(',')}` : ''}`)
    this.name = 'PluginSafetyError'
  }
}

const pluginSkipReasons: Readonly<Record<PluginSkipReasonCode, string>> = {
  GIT_SUBMODULE_UNSUPPORTED:
    'The plugin contains a Git submodule, so the catalog excludes it rather than traversing an unpinned repository boundary.',
  PLUGIN_FILE_TOO_LARGE:
    'The plugin contains a file over the configured size limit, so the catalog excludes the plugin before publication.',
  PLUGIN_FILE_UNAVAILABLE:
    'A plugin file could not be fetched from upstream after retries, so the catalog excludes the plugin rather than publishing partial content.',
  PLUGIN_MANIFEST_INVALID:
    'The plugin manifest is malformed, so the catalog excludes the plugin before consuming its metadata.',
  PLUGIN_PATH_NOT_FOUND:
    'The declared plugin path does not exist at the pinned commit, so the catalog excludes the plugin.',
  PLUGIN_SCHEMA_INVALID:
    'The normalized plugin record exceeds the published catalog schema, so the catalog excludes it before publication.',
  PLUGIN_SIZE_POLICY:
    'The plugin exceeds the configured size policy, so the catalog excludes it before publication.',
  PLUGIN_SOURCE_UNAVAILABLE:
    'The plugin repository tree could not be fetched from upstream after retries, so the catalog excludes the plugin rather than publishing partial content.',
  PLUGIN_TOO_LARGE:
    'The plugin exceeds the configured aggregate size limit, so the catalog excludes it before publication.',
  PLUGIN_TOO_MANY_FILES:
    'The plugin exceeds the configured file-count limit, so the catalog excludes it before publication.',
  SNAPSHOT_PATH_INVALID:
    'The plugin snapshot contains an unsafe path, so the catalog excludes it rather than allowing repository escape.',
  SYMLINK_ESCAPE:
    'The plugin snapshot contains symlinks; symlinks are never followed, so the catalog excludes the plugin.',
}

function createSkippedPlugin(
  source: ResolvedSource,
  entry: MarketplacePluginEntry,
  error: unknown
): SkippedPlugin | undefined {
  const parsed =
    error instanceof PluginSafetyError
      ? { reasonCode: error.reasonCode, paths: error.paths }
      : parsePluginSafetyError(error)
  if (!parsed) return undefined
  return {
    sourceId: source.config.sourceId,
    pluginId: stablePluginId(source.config.sourceId, entry.name),
    pluginName: entry.name,
    reasonCode: parsed.reasonCode,
    securityReason: pluginSkipReasons[parsed.reasonCode],
    incompleteContent: true,
    paths: [...new Set(parsed.paths)].toSorted(),
  }
}

function parsePluginSafetyError(
  error: unknown
): { reasonCode: PluginSkipReasonCode; paths: readonly string[] } | undefined {
  const message = error instanceof Error ? error.message : String(error)
  const match = /^([A-Z_]+)(?::\s?(.*))?$/.exec(message)
  if (!match) return undefined
  const reasonCode = match[1] as PluginSkipReasonCode
  if (!(reasonCode in pluginSkipReasons)) return undefined
  return {
    reasonCode,
    paths: match[2]
      ? match[2]
          .split(',')
          .map((path) => path.trim())
          .filter(Boolean)
      : [],
  }
}

async function normalizePlugin(input: {
  readonly source: ResolvedSource
  readonly entry: MarketplacePluginEntry
  readonly categoryMap: CategoryMap
  readonly productCategories?: Record<string, string>
  readonly productAliases: ProductAliases
  readonly policy: CatalogPolicy
  readonly metadataOnly: boolean
  readonly snapshotLoader: SnapshotLoader
  readonly resolveExternalRefs: boolean
  readonly transformRelease?: ReleaseTransform
}): Promise<Plugin> {
  const { source, entry, policy } = input
  const resolved = await resolvePluginSource(
    entry.name,
    entry.source,
    source,
    input.resolveExternalRefs
  )
  const snapshot = input.metadataOnly
    ? { files: new Map<string, Uint8Array>(), symlinks: [] }
    : await input.snapshotLoader.load(
        resolved.repositoryUrl,
        resolved.commitSha,
        resolved.subdirectory
      )
  if (snapshot.symlinks.length > 0)
    throw new PluginSafetyError('SYMLINK_ESCAPE', [...snapshot.symlinks].toSorted())
  validateSnapshot(snapshot, policy, entry.name)
  const contentDigest = input.metadataOnly
    ? digest({
        repositoryUrl: resolved.repositoryUrl,
        subdirectory: resolved.subdirectory,
        commitSha: resolved.commitSha,
        entryDigest: entry.entryDigest,
      })
    : bytesDigest(snapshot.files)
  const pluginManifest = findPluginManifest(snapshot, input.transformRelease !== undefined)
  const manifestDigest = pluginManifest ? digest(pluginManifest.metadata) : entry.entryDigest
  const capabilities = classifyCapabilities(snapshot.files, pluginManifest?.metadata)
  const releaseId = stableReleaseId(
    resolved.repositoryUrl,
    resolved.subdirectory,
    resolved.commitSha,
    contentDigest
  )
  const originalRelease = createRelease({
    source,
    entry,
    resolved,
    contentDigest,
    manifestDigest,
    capabilities,
    snapshot,
    ...(pluginManifest ? { pluginManifest } : {}),
    releaseId,
    metadataOnly: input.metadataOnly,
  })
  const release =
    input.transformRelease && !input.metadataOnly
      ? input.transformRelease(originalRelease, snapshot, entry.name)
      : originalRelease
  const compatibility = createCompatibility(source.config.marketplaceDialect, capabilities, policy)
  const security = createSecurity(capabilities, policy, input.metadataOnly)
  const normalizedCategories = entry.categories.map((category) =>
    normalizeCategory(category, input.categoryMap)
  )
  const productCategory = input.productCategories?.[entry.name]
  const categories = [
    ...new Set(
      (productCategory
        ? [productCategory, ...normalizedCategories.filter((category) => category !== 'other')]
        : normalizedCategories.length > 0
          ? normalizedCategories
          : [input.categoryMap.fallback]
      ).filter(Boolean)
    ),
  ].toSorted()
  const displayName = entry.displayName ?? pluginManifest?.displayName ?? entry.name
  const authors =
    entry.authors.length > 0
      ? [...entry.authors]
      : source.parsed.owner.length > 0
        ? [...source.parsed.owner]
        : ['Unknown']
  const keywords = [...new Set([...entry.keywords, ...entry.name.split(/[-_\s]+/g), ...categories])]
    .filter(Boolean)
    .toSorted()
  const provenance: PluginProvenance = {
    sourceId: source.config.sourceId,
    repositoryUrl: canonicalRepositoryUrl(source.config.repositoryUrl),
    manifestPath: source.config.manifestPath,
    pluginSubdirectory: resolved.subdirectory || '.',
    resolvedCommitSha: resolved.commitSha,
    sourceManifestDigest: source.manifestDigest,
    upstreamEntryDigest: entry.entryDigest,
  }
  return {
    pluginId: stablePluginId(source.config.sourceId, entry.name),
    displayName,
    description: entry.description || pluginManifest?.description || '',
    productGroupingKey: productGroupingKey(entry.name, input.productAliases),
    categories,
    keywords,
    authors,
    ...(entry.homepage ? { homepage: entry.homepage } : {}),
    icons: entry.icons.length > 0 ? [...entry.icons].toSorted() : (pluginManifest?.icons ?? []),
    sourceId: source.config.sourceId,
    upstreamPluginName: entry.name,
    currentReleaseId: releaseId,
    availableReleases: [release],
    capabilitySummary: capabilitySummary(capabilities),
    harnessCompatibility: compatibility,
    license: findLicense(entry, pluginManifest?.metadata),
    provenance,
    securityClassification: security,
  }
}

function createRelease(input: {
  readonly source: ResolvedSource
  readonly entry: MarketplacePluginEntry
  readonly resolved: ResolvedPluginSource
  readonly contentDigest: string
  readonly manifestDigest: string
  readonly capabilities: readonly Capability[]
  readonly snapshot: Snapshot
  readonly pluginManifest?: PluginManifest
  readonly releaseId: string
  readonly metadataOnly: boolean
}): PluginRelease {
  const requiredCredentials = new Set<string>()
  const auth = input.entry.policy.authentication
  if (typeof auth === 'string' && auth !== 'NONE' && auth !== 'DISABLED')
    requiredCredentials.add('authentication')
  for (const value of arrayValue(input.entry.raw.requiredCredentials))
    if (typeof value === 'string') requiredCredentials.add(value)
  const requiredConnectors = [
    ...new Set(arrayValue(input.entry.raw.connectors).filter(isString)),
  ].toSorted()
  const permissionSensitiveChanges = input.capabilities
    .filter((capability) => capability.securityImpact === 'sensitive')
    .map((capability) => capability.type)
    .toSorted()
  const metadata: Record<string, unknown> = {
    marketplaceEntry: input.entry.raw,
    ...(input.pluginManifest ? { pluginManifest: input.pluginManifest.metadata } : {}),
    sourceDialect: input.source.config.marketplaceDialect,
  }
  const version = input.pluginManifest?.version ?? stringValue(input.entry.raw.version)
  return {
    releaseId: input.releaseId,
    ...(version ? { upstreamVersion: version } : {}),
    resolvedRepositoryUrl: input.resolved.repositoryUrl,
    resolvedCommitSha: input.resolved.commitSha,
    pluginSubdirectory: input.resolved.subdirectory || '.',
    canonicalContentDigest: input.contentDigest,
    manifestDigest: input.manifestDigest,
    contentResolution: input.metadataOnly ? 'metadata-only' : 'complete',
    releaseMetadata: metadata,
    capabilities: [...input.capabilities].toSorted(
      (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name)
    ),
    requiredConnectors,
    requiredCredentials: [...requiredCredentials].toSorted(),
    permissionSensitiveChanges: [...new Set(permissionSensitiveChanges)],
    fileIndex: [...input.snapshot.files.keys()].toSorted(),
    publicationTimestamp: input.source.retrievedAt,
  }
}

async function resolvePluginSource(
  pluginName: string,
  spec: PluginSourceSpec,
  source: ResolvedSource,
  resolveExternalRefs: boolean
): Promise<ResolvedPluginSource> {
  if (spec.kind === 'local')
    return {
      repositoryUrl: canonicalRepositoryUrl(source.config.repositoryUrl),
      subdirectory: spec.path,
      commitSha: source.commitSha,
    }
  const canonicalUrl = canonicalRepositoryUrl(spec.repositoryUrl)
  const pin = source.pluginPins.find(
    (candidate) =>
      candidate.pluginName === pluginName &&
      candidate.repositoryUrl === canonicalUrl &&
      candidate.pluginSubdirectory === spec.subdirectory
  )
  const commitSha =
    pin?.resolvedCommitSha ??
    spec.sha ??
    (resolveExternalRefs
      ? await resolveGitRef(
          spec.repositoryUrl,
          spec.ref?.startsWith('refs/') ? spec.ref : `refs/heads/${spec.ref ?? 'main'}`
        )
      : source.commitSha)
  return {
    repositoryUrl: canonicalUrl,
    subdirectory: pin?.pluginSubdirectory ?? spec.subdirectory,
    commitSha,
  }
}

interface ResolvedPluginSource {
  readonly repositoryUrl: string
  readonly subdirectory: string
  readonly commitSha: string
}

function validateSnapshot(snapshot: Snapshot, policy: CatalogPolicy, pluginName: string): void {
  if (snapshot.files.size > policy.maxFilesPerPlugin)
    throw new PluginSafetyError('PLUGIN_TOO_MANY_FILES', [pluginName])
  let total = 0
  for (const [path, bytes] of snapshot.files) {
    try {
      safeRelativePath(path, 'SNAPSHOT_PATH_INVALID')
    } catch {
      throw new PluginSafetyError('SNAPSHOT_PATH_INVALID', [path])
    }
    if (bytes.byteLength > policy.maxFileBytes)
      throw new PluginSafetyError('PLUGIN_FILE_TOO_LARGE', [path])
    total += bytes.byteLength
  }
  if (total > policy.maxBytesPerPlugin)
    throw new PluginSafetyError('PLUGIN_TOO_LARGE', [pluginName])
}

function assertRepositoryAllowed(repositoryUrl: string, policy: CatalogPolicy): void {
  const parsed = new URL(canonicalRepositoryUrl(repositoryUrl))
  if (!policy.allowedRepositoryProtocols.includes(parsed.protocol))
    throw new Error(`GIT_PROTOCOL_POLICY: ${parsed.protocol}`)
  if (!policy.allowedRepositoryHosts.includes(parsed.hostname.toLowerCase()))
    throw new Error(`GIT_HOST_POLICY: ${parsed.hostname}`)
}

interface PluginManifest {
  readonly metadata: Record<string, unknown>
  readonly displayName?: string | undefined
  readonly description?: string | undefined
  readonly version?: string | undefined
  readonly icons: string[]
}

function findPluginManifest(snapshot: Snapshot, preferRoot = false): PluginManifest | undefined {
  const candidates = [...snapshot.files.keys()]
    .filter((path) => {
      const lower = path.toLocaleLowerCase()
      return lower === 'plugin.json' || lower.endsWith('/plugin.json') || lower === 'package.json'
    })
    .toSorted(
      (left, right) => manifestRank(left) - manifestRank(right) || left.localeCompare(right)
    )
  const path = preferRoot && snapshot.files.has('plugin.json') ? 'plugin.json' : candidates[0]
  if (!path) return undefined
  try {
    const bytes = snapshot.files.get(path)
    if (!bytes) return undefined
    const metadata = parseJsonDocument(new TextDecoder().decode(bytes)) as Record<string, unknown>
    return {
      metadata,
      ...((stringValue(metadata.displayName) ?? stringValue(metadata.name))
        ? { displayName: stringValue(metadata.displayName) ?? stringValue(metadata.name) }
        : {}),
      ...(stringValue(metadata.description)
        ? { description: stringValue(metadata.description) }
        : {}),
      ...(stringValue(metadata.version) ? { version: stringValue(metadata.version) } : {}),
      icons: [metadata.icon, ...(Array.isArray(metadata.icons) ? metadata.icons : [])]
        .filter(isString)
        .toSorted(),
    }
  } catch {
    throw new PluginSafetyError('PLUGIN_MANIFEST_INVALID', [path])
  }
}

function manifestRank(path: string): number {
  const lower = path.toLocaleLowerCase()
  if (lower.endsWith('/.claude-plugin/plugin.json')) return 0
  if (lower.endsWith('/.cursor-plugin/plugin.json')) return 1
  if (lower.endsWith('/.agents/plugin.json')) return 2
  return lower === 'plugin.json' ? 3 : 4
}

export function classifyCapabilities(
  files: ReadonlyMap<string, Uint8Array>,
  metadata?: Record<string, unknown>
): Capability[] {
  const groups = new Map<string, string[]>()
  const add = (type: Capability['type'], path: string) =>
    groups.set(type, [...(groups.get(type) ?? []), path])
  for (const path of files.keys()) {
    const lower = path.toLocaleLowerCase()
    const file = basename(lower)
    if (file === 'skill.md' || lower.includes('/skills/')) add('skill', path)
    if (file === '.mcp.json' || file === 'mcp.json' || lower.includes('/mcp-servers/'))
      add('mcp-server', path)
    if (lower.includes('/commands/') || lower.startsWith('commands/')) add('command', path)
    if (lower.includes('/agents/') || lower.startsWith('agents/') || lower.includes('/subagents/'))
      add('agent', path)
    if (lower.includes('/hooks/') || lower.startsWith('hooks/') || file === 'hooks.json')
      add('hook', path)
    if (
      lower.includes('/rules/') ||
      lower.startsWith('rules/') ||
      file === 'agents.md' ||
      file === 'claude.md' ||
      lower.includes('.cursor/rules/')
    )
      add('rule', path)
    if (lower.includes('browser') || lower.includes('playwright') || lower.includes('chrome'))
      add('browser', path)
    if (lower.includes('/schedule') || lower.includes('/cron') || file.includes('schedule'))
      add('scheduled-task', path)
    if (lower.includes('/ui/') || lower.startsWith('ui/') || lower.includes('/components/'))
      add('ui-component', path)
    if (
      lower.startsWith('bin/') ||
      lower.startsWith('scripts/') ||
      /\.(sh|bash|py|exe|bin)$/.test(file)
    )
      add('executable', path)
  }
  if (metadata && (metadata.mcpServers !== undefined || metadata.mcp !== undefined))
    add('mcp-server', 'plugin-manifest')
  if (metadata && (metadata.hooks !== undefined || metadata.hook !== undefined))
    add('hook', 'plugin-manifest')
  if (groups.size === 0) groups.set('unknown', ['plugin-root'])
  return [...groups.entries()].map(([type, paths]) => ({
    type: type as Capability['type'],
    name: type,
    paths: [...new Set(paths)].toSorted(),
    metadata: {},
    securityImpact: [
      'mcp-server',
      'connector',
      'hook',
      'browser',
      'scheduled-task',
      'executable',
    ].includes(type)
      ? 'sensitive'
      : 'none',
  }))
}

function capabilitySummary(
  capabilities: readonly Capability[]
): Record<Capability['type'], number> {
  const summary = {} as Record<Capability['type'], number>
  for (const capability of capabilities) summary[capability.type] = capability.paths.length
  return summary
}

export function createCompatibility(
  dialect: MarketplaceDialectName,
  capabilities: readonly Capability[],
  policy: CatalogPolicy = DEFAULT_POLICY
): Record<Harness, HarnessCompatibility> {
  const types = [...new Set(capabilities.map((capability) => capability.type))].toSorted()
  const sensitive = types.filter((type) => policy.sensitiveCapabilityTypes.includes(type))
  const make = (
    status: HarnessCompatibility['status'],
    reasons: string[]
  ): HarnessCompatibility => ({
    status,
    reasons: [...new Set(reasons)].toSorted(),
    responsibleCapabilities: types,
  })
  const result = {} as Record<Harness, HarnessCompatibility>
  for (const harness of HarnessSchema.options) {
    const native =
      (harness === 'claude-code' && dialect === 'claude') ||
      (harness === 'cursor' && dialect === 'cursor') ||
      (harness === 'codex' && dialect === 'openai')
    if (types.includes('executable'))
      result[harness] = make('unsupported', [
        'Executable components require harness-specific execution authority.',
      ])
    else if (types.includes('unknown'))
      result[harness] = make('unknown', [
        'The plugin content was not classified into a supported component type.',
      ])
    else if (native && sensitive.length === 0)
      result[harness] = make('native', [
        `The ${dialect} marketplace dialect matches the ${harness} harness.`,
      ])
    else if (sensitive.length > 0 && ['pi', 'hermes', 'opencode'].includes(harness))
      result[harness] = make('partially-supported', [
        `Sensitive capabilities require ${harness} policy and runtime review.`,
        ...sensitive.map((type) => `Capability ${type} is not granted by this catalog.`),
      ])
    else if (
      types.every((type) => ['skill', 'rule', 'mcp-server', 'command', 'agent'].includes(type))
    )
      result[harness] = make(
        native ? 'native' : 'portable',
        native
          ? [`The ${dialect} marketplace dialect matches the ${harness} harness.`]
          : ['Files can be copied or translated into the harness layout.']
      )
    else
      result[harness] = make('requires-translation', [
        'One or more capabilities need a harness-specific projection.',
      ])
  }
  return result
}

type MarketplaceDialectName = 'openai' | 'cursor' | 'claude'

function createSecurity(
  capabilities: readonly Capability[],
  policy: CatalogPolicy,
  metadataOnly: boolean
): SecurityClassification {
  const sensitive = [
    ...new Set(
      capabilities
        .filter((capability) => policy.sensitiveCapabilityTypes.includes(capability.type))
        .map((capability) => capability.type)
    ),
  ].toSorted()
  const reasons =
    sensitive.length > 0
      ? sensitive.map((type) => `Contains ${type} capability metadata.`)
      : metadataOnly
        ? ['Content was not fetched in metadata-only mode.']
        : ['No permission-sensitive executable capability was detected.']
  return {
    level: sensitive.length > 0 ? 'sensitive' : metadataOnly ? 'review' : 'low',
    reasons,
    permissionSensitiveChanges: sensitive,
    contentResolution: metadataOnly ? 'metadata-only' : 'complete',
  }
}

function findLicense(
  entry: MarketplacePluginEntry,
  metadata?: Record<string, unknown>
): LicenseMetadata {
  const candidate = stringValue(metadata?.license) ?? stringValue(entry.raw.license)
  if (!candidate) return { name: 'Unknown', source: 'unknown' }
  return {
    name: candidate,
    ...(candidate.startsWith('http') ? { url: candidate } : {}),
    source: metadata?.license !== undefined ? 'plugin-manifest' : 'marketplace-entry',
  }
}

function createSourcesLock(sources: readonly ResolvedSource[]): SourcesLock {
  const entries: SourceLockEntry[] = sources
    .map((source) => ({
      sourceId: source.config.sourceId,
      repositoryUrl: canonicalRepositoryUrl(source.config.repositoryUrl),
      defaultBranch: source.config.defaultBranch,
      resolvedCommitSha: source.commitSha,
      manifestPath: source.config.manifestPath,
      marketplaceDialect: source.config.marketplaceDialect,
      sourceManifestDigest: source.manifestDigest,
      retrievedAt: source.retrievedAt,
      synchronizationStatus: 'synchronized' as const,
      pluginPins: source.pluginPins.map((pin) => ({ ...pin })),
    }))
    .toSorted((left, right) => left.sourceId.localeCompare(right.sourceId))
  const body = { schemaVersion: 1 as const, sources: entries }
  return SourcesLockSchema.parse({
    ...body,
    lockId: `lock:${digest(body).slice('sha256:'.length)}`,
  })
}

/**
 * Orders plugins so each category's curated leading products come first, in
 * the configured order. Consumers preview the head of each category, so this
 * ordering decides what users see before expanding.
 */
export function orderLeadingPlugins<
  T extends {
    readonly plugins: readonly {
      categories: readonly string[]
      upstreamPluginName: string
    }[]
  },
>(catalog: T, leading?: Record<string, readonly string[]>): T {
  if (!leading) return catalog
  const leadRank = new Map<string, number>()
  for (const [category, names] of Object.entries(leading)) {
    names.forEach((name, index) => {
      const key = `${category}::${name}`
      if (!leadRank.has(key)) leadRank.set(key, index)
    })
  }
  const rank = (plugin: T['plugins'][number]): number => {
    let best = Number.POSITIVE_INFINITY
    for (const category of plugin.categories) {
      const value = leadRank.get(`${category}::${plugin.upstreamPluginName}`)
      if (value !== undefined && value < best) best = value
    }
    return best
  }
  return {
    ...catalog,
    plugins: [...catalog.plugins].sort((left, right) => rank(left) - rank(right)),
  }
}

export function createArtifacts(catalog: Catalog, lock: SourcesLock): GeneratedArtifacts {
  const summary = {
    schemaVersion: 1,
    catalogId: catalog.catalogId,
    generatedAt: catalog.generatedAt,
    sourceCount: catalog.sources.length,
    pluginCount: catalog.plugins.length,
    categories: [...new Set(catalog.plugins.flatMap((plugin) => plugin.categories))].toSorted(),
    productGroups: [
      ...new Set(catalog.plugins.map((plugin) => plugin.productGroupingKey)),
    ].toSorted(),
    search: catalog.plugins
      .map((plugin) => ({
        pluginId: plugin.pluginId,
        text: `${plugin.displayName} ${plugin.description} ${plugin.keywords.join(' ')}`.trim(),
      }))
      .toSorted((left, right) => left.pluginId.localeCompare(right.pluginId)),
  }
  const compatibility = {
    schemaVersion: 1,
    catalogId: catalog.catalogId,
    plugins: catalog.plugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      harnessCompatibility: plugin.harnessCompatibility,
    })),
  }
  const categories = [...new Set(catalog.plugins.flatMap((plugin) => plugin.categories))]
    .toSorted()
    .map((category) => ({
      category,
      pluginIds: catalog.plugins
        .filter((plugin) => plugin.categories.includes(category))
        .map((plugin) => plugin.pluginId),
    }))
  const files: Omit<GeneratedArtifacts, 'integrity.json'> = {
    'catalog.v1.json': json(catalog),
    'catalog-summary.v1.json': json(summary),
    'sources.lock.json': json(lock),
    'compatibility.v1.json': json(compatibility),
    'categories.v1.json': json({ schemaVersion: 1, catalogId: catalog.catalogId, categories }),
  }
  const integrityBody = {
    schemaVersion: 1,
    catalogId: catalog.catalogId,
    files: Object.fromEntries(
      Object.entries(files)
        .toSorted()
        .map(([name, content]) => [name, digest(content)])
    ),
  }
  return { ...files, 'integrity.json': json(integrityBody) }
}

export async function writeArtifacts(
  generatedDirectory: string,
  artifacts: GeneratedArtifacts
): Promise<void> {
  const parent = dirname(generatedDirectory)
  await fs.mkdir(parent, { recursive: true })
  const temporary = await fs.mkdtemp(join(parent, '.catalog-'))
  try {
    for (const [name, content] of Object.entries(artifacts))
      await fs.writeFile(join(temporary, name), content, 'utf8')
    const backup = `${generatedDirectory}.previous`
    await fs.rm(backup, { recursive: true, force: true })
    let movedExisting = false
    try {
      await fs.rename(generatedDirectory, backup)
      movedExisting = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await fs.rename(temporary, generatedDirectory)
    } catch (error) {
      if (movedExisting) await fs.rename(backup, generatedDirectory)
      throw error
    }
    if (movedExisting) await fs.rm(backup, { recursive: true, force: true })
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

export function verifyArtifacts(artifacts: GeneratedArtifacts): void {
  const parsedCatalog = CatalogSchema.parse(JSON.parse(artifacts['catalog.v1.json']))
  verifyCatalogReferences(parsedCatalog)
  const lock = SourcesLockSchema.parse(JSON.parse(artifacts['sources.lock.json']))
  const summary = JSON.parse(artifacts['catalog-summary.v1.json']) as {
    schemaVersion?: unknown
    catalogId?: unknown
    sourceCount?: unknown
    pluginCount?: unknown
    search?: unknown
  }
  const compatibility = JSON.parse(artifacts['compatibility.v1.json']) as {
    schemaVersion?: unknown
    catalogId?: unknown
    plugins?: unknown
  }
  const categories = JSON.parse(artifacts['categories.v1.json']) as {
    schemaVersion?: unknown
    catalogId?: unknown
    categories?: unknown
  }
  const integrity = JSON.parse(artifacts['integrity.json']) as {
    schemaVersion?: unknown
    catalogId?: unknown
    files?: Record<string, string>
  }
  if (parsedCatalog.sources.length !== lock.sources.length)
    throw new Error('INTEGRITY_SOURCE_COUNT_MISMATCH')
  if (
    summary.schemaVersion !== 1 ||
    summary.catalogId !== parsedCatalog.catalogId ||
    summary.sourceCount !== parsedCatalog.sources.length ||
    summary.pluginCount !== parsedCatalog.plugins.length ||
    !Array.isArray(summary.search) ||
    compatibility.schemaVersion !== 1 ||
    compatibility.catalogId !== parsedCatalog.catalogId ||
    !Array.isArray(compatibility.plugins) ||
    compatibility.plugins.length !== parsedCatalog.plugins.length ||
    categories.schemaVersion !== 1 ||
    categories.catalogId !== parsedCatalog.catalogId ||
    !Array.isArray(categories.categories) ||
    integrity.schemaVersion !== 1 ||
    integrity.catalogId !== parsedCatalog.catalogId ||
    !integrity.files
  ) {
    throw new Error('INTEGRITY_ARTIFACT_METADATA_MISMATCH')
  }
  const expectedFiles = [
    'catalog.v1.json',
    'catalog-summary.v1.json',
    'sources.lock.json',
    'compatibility.v1.json',
    'categories.v1.json',
  ]
  if (
    Object.keys(integrity.files).length !== expectedFiles.length ||
    expectedFiles.some((name) => integrity.files?.[name] === undefined)
  ) {
    throw new Error('INTEGRITY_FILE_SET_MISMATCH')
  }
  for (const [name, expected] of Object.entries(integrity.files ?? {})) {
    const content = artifacts[name as keyof Omit<GeneratedArtifacts, 'integrity.json'>]
    if (content === undefined || digest(content) !== expected)
      throw new Error(`INTEGRITY_DIGEST_MISMATCH: ${name}`)
  }
}

export function verifyCatalogReferences(
  catalog: Catalog,
  policy: CatalogPolicy = DEFAULT_POLICY
): void {
  for (const source of catalog.sources) {
    assertRepositoryAllowed(source.repositoryUrl, policy)
    validateCatalogPath(source.manifestPath, 'SOURCE_MANIFEST_PATH_INVALID')
  }
  for (const plugin of catalog.plugins) {
    assertRepositoryAllowed(plugin.provenance.repositoryUrl, policy)
    validateCatalogPath(plugin.provenance.pluginSubdirectory, 'PROVENANCE_PATH_INVALID')
    for (const release of plugin.availableReleases) {
      assertRepositoryAllowed(release.resolvedRepositoryUrl, policy)
      validateCatalogPath(release.pluginSubdirectory, 'RELEASE_PATH_INVALID')
      for (const path of release.fileIndex) validateCatalogPath(path, 'RELEASE_FILE_PATH_INVALID')
    }
  }
}

function validateCatalogPath(path: string, code: string): void {
  if (path !== '.') safeRelativePath(path, code)
}

function createChangeReport(
  catalog: Catalog,
  lock: SourcesLock,
  existingLock?: SourcesLock,
  existingCatalog?: Catalog,
  skippedPlugins: readonly SkippedPlugin[] = []
): ChangeReport {
  const changedSources = existingLock
    ? lock.sources
        .filter((source) =>
          (() => {
            const previous = existingLock.sources.find(
              (candidate) => candidate.sourceId === source.sourceId
            )
            return (
              !previous ||
              previous?.resolvedCommitSha !== source.resolvedCommitSha ||
              previous.sourceManifestDigest !== source.sourceManifestDigest ||
              digest(previous.pluginPins) !== digest(source.pluginPins)
            )
          })()
        )
        .map((source) => source.sourceId)
    : lock.sources.map((source) => source.sourceId)
  const previousPlugins = new Map(
    existingCatalog?.plugins.map((plugin) => [plugin.pluginId, plugin]) ?? []
  )
  const currentPlugins = new Map(catalog.plugins.map((plugin) => [plugin.pluginId, plugin]))
  const addedPlugins = catalog.plugins
    .filter((plugin) => !previousPlugins.has(plugin.pluginId))
    .map((plugin) => plugin.pluginId)
  const removedPlugins = [...previousPlugins.keys()].filter(
    (pluginId) => !currentPlugins.has(pluginId)
  )
  const changedPlugins = catalog.plugins
    .filter(
      (plugin) =>
        previousPlugins.get(plugin.pluginId)?.currentReleaseId !== plugin.currentReleaseId &&
        previousPlugins.has(plugin.pluginId)
    )
    .map((plugin) => plugin.pluginId)
  return {
    schemaVersion: 1,
    changedSources: changedSources.toSorted(),
    addedPlugins: addedPlugins.toSorted(),
    removedPlugins: removedPlugins.toSorted(),
    changedPlugins: changedPlugins.toSorted(),
    skippedPlugins,
    permissionSensitiveChanges: catalog.plugins
      .flatMap((plugin) =>
        plugin.securityClassification.permissionSensitiveChanges.map(
          (type) => `${plugin.pluginId}:${type}`
        )
      )
      .toSorted(),
    contentResolution:
      skippedPlugins.length > 0
        ? 'complete-with-skips'
        : catalog.plugins.some(
              (plugin) => plugin.securityClassification.contentResolution === 'metadata-only'
            )
          ? 'metadata-only'
          : 'complete',
  }
}

async function resolveSource(
  config: SourceConfig,
  mode: 'live' | 'offline',
  fixtureRoot: string | undefined,
  lock: SourcesLock | undefined,
  fromLock: boolean
): Promise<ResolvedSource> {
  const manifestPath = safeRelativePath(config.manifestPath, 'SOURCE_MANIFEST_PATH_INVALID')
  const locked = lock?.sources.find((entry) => entry.sourceId === config.sourceId)
  if (fromLock && !locked) throw new Error(`SOURCE_LOCK_ENTRY_MISSING: ${config.sourceId}`)
  const commitSha =
    fromLock && locked
      ? locked.resolvedCommitSha
      : mode === 'offline'
        ? (config.fixtureCommitSha ?? locked?.resolvedCommitSha)
        : await resolveGitRef(config.repositoryUrl, `refs/heads/${config.defaultBranch}`)
  if (!commitSha || !/^[a-f0-9]{40}$/.test(commitSha))
    throw new Error(`SOURCE_COMMIT_UNRESOLVED: ${config.sourceId}`)
  const manifestText =
    mode === 'offline'
      ? await readFixtureManifest({ ...config, manifestPath }, fixtureRoot)
      : await fetchText(rawUrl(config.repositoryUrl, commitSha, manifestPath))
  const parsed = parseMarketplaceManifest(parseJsonDocument(manifestText), config)
  if (fromLock && locked && digest(manifestText) !== locked.sourceManifestDigest)
    throw new Error(`SOURCE_LOCK_MANIFEST_MISMATCH: ${config.sourceId}`)
  const pluginPins = await resolvePluginPins({
    config,
    parsed,
    sourceCommitSha: commitSha,
    lockedPins: locked?.pluginPins,
    fromLock,
    resolveExternalRefs: mode === 'live',
  })
  return {
    config,
    commitSha,
    manifestText,
    parsed,
    pluginPins,
    retrievedAt:
      fromLock && locked
        ? locked.retrievedAt
        : mode === 'offline'
          ? '2026-01-01T00:00:00.000Z'
          : new Date().toISOString(),
    manifestDigest: digest(manifestText),
  }
}

async function resolvePluginPins(input: {
  readonly config: SourceConfig
  readonly parsed: ParsedMarketplace
  readonly sourceCommitSha: string
  readonly lockedPins: readonly PluginSourcePin[] | undefined
  readonly fromLock: boolean
  readonly resolveExternalRefs: boolean
}): Promise<PluginSourcePin[]> {
  const pins = await mapWithConcurrency(
    input.parsed.entries,
    8,
    async (entry): Promise<PluginSourcePin> => {
      if (entry.source.kind === 'local') {
        return {
          pluginName: entry.name,
          repositoryUrl: canonicalRepositoryUrl(input.config.repositoryUrl),
          pluginSubdirectory: entry.source.path,
          resolvedCommitSha: input.sourceCommitSha,
        }
      }

      const repositoryUrl = canonicalRepositoryUrl(entry.source.repositoryUrl)
      const pluginSubdirectory = entry.source.subdirectory
      const locked = input.lockedPins?.find((pin) => pin.pluginName === entry.name)
      if (input.fromLock && !locked)
        throw new Error(`SOURCE_LOCK_PLUGIN_PIN_MISSING: ${input.config.sourceId}:${entry.name}`)
      if (locked) {
        if (
          locked.repositoryUrl !== repositoryUrl ||
          locked.pluginSubdirectory !== pluginSubdirectory
        ) {
          throw new Error(`SOURCE_LOCK_PLUGIN_PIN_MISMATCH: ${input.config.sourceId}:${entry.name}`)
        }
        return locked
      }

      const resolvedCommitSha =
        entry.source.sha ??
        (input.resolveExternalRefs
          ? await resolveGitRef(
              repositoryUrl,
              entry.source.ref?.startsWith('refs/')
                ? entry.source.ref
                : `refs/heads/${entry.source.ref ?? 'main'}`
            )
          : input.sourceCommitSha)
      return { pluginName: entry.name, repositoryUrl, pluginSubdirectory, resolvedCommitSha }
    }
  )
  return pins.toSorted((left, right) => left.pluginName.localeCompare(right.pluginName))
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<U>
): Promise<U[]> {
  const results = Array.from<U>({ length: values.length })
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++
      if (index >= values.length) return
      results[index] = await mapper(values[index]!, index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), values.length) }, () => worker())
  )
  return results
}

async function readFixtureManifest(
  config: SourceConfig,
  fixtureRoot: string | undefined
): Promise<string> {
  if (!fixtureRoot || !config.fixturePath)
    throw new Error(`FIXTURE_ROOT_REQUIRED: ${config.sourceId}`)
  return fs.readFile(join(resolve(fixtureRoot), config.fixturePath, config.manifestPath), 'utf8')
}

async function resolveGitRef(repositoryUrl: string, ref: string): Promise<string> {
  const result = spawn('git', ['ls-remote', canonicalRepositoryUrl(repositoryUrl), ref], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Promise<string>((resolveOutput, reject) => {
      const chunks: Buffer[] = []
      result.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
      result.stdout?.on('error', reject)
      result.stdout?.on('end', () => resolveOutput(Buffer.concat(chunks).toString('utf8')))
    }),
    new Promise<string>((resolveError) => {
      const chunks: Buffer[] = []
      result.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk))
      result.stderr?.on('error', () => resolveError(''))
      result.stderr?.on('end', () => resolveError(Buffer.concat(chunks).toString('utf8')))
    }),
    new Promise<number | null>((resolveExit, reject) => {
      result.on('error', reject)
      result.on('close', (code) => resolveExit(code ?? 1))
    }),
  ])
  if (exitCode !== 0)
    throw new Error(`GIT_REF_LOOKUP_FAILED: ${repositoryUrl}:${ref}:${stderr.trim()}`)
  const sha = stdout.trim().split(/\s+/)[0]
  if (!sha || !/^[a-f0-9]{40}$/.test(sha))
    throw new Error(`GIT_REF_NOT_FOUND: ${repositoryUrl}:${ref}`)
  return sha
}

function rawUrl(repositoryUrl: string, commitSha: string, path: string): string {
  const parsed = new URL(canonicalRepositoryUrl(repositoryUrl))
  return `https://raw.githubusercontent.com${parsed.pathname}/${commitSha}/${path.split('/').map(encodeURIComponent).join('/')}`
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: githubRequestHeaders() })
  if (!response.ok) throw new Error(`HTTP_FETCH_FAILED: ${response.status}:${url}`)
  return response.text()
}

function githubRequestHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  return token
    ? {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'agent-hq-plugin-marketplace',
      }
    : { 'user-agent': 'agent-hq-plugin-marketplace' }
}

const UPSTREAM_FETCH_MAX_ATTEMPTS = 3
const UPSTREAM_FETCH_BASE_DELAY_MS = 1000
const UPSTREAM_FETCH_MAX_DELAY_MS = 30000

const UPSTREAM_WEATHER_SKIP_CODES: ReadonlySet<PluginSkipReasonCode> = new Set([
  'PLUGIN_SOURCE_UNAVAILABLE',
  'PLUGIN_FILE_UNAVAILABLE',
  'PLUGIN_PATH_NOT_FOUND',
])

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function upstreamRetryDelayMs(attempt: number, response?: Response): number {
  const retryAfter = response?.headers.get('retry-after')
  if (retryAfter !== null && retryAfter !== undefined) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds * 1000, UPSTREAM_FETCH_MAX_DELAY_MS)
    const date = Date.parse(retryAfter)
    if (!Number.isNaN(date))
      return Math.min(Math.max(date - Date.now(), 0), UPSTREAM_FETCH_MAX_DELAY_MS)
  }
  return Math.min(UPSTREAM_FETCH_BASE_DELAY_MS * 2 ** attempt, UPSTREAM_FETCH_MAX_DELAY_MS)
}

function isRateLimitedUpstream(response: Response): boolean {
  return (
    response.headers.get('x-ratelimit-remaining') === '0' ||
    response.headers.get('retry-after') !== null
  )
}

function isRetryableUpstreamStatus(status: number, response?: Response): boolean {
  if (status === 429) return true
  if (status >= 500) return true
  if (status === 403 && response !== undefined && isRateLimitedUpstream(response)) return true
  return false
}

async function fetchUpstream(url: string, init: RequestInit): Promise<Response> {
  let attempt = 0
  for (;;) {
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      if (attempt >= UPSTREAM_FETCH_MAX_ATTEMPTS - 1) throw error
      await sleep(upstreamRetryDelayMs(attempt))
      attempt += 1
      continue
    }
    if (
      response.ok ||
      !isRetryableUpstreamStatus(response.status, response) ||
      attempt >= UPSTREAM_FETCH_MAX_ATTEMPTS - 1
    )
      return response
    await sleep(upstreamRetryDelayMs(attempt, response))
    attempt += 1
  }
}

export class NetworkSnapshotLoader implements SnapshotLoader {
  readonly #policy: CatalogPolicy
  readonly #trees = new Map<string, readonly TreeEntry[]>()

  constructor(policy: CatalogPolicy) {
    this.#policy = policy
  }

  async load(
    repositoryUrl: string,
    commitSha: string,
    pluginSubdirectory: string
  ): Promise<Snapshot> {
    const parsed = new URL(canonicalRepositoryUrl(repositoryUrl))
    if (!['github.com', 'www.github.com'].includes(parsed.hostname))
      throw new Error(`GIT_HOST_UNSUPPORTED: ${parsed.hostname}`)
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
    if (!owner || !repo) throw new Error('GIT_REPOSITORY_INVALID')
    const key = `${owner}/${repo}@${commitSha}`
    let tree = this.#trees.get(key)
    if (!tree) {
      const response = await fetchUpstream(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`,
        {
          headers: githubRequestHeaders(),
        }
      )
      if (!response.ok)
        throw new PluginSafetyError('PLUGIN_SOURCE_UNAVAILABLE', [`${owner}/${repo}`])
      const payload = (await response.json()) as { truncated?: boolean; tree?: TreeEntry[] }
      if (payload.truncated) throw new Error(`GIT_TREE_TRUNCATED: ${owner}/${repo}@${commitSha}`)
      tree = (payload.tree ?? []).map((entry) => ({
        ...entry,
        path: safeRelativePath(entry.path, 'TREE_PATH_INVALID'),
      }))
      this.#trees.set(key, tree)
    }
    const prefix = pluginSubdirectory ? `${safeRelativePath(pluginSubdirectory)}/` : ''
    const submodules = tree.filter(
      (entry) =>
        entry.path.startsWith(prefix) && (entry.type === 'commit' || entry.mode === '160000')
    )
    if (submodules.length > 0)
      throw new Error(`GIT_SUBMODULE_UNSUPPORTED: ${repositoryUrl}:${pluginSubdirectory}`)
    const selected = tree.filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix))
    if (selected.length === 0)
      throw new Error(`PLUGIN_PATH_NOT_FOUND: ${repositoryUrl}:${pluginSubdirectory}`)
    const files = new Map<string, Uint8Array>()
    const symlinks = tree
      .filter((entry) => entry.mode === '120000' && entry.path.startsWith(prefix))
      .map((entry) => entry.path)
    if (selected.length > this.#policy.maxFilesPerPlugin) throw new Error('PLUGIN_TOO_MANY_FILES')
    let totalSize = 0
    for (const entry of selected) {
      const size = entry.size ?? 0
      if (size > this.#policy.maxFileBytes || totalSize + size > this.#policy.maxBytesPerPlugin)
        throw new Error(`PLUGIN_SIZE_POLICY: ${entry.path}`)
      totalSize += size
      const response = await fetchUpstream(rawUrl(repositoryUrl, commitSha, entry.path), {
        headers: githubRequestHeaders(),
      })
      if (!response.ok) {
        if (response.status === 404)
          throw new PluginSafetyError('PLUGIN_PATH_NOT_FOUND', [entry.path])
        throw new PluginSafetyError('PLUGIN_FILE_UNAVAILABLE', [entry.path])
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > this.#policy.maxFileBytes)
        throw new Error(`PLUGIN_FILE_TOO_LARGE: ${entry.path}`)
      files.set(
        prefix ? relative(prefix.slice(0, -1), entry.path).replaceAll('\\', '/') : entry.path,
        bytes
      )
    }
    return { files, symlinks }
  }
}

interface TreeEntry {
  readonly path: string
  readonly mode?: string
  readonly type?: string
  readonly size?: number
}

export class FixtureSnapshotLoader implements SnapshotLoader {
  readonly #root: string
  readonly #sources: ReadonlyMap<string, SourceConfig>

  constructor(root: string, sources: readonly SourceConfig[]) {
    this.#root = resolve(root)
    this.#sources = new Map(
      sources.map((source) => [canonicalRepositoryUrl(source.repositoryUrl), source])
    )
  }

  async load(
    repositoryUrl: string,
    _commitSha: string,
    pluginSubdirectory: string
  ): Promise<Snapshot> {
    const source = this.#sources.get(canonicalRepositoryUrl(repositoryUrl))
    if (!source?.fixturePath) throw new Error(`FIXTURE_REPOSITORY_NOT_FOUND: ${repositoryUrl}`)
    return snapshotFromDirectory(join(this.#root, source.fixturePath), pluginSubdirectory)
  }
}

export class DirectorySnapshotLoader implements SnapshotLoader {
  async load(
    _repositoryUrl: string,
    _commitSha: string,
    pluginSubdirectory: string
  ): Promise<Snapshot> {
    throw new Error(`DIRECTORY_LOADER_REQUIRES_ROOT: ${pluginSubdirectory}`)
  }
}

export async function snapshotFromDirectory(
  root: string,
  pluginSubdirectory: string
): Promise<Snapshot> {
  const directory = resolve(root, pluginSubdirectory)
  const files = new Map<string, Uint8Array>()
  const symlinks: string[] = []
  const rootStat = await fs.lstat(directory)
  if (rootStat.isSymbolicLink()) return { files, symlinks: [pluginSubdirectory || '.'] }
  await walk(directory, directory, files, symlinks)
  return { files, symlinks }
}

async function walk(
  root: string,
  current: string,
  files: Map<string, Uint8Array>,
  symlinks: string[]
): Promise<void> {
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name)
    const relativePath = safeRelativePath(relative(root, absolute), 'DIRECTORY_PATH_INVALID')
    if (entry.isSymbolicLink()) {
      symlinks.push(relativePath)
      continue
    }
    if (entry.isDirectory()) await walk(root, absolute, files, symlinks)
    else if (entry.isFile()) files.set(relativePath, await fs.readFile(absolute))
  }
}

function sortArtifactKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortArtifactKeys)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .toSorted()
        .map((key) => [key, sortArtifactKeys((value as Record<string, unknown>)[key])])
    )
  return value
}

function json(value: unknown): string {
  return `${JSON.stringify(sortArtifactKeys(value), null, 2)}\n`
}

function trimSlugEdges(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === '-') start += 1
  while (end > start && value[end - 1] === '-') end -= 1
  return value.slice(start, end)
}

function slug(value: string): string {
  const result =
    trimSlugEdges(
      value
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
    ).slice(0, 128) || 'unknown'
  return result.length < 2 ? `${result}-plugin` : result
}

function stringValue(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined
}

function isString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0
}

function arrayValue(input: unknown): unknown[] {
  return Array.isArray(input) ? input : []
}
