import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Catalog } from '@adea-ai/catalog-schema'
import { byteDigest, type PublishedAsset } from './index.js'
import { iconAssetName, inspectIconBytes, type IconContentType } from './icons.js'
import type { ConsumerIndex } from './consumer-index.js'

/**
 * Where an icon's bytes come from, so a mirror needs no tree walk and no
 * rediscovery: `content` refetches a file at the pinned commit, `favicon`
 * refetches the site icon the catalog recorded.
 */
export type IconSource =
  | {
      readonly kind: 'content'
      readonly asset: string
      readonly digest: string
      readonly bytes: number
      readonly contentType: IconContentType
      readonly repositoryUrl: string
      readonly commitSha: string
      readonly pluginSubdirectory: string
      /** Path relative to `pluginSubdirectory`, as recorded in the catalog. */
      readonly path: string
      /** Path including the plugin subdirectory, for a raw content fetch. */
      readonly sourcePath: string
    }
  | {
      readonly kind: 'favicon'
      readonly asset: string
      readonly digest: string
      readonly bytes: number
      readonly contentType: IconContentType
      readonly url: string
      readonly homepage: string
    }

export interface IconMirrorResult {
  /** Icons whose verified bytes are present in the assets directory. */
  readonly staged: readonly PublishedAsset[]
  /** Icons that could not be staged, with the reason, never silently dropped. */
  readonly skipped: readonly { readonly asset: string; readonly reason: string }[]
}

/**
 * Maps every mirrored icon back to the exact commit it was resolved from, by
 * matching the digest the product advertises. Canonical variants are inspected
 * first, mirroring the order product records were built in.
 */
export function resolveIconSources(
  catalog: Pick<Catalog, 'plugins'>,
  index: ConsumerIndex
): readonly IconSource[] {
  const byAsset = new Map<string, IconSource>()
  for (const plugin of catalog.plugins) {
    for (const release of plugin.availableReleases) {
      const icon = release.icon
      if (!icon) continue
      const asset = iconAssetName(icon.digest, icon.contentType)
      if (byAsset.has(asset)) continue
      if (icon.kind === 'favicon') {
        byAsset.set(asset, {
          kind: 'favicon',
          asset,
          digest: icon.digest,
          bytes: icon.bytes,
          contentType: icon.contentType,
          url: icon.url,
          homepage: icon.homepage,
        })
        continue
      }
      const subdirectory =
        release.pluginSubdirectory && release.pluginSubdirectory !== '.'
          ? release.pluginSubdirectory
          : ''
      byAsset.set(asset, {
        kind: 'content',
        asset,
        digest: icon.digest,
        bytes: icon.bytes,
        contentType: icon.contentType,
        repositoryUrl: release.resolvedRepositoryUrl,
        commitSha: release.resolvedCommitSha,
        pluginSubdirectory: subdirectory,
        path: icon.path,
        sourcePath: subdirectory ? `${subdirectory}/${icon.path}` : icon.path,
      })
    }
  }
  const sources: IconSource[] = []
  for (const product of Object.values(index.products)) {
    const icon = product.icon
    if (!icon) continue
    const source = byAsset.get(icon.asset)
    if (source) sources.push(source)
  }
  return sources.toSorted((left, right) => left.asset.localeCompare(right.asset))
}

/**
 * Writes mirrored icon bytes beside the published artifacts.
 *
 * Bytes are verified against the digest the catalog advertises before they are
 * staged, so a mirror can never publish content that differs from what the
 * index promised. Staging never overwrites a differing file: content-addressed
 * names make an existing file either identical or a build error.
 */
export async function stageIconAssets(input: {
  readonly sources: readonly IconSource[]
  readonly assetsDirectory: string
  /** Reads the icon bytes for a source; live fetches raw content, offline reads fixtures. */
  readonly readBytes: (source: IconSource) => Promise<Uint8Array>
}): Promise<IconMirrorResult> {
  const staged: PublishedAsset[] = []
  const skipped: { asset: string; reason: string }[] = []
  await fs.mkdir(input.assetsDirectory, { recursive: true })
  for (const source of input.sources) {
    const destination = join(input.assetsDirectory, source.asset)
    const existing = await fs.readFile(destination).catch(() => undefined)
    if (existing && byteDigest(existing) === source.digest) {
      staged.push(publishedAssetOf(source))
      continue
    }
    if (existing) {
      skipped.push({ asset: source.asset, reason: 'ASSET_CONFLICT' })
      continue
    }
    let bytes: Uint8Array
    try {
      bytes = await input.readBytes(source)
    } catch (error) {
      skipped.push({
        asset: source.asset,
        reason: `FETCH_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      })
      continue
    }
    const inspected = inspectIconBytes(bytes)
    if (!('contentType' in inspected)) {
      skipped.push({ asset: source.asset, reason: inspected.rejected })
      continue
    }
    if (inspected.contentType !== source.contentType) {
      skipped.push({ asset: source.asset, reason: 'CONTENT_TYPE_CHANGED' })
      continue
    }
    if (byteDigest(bytes) !== source.digest || bytes.byteLength !== source.bytes) {
      skipped.push({ asset: source.asset, reason: 'DIGEST_MISMATCH' })
      continue
    }
    await fs.mkdir(dirname(destination), { recursive: true })
    await fs.writeFile(destination, bytes)
    staged.push(publishedAssetOf(source))
  }
  // Distinct assets: two products can share one mark, and the catalog declares
  // each asset once.
  return { staged: dedupeAssets(staged), skipped }
}

function dedupeAssets(assets: readonly PublishedAsset[]): readonly PublishedAsset[] {
  const unique = new Map<string, PublishedAsset>()
  for (const asset of assets) unique.set(asset.name, asset)
  return [...unique.values()]
}

function publishedAssetOf(source: IconSource): PublishedAsset {
  return {
    name: source.asset,
    digest: source.digest,
    bytes: source.bytes,
    contentType: source.contentType,
    kind: source.kind,
    origin: source.kind === 'content' ? source.sourcePath : source.url,
  }
}

/**
 * Writes one verified icon into the assets directory.
 *
 * The build already holds the exact bytes it recorded a digest for, so staging
 * them here removes the re-fetch a later mirror would need. That matters for
 * site icons: their URL is not content-addressed, so a vendor can change the
 * file between resolution and publication.
 */
export async function stageIconBytes(
  assetsDirectory: string,
  asset: string,
  bytes: Uint8Array
): Promise<void> {
  const destination = join(assetsDirectory, asset)
  const existing = await fs.readFile(destination).catch(() => undefined)
  if (existing && byteDigest(existing) === byteDigest(bytes)) return
  await fs.mkdir(dirname(destination), { recursive: true })
  await fs.writeFile(destination, bytes)
}
