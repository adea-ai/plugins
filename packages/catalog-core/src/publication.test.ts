import { describe, expect, test } from 'bun:test'
import { createPublicationPlan, publishedArtifactNames } from './publication.js'

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
