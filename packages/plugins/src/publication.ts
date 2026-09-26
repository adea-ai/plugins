/**
 * Where a published catalog lives, and the URLs that address it.
 *
 * The catalog is published to the `catalog-assets` branch rather than to a
 * GitHub Release. That is what lets the repository's Releases carry a plain
 * `vX.Y.Z` version and stay readable: GitHub marks exactly one release
 * "latest", and a content-addressed catalog that has to be discoverable through
 * `releases/latest/download/…` permanently outbids every versioned release for
 * that slot, so no version is ever the one a visitor sees first.
 *
 * The branch gives each catalog an immutable path — `catalogs/<catalogId>/…`,
 * where `catalogId` is the canonical digest of the catalog itself — so a
 * pinned URL is immutable by construction, exactly as a content-addressed
 * release tag was, and `raw.githubusercontent.com` serves it with permissive
 * CORS so a browser can fetch it directly.
 */

export const publishedArtifactNames = [
  'catalog.v1.json',
  'catalog-summary.v1.json',
  'categories.v1.json',
  'compatibility.v1.json',
  'integrity.json',
  'sources.lock.json',
] as const

export type PublishedArtifactName = (typeof publishedArtifactNames)[number]

/** The branch every catalog snapshot and mirrored brand mark is published to. */
export const catalogAssetsBranch = 'catalog-assets' as const

/** Directory under the branch holding one immutable snapshot per catalog. */
export const catalogSnapshotDirectory = 'catalogs' as const

/**
 * The mutable pointer, byte-identical to the current snapshot's
 * `catalog.v1.json`. It is the only catalog path that changes after a
 * publication, so consumers must treat it as a short-TTL cache entry and
 * resolve everything else from the `catalogId` it names.
 */
export const latestPointerName = 'catalog-latest.v1.json' as const

/** One artifact this build declares, with the digest of the bytes it staged. */
export interface DeclaredAsset {
  readonly name: string
  readonly digest: string
  readonly bytes: number
}

export interface StagedAssetAudit {
  /** Declared assets this build has no staged bytes for. */
  readonly unstaged: readonly string[]
  /**
   * Why the snapshot cannot be published, when it cannot. A checkout that
   * cannot supply the declared bytes cannot publish a snapshot from them
   * either, and a declaration is not a substitute for them.
   */
  readonly blocked?: string
  /** True when every declared asset has staged bytes behind it. */
  readonly agrees: boolean
}

/**
 * Audits the bytes this build staged against what it declared.
 *
 * A content-addressed path removes the comparison the release audit used to
 * perform: a snapshot published at `catalogs/<catalogId>/` can only hold this
 * catalog's bytes, because any different build has a different `catalogId` and
 * therefore a different path. What survives is the check that cannot be
 * delegated to the path — that the bytes exist here at all.
 */
export function auditStagedAssets(input: {
  readonly declared: readonly DeclaredAsset[]
  readonly unstaged?: readonly string[]
}): StagedAssetAudit {
  const unstaged = [...new Set(input.unstaged ?? [])].toSorted()
  if (unstaged.length > 0)
    return {
      unstaged,
      blocked: `this checkout has no staged bytes for ${unstaged.length} declared asset(s) (${unstaged.slice(0, 3).join(', ')}${unstaged.length > 3 ? ', …' : ''}); stage them with \`bun run catalog mirror-icons\` or publish from a snapshot that carries them, because a snapshot cannot be checked against a declaration alone`,
      agrees: false,
    }
  return { unstaged: [], agrees: true }
}

export interface PublicationPlan {
  /** Branch-relative directory holding this catalog's immutable artifacts. */
  readonly snapshotPath: string
  readonly latestPointerName: typeof latestPointerName
  readonly latestPointerUrl: string
  readonly immutableCatalogUrl: string
  readonly artifactNames: readonly PublishedArtifactName[]
}

/**
 * The 64-hex digest a `catalog:<hex>` identity is addressed by.
 *
 * A catalog identity names its own bytes, so this is also what makes the
 * snapshot path immutable: any build that produced different content has a
 * different identity and cannot write over this one.
 */
export function catalogIdSuffix(catalogId: string): string {
  const match = /^catalog:([a-f0-9]{64})$/.exec(catalogId)
  if (!match) throw new Error(`CATALOG_ID_INVALID: ${catalogId}`)
  return match[1] as string
}

/**
 * Root of the branch that carries mirrored brand marks and the mutable
 * catalog pointer.
 */
export function catalogAssetsBaseUrl(repositoryUrl: string): string {
  return `https://raw.githubusercontent.com/${repositorySlug(repositoryUrl)}/${catalogAssetsBranch}`
}

/** Root of one catalog's immutable artifacts, content-addressed by identity. */
export function catalogSnapshotBaseUrl(repositoryUrl: string, catalogId: string): string {
  return `${catalogAssetsBaseUrl(repositoryUrl)}/${catalogSnapshotDirectory}/${catalogIdSuffix(catalogId)}`
}

/** The mutable pointer, re-pointed at the newest catalog on every publication. */
export function latestPointerUrl(repositoryUrl: string): string {
  return `${catalogAssetsBaseUrl(repositoryUrl)}/${latestPointerName}`
}

export function createPublicationPlan(input: {
  readonly repositoryUrl: string
  readonly catalogId: string
}): PublicationPlan {
  const base = catalogSnapshotBaseUrl(input.repositoryUrl, input.catalogId)
  return {
    snapshotPath: `${catalogSnapshotDirectory}/${catalogIdSuffix(input.catalogId)}`,
    latestPointerName,
    latestPointerUrl: latestPointerUrl(input.repositoryUrl),
    immutableCatalogUrl: `${base}/catalog.v1.json`,
    artifactNames: publishedArtifactNames,
  }
}

/**
 * Immutable URL for one artifact of one catalog.
 *
 * The path is derived from the catalog identity, so this URL never changes for
 * a given catalog and can be cached forever. Deployments that cannot serve the
 * branch host directly publish the same artifact names behind their own base
 * and substitute it for `catalogAssetsBaseUrl`.
 */
export function immutableAssetUrl(
  repositoryUrl: string,
  catalogId: string,
  assetName: string
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(assetName))
    throw new Error(`ASSET_NAME_INVALID: ${assetName}`)
  return `${catalogSnapshotBaseUrl(repositoryUrl, catalogId)}/${assetName}`
}

function repositorySlug(repositoryUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(repositoryUrl)
  } catch {
    throw new Error(`REPOSITORY_URL_INVALID: ${repositoryUrl}`)
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com')
    throw new Error(`REPOSITORY_URL_UNSUPPORTED: ${repositoryUrl}`)
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path))
    throw new Error(`REPOSITORY_URL_INVALID: ${repositoryUrl}`)
  return path
}
