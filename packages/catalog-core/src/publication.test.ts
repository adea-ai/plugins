import { describe, expect, test } from 'bun:test'
import { auditReleaseAssets, createPublicationPlan, publishedArtifactNames } from './publication.js'

const catalogId = `catalog:${'c'.repeat(64)}`
const releaseTag = `catalog/${'c'.repeat(64)}`
const catalogAsset = { name: 'catalog.v1.json', digest: `sha256:${'1'.repeat(64)}`, bytes: 10 }
const latestAsset = {
  name: 'catalog-latest.v1.json',
  digest: `sha256:${'2'.repeat(64)}`,
  bytes: 20,
}

describe('catalog publication contract', () => {
  test('bootstrap requires a release when no immutable assets exist', () => {
    const plan = createPublicationPlan({
      repositoryUrl: 'https://github.com/adea-ai/plugins',
      catalogId: `catalog:${'a'.repeat(64)}`,
    })
    expect(plan.bootstrapRequired).toBe(true)
    expect(plan.releaseTag).toBe(`catalog/${'a'.repeat(64)}`)
    expect(plan.latestAssetUrl).toBe(
      'https://github.com/adea-ai/plugins/releases/latest/download/catalog-latest.v1.json'
    )
    expect(plan.immutableCatalogUrl).toBe(
      `https://github.com/adea-ai/plugins/releases/download/catalog/${'a'.repeat(64)}/catalog.v1.json`
    )
  })

  test('a complete release asset set is not reclassified as bootstrap work', () => {
    const plan = createPublicationPlan({
      repositoryUrl: 'https://github.com/adea-ai/plugins.git',
      catalogId: `catalog:${'b'.repeat(64)}`,
      existingReleaseAssets: [...publishedArtifactNames],
    })
    expect(plan.bootstrapRequired).toBe(false)
    expect(plan.artifactNames).toEqual(publishedArtifactNames)
  })
})

