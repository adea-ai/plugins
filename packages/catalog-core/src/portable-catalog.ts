import { CatalogSchema, HarnessSchema, type Catalog, type Plugin } from '@adea-ai/catalog-schema'
import {
  synchronize,
  createArtifacts,
  verifyArtifacts,
  digest,
  type SyncInput,
  type SyncResult,
  type ReleaseTransform,
} from './index.js'
import { compileAgentPackage, verifyAgentPackage, NORMALIZER_VERSION } from './agent-plugins.js'

export const PACKAGE_METADATA_KEY = 'agentPlugins'
function currentContract(catalog: Catalog | undefined): boolean {
  return (
    !!catalog &&
    catalog.plugins.every((plugin) =>
      plugin.availableReleases.every((release) => {
        const value = release.releaseMetadata[PACKAGE_METADATA_KEY]
        return (
          release.contentResolution === 'complete' &&
          value !== null &&
          typeof value === 'object' &&
          'normalizerVersion' in value &&
          value.normalizerVersion === NORMALIZER_VERSION
        )
      })
    )
  )
}
function compatibility(
  pkg: ReturnType<typeof compileAgentPackage>
): Plugin['harnessCompatibility'] {
  // Catalog discovery has no running harness. A brand/source marketplace cannot prove compatibility.
  return Object.fromEntries(
    HarnessSchema.options.map((harness) => [
      harness,
      {
        status:
          pkg.status === 'unavailable'
            ? 'unsupported'
            : pkg.status === 'partial'
              ? 'partially-supported'
              : 'unknown',
        reasons: [
          pkg.status === 'unavailable'
            ? 'No valid canonical package is available.'
            : 'Agent Plugins core is parsed; negotiate the actual runtime capability profile in a v2 installation plan. Policy approval is separate.',
        ],
        responsibleCapabilities: [
          ...new Set([
            ...(pkg.skills.length ? ['skill' as const] : []),
            ...(Object.keys(pkg.mcpServers).length ? ['mcp-server' as const] : []),
          ]),
        ],
      },
    ])
  ) as Plugin['harnessCompatibility']
}

/** Default compiler path: immutable upstream catalog + canonical portable package recipes.
 * The existing v1 catalog envelope remains stable; the extension is versioned inside
 * releaseMetadata, which v1 deliberately defines as extensible JSON.
 */
export async function synchronizePortable(options: SyncInput): Promise<SyncResult> {
  if (options.existingCatalog) verifyPortableCatalog(options.existingCatalog)
  const transformRelease: ReleaseTransform = (original, snapshot, name) => {
    const release = options.transformRelease?.(original, snapshot, name) ?? original
    if (
      release.releaseId !== original.releaseId ||
      release.canonicalContentDigest !== original.canonicalContentDigest ||
      release.resolvedRepositoryUrl !== original.resolvedRepositoryUrl ||
      release.resolvedCommitSha !== original.resolvedCommitSha ||
      release.pluginSubdirectory !== original.pluginSubdirectory ||
      release.contentResolution !== original.contentResolution
    )
      throw new Error('SOURCE_IDENTITY_CHANGED_BY_TRANSFORM')
    const pkg = compileAgentPackage({
      ...snapshot,
      name,
      sourceDigest: original.canonicalContentDigest,
    })
    return {
      ...release,
      releaseMetadata: { ...release.releaseMetadata, [PACKAGE_METADATA_KEY]: pkg },
    }
  }
  // Compile while each upstream snapshot is already in scope. Do not retain all
  // marketplace file bytes or fetch every package a second time after cataloging.
  const input = {
    ...options,
    metadataOnly: options.metadataOnly === true || options.dryRun === true,
    transformRelease,
  }
  let result = await synchronize(input)
  if (
    !result.changed &&
    !input.metadataOnly &&
    !currentContract(input.existingCatalog) &&
    input.existingLock
  ) {
    // Replay the already verified pins when the compiler contract changes. Source heads
    // need not change for a format migration, and dry runs still never publish.
    result = await synchronize({ ...input, fromLock: input.existingLock })
  }
  if (!result.catalog || !result.lock || input.metadataOnly) return result
  const plugins: Plugin[] = []
  for (const plugin of result.catalog.plugins) {
    const releases = plugin.availableReleases
    const selected = releases.find((release) => release.releaseId === plugin.currentReleaseId)
    const pkg = selected?.releaseMetadata[PACKAGE_METADATA_KEY]
    plugins.push({
      ...plugin,
      availableReleases: releases,
      ...(pkg ? { harnessCompatibility: compatibility(verifyAgentPackage(pkg)) } : {}),
    })
  }
  const { catalogId: _oldId, ...old } = result.catalog
  const body = { ...old, plugins }
  const catalog = CatalogSchema.parse({ ...body, catalogId: `catalog:${digest(body).slice(7)}` })
  verifyPortableCatalog(catalog)
  const artifacts = createArtifacts(catalog, result.lock)
  verifyArtifacts(artifacts)
  const changed = catalog.plugins
    .filter((plugin) => {
      const prior = input.existingCatalog?.plugins.find((item) => item.pluginId === plugin.pluginId)
      return prior && digest(prior) !== digest(plugin)
    })
    .map((plugin) => plugin.pluginId)
  return {
    ...result,
    catalog,
    artifacts,
    changeReport: {
      ...result.changeReport,
      changedPlugins: [...new Set([...result.changeReport.changedPlugins, ...changed])].toSorted(),
    },
  }
}

export function verifyPortableCatalog(catalog: Catalog, requirePortable = false): void {
  const { catalogId, ...body } = CatalogSchema.parse(catalog)
  if (catalogId !== `catalog:${digest(body).slice(7)}`) throw new Error('CATALOG_ID_MISMATCH')
  const ids = new Set<string>()
  for (const plugin of catalog.plugins) {
    if (ids.has(plugin.pluginId)) throw new Error('DUPLICATE_PLUGIN_ID')
    ids.add(plugin.pluginId)
    const releases = new Set(plugin.availableReleases.map((release) => release.releaseId))
    if (releases.size !== plugin.availableReleases.length || !releases.has(plugin.currentReleaseId))
      throw new Error('RELEASE_SELECTION_INVALID')
  }
  for (const plugin of catalog.plugins)
    for (const release of plugin.availableReleases) {
      if (requirePortable && release.contentResolution !== 'complete')
        throw new Error('COMPLETE_SOURCE_REQUIRED')
      const descriptor = release.releaseMetadata[PACKAGE_METADATA_KEY]
      if (descriptor === undefined) {
        if (requirePortable && release.contentResolution === 'complete')
          throw new Error(`PORTABLE_RESYNC_REQUIRED: ${plugin.pluginId}`)
        continue
      }
      const pkg = verifyAgentPackage(descriptor)
      if (
        release.contentResolution !== 'complete' ||
        pkg.sourceDigest !== release.canonicalContentDigest
      )
        throw new Error(`PACKAGE_PROVENANCE_MISMATCH: ${plugin.pluginId}`)
      const sourcePaths = new Set(release.fileIndex)
      for (const file of pkg.files)
        if (file.action === 'copy' && !sourcePaths.has(file.sourcePath))
          throw new Error(`PACKAGE_SOURCE_FILE_MISSING: ${plugin.pluginId}`)
    }
}
