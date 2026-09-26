import { describe, expect, test } from 'bun:test'
import {
  auditStagedAssets,
  catalogAssetsBaseUrl,
  catalogIdSuffix,
  catalogSnapshotBaseUrl,
  createPublicationPlan,
  immutableAssetUrl,
  latestPointerUrl,
  publishedArtifactNames,
} from './publication.js'

const repositoryUrl = 'https://github.com/adea-ai/plugins'
const catalogId = `catalog:${'c'.repeat(64)}`
const catalogAsset = { name: 'catalog.v1.json', digest: `sha256:${'1'.repeat(64)}`, bytes: 10 }

describe('catalog identity', () => {
  test('a catalog identity addresses itself by its own digest', () => {
    expect(catalogIdSuffix(catalogId)).toBe('c'.repeat(64))
  })

  test('an identity that is not a digest is refused', () => {
    expect(() => catalogIdSuffix('catalog:not-a-digest')).toThrow('CATALOG_ID_INVALID')
    expect(() => catalogIdSuffix(`catalog:${'C'.repeat(64)}`)).toThrow('CATALOG_ID_INVALID')
    expect(() => catalogIdSuffix(`catalog:${'c'.repeat(63)}`)).toThrow('CATALOG_ID_INVALID')
  })
})

describe('catalog publication addresses', () => {
  test('snapshots are content-addressed on the catalog-assets branch', () => {
    expect(catalogAssetsBaseUrl(repositoryUrl)).toBe(
      'https://raw.githubusercontent.com/adea-ai/plugins/catalog-assets'
    )
    expect(catalogSnapshotBaseUrl(repositoryUrl, catalogId)).toBe(
      `https://raw.githubusercontent.com/adea-ai/plugins/catalog-assets/catalogs/${'c'.repeat(64)}`
    )
  })

  test('the pointer is the only mutable path and it sits at the branch root', () => {
    expect(latestPointerUrl(repositoryUrl)).toBe(
      'https://raw.githubusercontent.com/adea-ai/plugins/catalog-assets/catalog-latest.v1.json'
    )
  })

  test('a snapshot path is stable for its catalog, so a pinned URL caches forever', () => {
    const first = immutableAssetUrl(repositoryUrl, catalogId, 'catalog.v1.json')
    const second = immutableAssetUrl(`${repositoryUrl}.git`, catalogId, 'catalog.v1.json')
    expect(first).toBe(second)
    expect(first).toBe(
      `https://raw.githubusercontent.com/adea-ai/plugins/catalog-assets/catalogs/${'c'.repeat(64)}/catalog.v1.json`
    )
  })

  test('a different catalog never addresses the same path', () => {
    expect(immutableAssetUrl(repositoryUrl, catalogId, 'catalog.v1.json')).not.toBe(
      immutableAssetUrl(repositoryUrl, `catalog:${'d'.repeat(64)}`, 'catalog.v1.json')
    )
  })

  test('an asset name that could escape the snapshot directory is refused', () => {
    expect(() => immutableAssetUrl(repositoryUrl, catalogId, '../secrets.json')).toThrow(
      'ASSET_NAME_INVALID'
    )
    expect(() => immutableAssetUrl(repositoryUrl, catalogId, 'a/b.json')).toThrow(
      'ASSET_NAME_INVALID'
    )
  })

  test('only a GitHub repository can be addressed', () => {
    expect(() => catalogAssetsBaseUrl('https://example.com/adea-ai/plugins')).toThrow(
      'REPOSITORY_URL_UNSUPPORTED'
    )
    expect(() => catalogAssetsBaseUrl('not a url')).toThrow('REPOSITORY_URL_INVALID')
    expect(() => catalogAssetsBaseUrl('https://github.com/adea-ai')).toThrow(
      'REPOSITORY_URL_INVALID'
    )
  })

  test('the plan names the branch paths a publication has to write', () => {
    const plan = createPublicationPlan({ repositoryUrl, catalogId: `catalog:${'a'.repeat(64)}` })
    expect(plan.snapshotPath).toBe(`catalogs/${'a'.repeat(64)}`)
    expect(plan.latestPointerName).toBe('catalog-latest.v1.json')
    expect(plan.latestPointerUrl).toBe(latestPointerUrl(repositoryUrl))
    expect(plan.immutableCatalogUrl).toBe(
      immutableAssetUrl(repositoryUrl, `catalog:${'a'.repeat(64)}`, 'catalog.v1.json')
    )
    expect(plan.artifactNames).toEqual(publishedArtifactNames)
  })
})

describe('staged asset audit', () => {
  test('declared bytes this build has are publishable', () => {
    const audit = auditStagedAssets({ declared: [catalogAsset] })
    expect(audit.agrees).toBe(true)
    expect(audit.unstaged).toEqual([])
    expect(audit.blocked).toBeUndefined()
  })

  test('a declared asset this build cannot stage is never taken on its word', () => {
    const audit = auditStagedAssets({
      declared: [catalogAsset, { name: 'icon-unstaged.png', digest: 'sha256:x', bytes: 5 }],
      unstaged: ['icon-unstaged.png'],
    })
    expect(audit.unstaged).toEqual(['icon-unstaged.png'])
    expect(audit.agrees).toBe(false)
    expect(audit.blocked).toContain('no staged bytes')
    expect(audit.blocked).toContain('mirror-icons')
  })

  test('the same unstaged name twice is one problem', () => {
    const audit = auditStagedAssets({
      declared: [catalogAsset],
      unstaged: ['icon-unstaged.png', 'icon-unstaged.png'],
    })
    expect(audit.unstaged).toEqual(['icon-unstaged.png'])
  })
})
