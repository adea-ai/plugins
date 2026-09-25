export const publishedArtifactNames = [
  'catalog.v1.json',
  'catalog-summary.v1.json',
  'categories.v1.json',
  'compatibility.v1.json',
  'integrity.json',
  'sources.lock.json',
] as const

export type PublishedArtifactName = (typeof publishedArtifactNames)[number]

export interface PublicationPlan {
  readonly releaseTag: string
  readonly latestAssetName: 'catalog-latest.v1.json'
  readonly latestAssetUrl: string
  readonly immutableCatalogUrl: string
  readonly artifactNames: readonly PublishedArtifactName[]
  readonly bootstrapRequired: boolean
}

/** One asset a release already carries, as the release API reports it. */
export interface ReleaseAssetState {
  readonly name: string
  /** `sha256:<hex>` over the published bytes; absent on older API responses. */
  readonly digest?: string
  readonly bytes?: number
}

/** One asset this build declares, with the digest of the bytes it staged. */
export interface DeclaredAsset {
  readonly name: string
  readonly digest: string
  readonly bytes: number
}

export interface ReleaseAssetAudit {
  /**
   * Whether the inspected release is the one this build's identity names.
   * Anything else is a comparison across two identities, which can never agree
   * and must never be repaired.
   */
  readonly identity: 'absent' | 'matches' | 'different'
  /** Declared assets the release does not carry at all. */
  readonly missing: readonly string[]
  /** Declared assets whose published bytes differ from this build's bytes. */
  readonly divergent: readonly string[]
  /** Declared assets whose published bytes the release API cannot state. */
  readonly unverifiable: readonly string[]
  /** Assets the release carries that this build does not declare. */
  readonly extra: readonly string[]
  /** Assets a draft release must (re)upload to match this build. */
  readonly upload: readonly string[]
  /** Assets a draft release must drop because this build does not declare them. */
  readonly remove: readonly string[]
  /**
   * Why the release cannot be brought into agreement, when it cannot. A
   * published release is immutable, so a disagreement found there is not
   * repairable in place and publication must stop instead of promoting it.
   */
  readonly blocked?: string
  /** True when the release already carries exactly this build's bytes. */
  readonly agrees: boolean
}

/**
 * Audits a release against the artifacts this build staged.
 *
 * A release tag is derived from the catalog identity, so the only release a
 * build may compare itself against is the one its own `catalogId` names.
 * "Already uploaded" is not evidence of correctness: an asset that is present
 * can still carry another build's bytes, and a published release is immutable,
 * so a disagreement has to be found *before* the draft is promoted. Uploading
 * only what is absent would leave exactly that defect in place.
 */
export function auditReleaseAssets(input: {
  readonly catalogId: string
  readonly releaseTag: string
  readonly releaseIsDraft?: boolean
  readonly releaseAssets?: readonly ReleaseAssetState[]
  readonly declared: readonly DeclaredAsset[]
}): ReleaseAssetAudit {
  const match = /^catalog:([a-f0-9]{64})$/.exec(input.catalogId)
  if (!match) throw new Error(`CATALOG_ID_INVALID: ${input.catalogId}`)
  const empty = {
    missing: [] as string[],
    divergent: [] as string[],
    unverifiable: [] as string[],
    extra: [] as string[],
    upload: [] as string[],
    remove: [] as string[],
    agrees: false,
  }
  if (input.releaseAssets === undefined) return { identity: 'absent', ...empty }
  if (input.releaseTag !== `catalog/${match[1]}`)
    return {
      identity: 'different',
      ...empty,
      blocked: `release ${input.releaseTag} does not belong to ${input.catalogId}; refusing to compare or repair across catalog identities`,
    }
  const present = new Map(input.releaseAssets.map((asset) => [asset.name, asset]))
  const declared = new Map(input.declared.map((asset) => [asset.name, asset]))
  const missing: string[] = []
  const divergent: string[] = []
  const unverifiable: string[] = []
  for (const asset of input.declared) {
    const published = present.get(asset.name)
    if (published === undefined) {
      missing.push(asset.name)
      continue
    }
    if (published.digest === undefined) {
      unverifiable.push(asset.name)
      continue
    }
    if (
      published.digest !== asset.digest ||
      (published.bytes !== undefined && published.bytes !== asset.bytes)
    )
      divergent.push(asset.name)
  }
  const extra = input.releaseAssets
    .map((asset) => asset.name)
    .filter((name) => !declared.has(name))
    .toSorted()
  const disagrees = missing.length + divergent.length + unverifiable.length + extra.length > 0
  const isDraft = input.releaseIsDraft === true
  return {
    identity: 'matches',
    missing: missing.toSorted(),
    divergent: divergent.toSorted(),
    unverifiable: unverifiable.toSorted(),
    extra,
    // A draft is the only release GitHub lets an upload change, so the repair
    // lists stay empty everywhere else and `blocked` explains the refusal.
    upload: isDraft ? [...missing, ...divergent, ...unverifiable].toSorted() : [],
    remove: isDraft ? extra : [],
    ...(disagrees && !isDraft
      ? {
          blocked: `published release ${input.releaseTag} is immutable but does not carry this build's bytes (missing: ${missing.length}, divergent: ${divergent.length}, unverifiable: ${unverifiable.length}, extra: ${extra.length}); the tag is immutable, so the catalog cannot be repaired in place and a new catalog identity is required before publication`,
        }
      : {}),
    agrees: !disagrees,
  }
}

export function createPublicationPlan(input: {
  readonly repositoryUrl: string
  readonly catalogId: string
  readonly existingReleaseAssets?: readonly string[]
}): PublicationPlan {
  const match = /^catalog:([a-f0-9]{64})$/.exec(input.catalogId)
  if (!match) throw new Error(`CATALOG_ID_INVALID: ${input.catalogId}`)
  const repository = repositorySlug(input.repositoryUrl)
  const releaseTag = `catalog/${match[1]}`
  const latestAssetName = 'catalog-latest.v1.json' as const
  const existingAssets = new Set(input.existingReleaseAssets ?? [])
  return {
    releaseTag,
    latestAssetName,
    latestAssetUrl: `https://github.com/${repository}/releases/latest/download/${latestAssetName}`,
    immutableCatalogUrl: `https://github.com/${repository}/releases/download/${releaseTag}/catalog.v1.json`,
    artifactNames: publishedArtifactNames,
    bootstrapRequired: publishedArtifactNames.some((name) => !existingAssets.has(name)),
  }
}

/**
 * Immutable URL for one release asset of a catalog.
 *
 * The tag is derived from the catalog identity, so this URL never changes for a
 * given catalog and can be cached forever. Deployments that cannot serve the
 * release host directly publish the same asset names behind their own base and
 * substitute it here.
 */
export function immutableAssetUrl(
  repositoryUrl: string,
  catalogId: string,
  assetName: string
): string {
  const match = /^catalog:([a-f0-9]{64})$/.exec(catalogId)
  if (!match) throw new Error(`CATALOG_ID_INVALID: ${catalogId}`)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(assetName))
    throw new Error(`ASSET_NAME_INVALID: ${assetName}`)
  return `https://github.com/${repositorySlug(repositoryUrl)}/releases/download/catalog/${match[1]}/${assetName}`
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
