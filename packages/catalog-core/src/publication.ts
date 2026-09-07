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