describe('release asset audit', () => {
  test('an absent release is bootstrap work, never a repair', () => {
    const audit = auditReleaseAssets({ catalogId, releaseTag, declared: [catalogAsset] })
    expect(audit.identity).toBe('absent')
    expect(audit.agrees).toBe(false)
    expect(audit.blocked).toBeUndefined()
    expect(audit.upload).toEqual([])
  })

  test('a release named by another identity is refused, not compared', () => {
    const audit = auditReleaseAssets({
      catalogId,
      releaseTag: `catalog/${'d'.repeat(64)}`,
      releaseIsDraft: true,
      releaseAssets: [{ name: 'catalog.v1.json' }],
      declared: [catalogAsset],
    })
    expect(audit.identity).toBe('different')
    expect(audit.upload).toEqual([])
    expect(audit.blocked).toContain('does not belong')
  })

  test('a draft is repaired when a present asset carries other bytes', () => {
    const audit = auditReleaseAssets({
      catalogId,
      releaseTag,
      releaseIsDraft: true,
      releaseAssets: [
        { name: 'catalog.v1.json', digest: `sha256:${'9'.repeat(64)}`, bytes: 10 },
        { name: 'catalog-latest.v1.json', digest: latestAsset.digest, bytes: 20 },
      ],
      declared: [catalogAsset, latestAsset],
    })
    expect(audit.identity).toBe('matches')
    expect(audit.divergent).toEqual(['catalog.v1.json'])
    expect(audit.upload).toEqual(['catalog.v1.json'])
    expect(audit.agrees).toBe(false)
    expect(audit.blocked).toBeUndefined()
  })

  test('a byte length that disagrees is divergent even when the digest matches', () => {
    const audit = auditReleaseAssets({
      catalogId,
      releaseTag,
      releaseIsDraft: true,
      releaseAssets: [
        { name: 'catalog.v1.json', digest: catalogAsset.digest, bytes: 11 },
        { name: 'catalog-latest.v1.json', digest: latestAsset.digest, bytes: 20 },
      ],
      declared: [catalogAsset, latestAsset],
    })
    expect(audit.divergent).toEqual(['catalog.v1.json'])
  })

  test('a draft missing a declared asset uploads it and drops what it must not carry', () => {
    const audit = auditReleaseAssets({
      catalogId,
      releaseTag,
      releaseIsDraft: true,
      releaseAssets: [
        { name: 'catalog.v1.json', digest: catalogAsset.digest, bytes: 10 },
        { name: 'catalog-latest.v1.json', digest: latestAsset.digest, bytes: 20 },
        { name: 'icon-stale.png', digest: `sha256:${'8'.repeat(64)}`, bytes: 5 },
      ],
      declared: [
        catalogAsset,
        latestAsset,
        { name: 'icon-new.png', digest: `sha256:${'7'.repeat(64)}`, bytes: 1 },
      ],
    })
    expect(audit.missing).toEqual(['icon-new.png'])
    expect(audit.extra).toEqual(['icon-stale.png'])
    expect(audit.upload).toEqual(['icon-new.png'])
    expect(audit.remove).toEqual(['icon-stale.png'])
  })

  test('an asset whose published digest the API cannot state is re-uploaded, not trusted', () => {
    const audit = auditReleaseAssets({
      catalogId,
      releaseTag,
      releaseIsDraft: true,
      releaseAssets: [{ name: 'catalog.v1.json', bytes: 10 }],
      declared: [catalogAsset],
    })
    expect(audit.unverifiable).toEqual(['catalog.v1.json'])
    expect(audit.upload).toEqual(['catalog.v1.json'])
  })

  test('a published release that already carries this build agrees and needs no edit', () => {
    const audit = auditReleaseAssets({
      catalogId,
      releaseTag,
      releaseIsDraft: false,
      releaseAssets: [
        { name: 'catalog.v1.json', digest: catalogAsset.digest, bytes: 10 },
        { name: 'catalog-latest.v1.json', digest: latestAsset.digest, bytes: 20 },
      ],
      declared: [catalogAsset, latestAsset],
    })
    expect(audit.agrees).toBe(true)
    expect(audit.blocked).toBeUndefined()
    expect(audit.upload).toEqual([])
  })

  test('a published release that disagrees stops publication instead of being promoted', () => {
    const audit = auditReleaseAssets({
      catalogId,
      releaseTag,
      releaseIsDraft: false,
      releaseAssets: [
        { name: 'catalog.v1.json', digest: `sha256:${'9'.repeat(64)}`, bytes: 10 },
        { name: 'catalog-latest.v1.json', digest: latestAsset.digest, bytes: 20 },
      ],
      declared: [catalogAsset, latestAsset],
    })
    expect(audit.agrees).toBe(false)
    expect(audit.upload).toEqual([])
    expect(audit.remove).toEqual([])
    expect(audit.blocked).toContain('immutable')
    expect(audit.blocked).toContain('new catalog identity')
  })

  test('a declared asset this build cannot stage is never taken on its word', () => {
    const audit = auditReleaseAssets({
      catalogId,
      releaseTag,
      releaseIsDraft: true,
      releaseAssets: [
        { name: 'catalog.v1.json', digest: catalogAsset.digest, bytes: 10 },
        { name: 'icon-unstaged.png', digest: `sha256:${'5'.repeat(64)}`, bytes: 5 },
      ],
      declared: [
        catalogAsset,
        { name: 'icon-unstaged.png', digest: `sha256:${'5'.repeat(64)}`, bytes: 5 },
      ],
      unstaged: ['icon-unstaged.png'],
    })
    expect(audit.unstaged).toEqual(['icon-unstaged.png'])
    expect(audit.agrees).toBe(false)
    // Nothing to re-upload: the bytes are not in this checkout.
    expect(audit.upload).toEqual([])
    expect(audit.blocked).toContain('no staged bytes')
    expect(audit.blocked).toContain('mirror-icons')
  })
})
