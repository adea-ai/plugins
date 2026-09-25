import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import type { Catalog, Plugin } from '../../catalog-schema/src/index.js'
import { byteDigest, createArtifacts, verifyArtifacts, verifyConsumerIndex } from './index.js'
import { buildConsumerIndex, type ConsumerIndex } from './consumer-index.js'
import { resolveIconSources, stageIconAssets, type IconSource } from './icon-mirror.js'
import { iconAssetName } from './icons.js'

const CLEAN_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>'
)
const OTHER_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><circle r="2"/></svg>'
)
const svgDigest = byteDigest(CLEAN_SVG)
const svgAsset = iconAssetName(svgDigest, 'image/svg+xml')

const SHA = 'a'.repeat(40)
const DIGEST = `sha256:${'d'.repeat(64)}`

/** A schema-valid plugin, so the artifact verifier is exercised for real. */
function plugin(input: {
  sourceId: string
  name: string
  categories: string[]
  icon?: { path: string; bytes: Uint8Array }
  repositoryUrl?: string
  commitSha?: string
  subdirectory?: string
}): Plugin {
  const repositoryUrl = input.repositoryUrl ?? `https://github.com/${input.sourceId}/marketplace`
  const icon = input.icon
  const releaseId = `release:${'e'.repeat(64)}`
  return {
    pluginId: `plugin:${input.sourceId}:${input.name}`,
    displayName: input.name,
    description: `${input.name} description`,
    productGroupingKey: input.name,
    categories: input.categories,
    keywords: [input.name],
    authors: ['Test'],
    icons: [],
    sourceId: input.sourceId,
    upstreamPluginName: input.name,
    currentReleaseId: releaseId,
    availableReleases: [
      {
        releaseId,
        resolvedRepositoryUrl: repositoryUrl,
        resolvedCommitSha: input.commitSha ?? SHA,
        pluginSubdirectory: input.subdirectory ?? '.',
        canonicalContentDigest: DIGEST,
        manifestDigest: DIGEST,
        contentResolution: 'complete',
        releaseMetadata: {},
        capabilities: [],
        requiredConnectors: [],
        requiredCredentials: [],
        permissionSensitiveChanges: [],
        fileIndex: icon ? [icon.path] : [],
        publicationTimestamp: '2026-01-01T00:00:00.000Z',
        ...(icon
          ? {
              icon: {
                kind: 'content',
                path: icon.path,
                contentType: 'image/svg+xml',
                digest: byteDigest(icon.bytes),
                bytes: icon.bytes.byteLength,
              },
            }
          : {}),
      },
    ],
    capabilitySummary: {},
    harnessCompatibility: Object.fromEntries(
      ['codex', 'claude-code', 'cursor', 'pi', 'hermes', 'opencode', 'generic-skill-mcp'].map(
        (harness) => [harness, { status: 'unknown', reasons: [], responsibleCapabilities: [] }]
      )
    ),
    license: { name: 'MIT', source: 'plugin-manifest' },
    provenance: {
      sourceId: input.sourceId,
      repositoryUrl,
      manifestPath: 'marketplace.json',
      pluginSubdirectory: input.subdirectory ?? '.',
      resolvedCommitSha: input.commitSha ?? SHA,
      sourceManifestDigest: DIGEST,
      upstreamEntryDigest: DIGEST,
    },
    securityClassification: {
      level: 'low',
      reasons: [],
      permissionSensitiveChanges: [],
      contentResolution: 'complete',
    },
  } as unknown as Plugin
}

function catalog(plugins: Plugin[]): Catalog {
  return {
    schemaVersion: 1,
    catalogId: `catalog:${'a'.repeat(64)}`,
    generatedAt: '2026-01-01T00:00:00.000Z',
    sources: [...new Set(plugins.map((item) => item.sourceId))].toSorted().map((sourceId) => ({
      sourceId,
      displayName: `${sourceId} source`,
      repositoryUrl: `https://github.com/${sourceId}/marketplace`,
      marketplaceDialect: 'claude' as const,
      manifestPath: 'marketplace.json',
      defaultBranch: 'main',
      resolvedCommitSha: SHA,
      retrievalTimestamp: '2026-01-01T00:00:00.000Z',
      trustClassification: 'official' as const,
      sourceManifestDigest: DIGEST,
      synchronizationStatus: 'synchronized' as const,
    })),
    plugins,
  } as unknown as Catalog
}

const SHA_FOR_LOCK = 'a'.repeat(40)

/** A lock covering the catalog's sources, as `synchronize` would emit. */
function lockFor(plugins: Plugin[]) {
  return {
    schemaVersion: 1 as const,
    lockId: `lock:${'b'.repeat(64)}`,
    sources: [...new Set(plugins.map((item) => item.sourceId))].toSorted().map((sourceId) => ({
      sourceId,
      repositoryUrl: `https://github.com/${sourceId}/marketplace`,
      defaultBranch: 'main',
      resolvedCommitSha: SHA_FOR_LOCK,
      manifestPath: 'marketplace.json',
      marketplaceDialect: 'claude' as const,
      sourceManifestDigest: `sha256:${'d'.repeat(64)}`,
      retrievedAt: '2026-01-01T00:00:00.000Z',
      synchronizationStatus: 'synchronized' as const,
      pluginPins: [],
    })),
  }
}

function artifactsOf(plugins: Plugin[]) {
  const base = catalog(plugins)
  const artifacts = createArtifacts(base, lockFor(plugins) as never, {
    curationDiagnostics: false,
  })
  const index = JSON.parse(artifacts['catalog-index.v1.json']!) as ConsumerIndex
  return { base, artifacts, index }
}

/** A canned reader so mirror tests never touch the network. */
function reader(bytes: Record<string, Uint8Array>) {
  const calls: string[] = []
  return {
    calls,
    read: async (source: IconSource) => {
      const key = source.kind === 'content' ? source.sourcePath : source.url
      calls.push(key)
      const value = bytes[key]
      if (!value) throw new Error(`MISSING: ${key}`)
      return value
    },
  }
}

describe('artifact shards', () => {
  const plugins = [
    plugin({
      sourceId: 'cursor-official',
      name: 'calendar',
      categories: ['productivity'],
      icon: { path: 'assets/logo.svg', bytes: CLEAN_SVG },
    }),
    plugin({ sourceId: 'claude-official', name: 'sales', categories: ['business-operations'] }),
  ]

  test('publishes navigation, one index, and a shelf and list per category', () => {
    const { artifacts } = artifactsOf(plugins)
    const names = Object.keys(artifacts).toSorted()
    expect(names).toEqual([
      'catalog-index.v1.json',
      'catalog-summary.v1.json',
      'catalog.v1.json',
      'categories.v1.json',
      'category-business-operations.v1.json',
      'category-productivity.v1.json',
      'compatibility.v1.json',
      'integrity.json',
      'shelf-business-operations.v1.json',
      'shelf-productivity.v1.json',
      'sources.lock.json',
    ])
    const navigation = JSON.parse(artifacts['categories.v1.json']!)
    expect(navigation.catalogIndexArtifact).toBe('catalog-index.v1.json')
    expect(navigation.categories[0].shelfArtifact).toBe('shelf-business-operations.v1.json')
    expect(navigation.categories[0].listArtifact).toBe('category-business-operations.v1.json')
    // Navigation stays a router: full records live in the shards.
    expect(navigation.products).toBeUndefined()
    expect(navigation.iconCoverage).toMatchObject({ total: 2, content: 1, monogramOnly: 1 })
    expect(navigation.iconCoverage.monogramProductKeys).toEqual(['sales'])
    const shelf = JSON.parse(artifacts['shelf-productivity.v1.json']!)
    expect(shelf.products.map((product: { productKey: string }) => product.productKey)).toEqual([
      'calendar',
    ])
    expect(shelf.products[0].icon).toEqual({
      kind: 'content',
      asset: svgAsset,
      digest: svgDigest,
      contentType: 'image/svg+xml',
      bytes: CLEAN_SVG.byteLength,
      path: 'assets/logo.svg',
      url: null,
      homepage: null,
    })
    // A product without a mark always carries a renderable monogram instead.
    expect(shelf.products[0].monogram.text).toBe('CA')
    const other = JSON.parse(artifacts['catalog-index.v1.json']!).products.sales
    expect(other.icon).toBeNull()
    expect(other.monogram.text).toBe('SA')
  })

  test('advertises an absolute immutable URL when the publication is known', () => {
    const base = catalog([
      plugin({
        sourceId: 'cursor-official',
        name: 'calendar',
        categories: ['productivity'],
        icon: { path: 'assets/logo.svg', bytes: CLEAN_SVG },
      }),
    ])
    const index = buildConsumerIndex({
      catalog: base,
      publicationRepositoryUrl: 'https://github.com/adea-ai/plugins',
    })
    expect(index.products.calendar!.icon!.assetUrl).toBe(
      `https://github.com/adea-ai/plugins/releases/download/catalog/${base.catalogId.slice('catalog:'.length)}/${svgAsset}`
    )
    // An unpublished build advertises no URL rather than a wrong one.
    const unpublished = buildConsumerIndex({ catalog: base })
    expect(unpublished.products.calendar!.icon!.assetUrl).toBeUndefined()
    // A URL that does not point at its own asset is rejected.
    const tampered = {
      ...index,
      products: {
        calendar: {
          ...index.products.calendar!,
          icon: { ...index.products.calendar!.icon!, assetUrl: 'https://evil.example/icon.png' },
        },
      },
    }
    expect(() => verifyConsumerIndex(JSON.stringify(tampered), base)).toThrow(
      'CONSUMER_INDEX_ASSET_URL_INVALID'
    )
  })

  test('carries the install facts of the release a product pins', () => {
    const base = catalog([
      plugin({
        sourceId: 'cursor-official',
        name: 'calendar',
        categories: ['productivity'],
        icon: { path: 'assets/logo.svg', bytes: CLEAN_SVG },
      }),
    ])
    const index = buildConsumerIndex({ catalog: base })
    const product = index.products.calendar!
    expect(product.release).toEqual({
      releaseId: base.plugins[0]!.currentReleaseId,
      canonicalContentDigest: DIGEST,
      contentResolution: 'complete',
      capabilities: [],
      requiredConnectors: [],
      requiredCredentials: [],
      sourceRevision: SHA,
    })
    // A browsing client can plan an install from the index alone.
    expect(product.release.canonicalContentDigest).toBe(
      base.plugins[0]!.availableReleases[0]!.canonicalContentDigest
    )
    // A record whose release facts disagree with the catalog is rejected.
    const tampered = {
      ...index,
      products: {
        calendar: {
          ...product,
          release: { ...product.release, canonicalContentDigest: `sha256:${'f'.repeat(64)}` },
        },
      },
    }
    expect(() => verifyConsumerIndex(JSON.stringify(tampered), base)).toThrow(
      'CONSUMER_INDEX_RELEASE_MISMATCH'
    )
  })

  test('carries compiled marks in the navigation artifact', () => {
    const base = catalog([
      plugin({
        sourceId: 'cursor-official',
        name: 'calendar',
        categories: ['productivity'],
        icon: { path: 'assets/logo.svg', bytes: CLEAN_SVG },
      }),
      plugin({ sourceId: 'claude-official', name: 'sales', categories: ['business-operations'] }),
    ])
    const artifacts = createArtifacts(
      base,
      lockFor([base.plugins[0]!, base.plugins[1]!]) as never,
      {
        curationDiagnostics: false,
        publicationRepositoryUrl: 'https://github.com/adea-ai/plugins',
      }
    )
    const navigation = JSON.parse(artifacts['categories.v1.json']!)
    expect(navigation.catalogIndexUrl).toBe(
      `https://github.com/adea-ai/plugins/releases/download/catalog/${base.catalogId.slice('catalog:'.length)}/catalog-index.v1.json`
    )
    expect(Object.keys(navigation.brandMarks)).toEqual(['calendar'])
    expect(navigation.brandMarks.calendar).toContain(
      `/catalog/${base.catalogId.slice(8)}/${svgAsset}`
    )

    // An unpublished build carries no marks rather than URLs that would not resolve.
    const offline = JSON.parse(
      createArtifacts(base, lockFor([base.plugins[0]!, base.plugins[1]!]) as never, {
        curationDiagnostics: false,
      })['categories.v1.json']!
    )
    expect(offline.brandMarks).toEqual({})
    expect(offline.catalogIndexUrl).toBeUndefined()
  })

  test('declares exactly the mirrored assets the index references', () => {
    const { artifacts, index } = artifactsOf(plugins)
    const integrity = JSON.parse(artifacts['integrity.json']!)
    expect(integrity.assets).toEqual([
      {
        name: svgAsset,
        digest: svgDigest,
        bytes: CLEAN_SVG.byteLength,
        contentType: 'image/svg+xml',
        kind: 'content',
        origin: 'assets/logo.svg',
      },
    ])
    expect(index.products.calendar!.icon!.asset).toBe(svgAsset)
    expect(index.products.sales!.icon).toBeNull()
  })

  test('verifies a consistent release and rejects a tampered shard', () => {
    const { artifacts } = artifactsOf(plugins)
    expect(() => verifyArtifacts(artifacts)).not.toThrow()
    const tampered = {
      ...artifacts,
      'shelf-productivity.v1.json': artifacts['shelf-productivity.v1.json']!.replace(
        'calendar',
        'notion'
      ),
    }
    expect(() => verifyArtifacts(tampered)).toThrow('INTEGRITY_DIGEST_MISMATCH')
  })

  test('rejects a release that drops a shard or an asset declaration', () => {
    const { artifacts } = artifactsOf(plugins)
    const withoutShard = { ...artifacts }
    delete withoutShard['shelf-productivity.v1.json']
    expect(() => verifyArtifacts(withoutShard)).toThrow('INTEGRITY_FILE_SET_MISMATCH')

    const integrity = JSON.parse(artifacts['integrity.json']!)
    const withoutAsset = {
      ...artifacts,
      'integrity.json': JSON.stringify({ ...integrity, assets: [] }),
    }
    expect(() => verifyArtifacts(withoutAsset)).toThrow('INTEGRITY_ASSET_SET_MISMATCH')
  })
})

describe('icon mirroring', () => {
  test('resolves each asset to the commit it was published from', () => {
    const plugins = [
      plugin({
        sourceId: 'cursor-official',
        name: 'calendar',
        categories: ['productivity'],
        icon: { path: 'assets/logo.svg', bytes: CLEAN_SVG },
        repositoryUrl: 'https://github.com/cursor/plugins',
        commitSha: 'c'.repeat(40),
        subdirectory: 'third_party/calendar',
      }),
    ]
    const { base, index } = artifactsOf(plugins)
    expect(resolveIconSources(base, index)).toEqual([
      {
        kind: 'content',
        asset: svgAsset,
        digest: svgDigest,
        bytes: CLEAN_SVG.byteLength,
        contentType: 'image/svg+xml',
        repositoryUrl: 'https://github.com/cursor/plugins',
        commitSha: 'c'.repeat(40),
        pluginSubdirectory: 'third_party/calendar',
        path: 'assets/logo.svg',
        sourcePath: 'third_party/calendar/assets/logo.svg',
      },
    ])
  })

  test('stages verified bytes and is idempotent', async () => {
    const { base, index } = artifactsOf([
      plugin({
        sourceId: 'cursor-official',
        name: 'calendar',
        categories: ['productivity'],
        icon: { path: 'assets/logo.svg', bytes: CLEAN_SVG },
      }),
    ])
    const sources = resolveIconSources(base, index)
    const directory = await mkdtemp(join(tmpdir(), 'adea-icons-'))
    const first = reader({ 'assets/logo.svg': CLEAN_SVG })
    const staged = await stageIconAssets({
      sources,
      assetsDirectory: directory,
      readBytes: first.read,
    })
    expect(staged.skipped).toEqual([])
    expect(staged.staged.map((asset) => asset.name)).toEqual([svgAsset])
    expect(await fs.readFile(join(directory, svgAsset))).toEqual(Buffer.from(CLEAN_SVG))

    // A second pass reads nothing: content-addressed names are already there.
    const second = reader({ 'assets/logo.svg': CLEAN_SVG })
    const again = await stageIconAssets({
      sources,
      assetsDirectory: directory,
      readBytes: second.read,
    })
    expect(second.calls).toEqual([])
    expect(again.staged).toHaveLength(1)
  })

  test('refuses bytes that do not match the advertised digest', async () => {
    const { base, index } = artifactsOf([
      plugin({
        sourceId: 'cursor-official',
        name: 'calendar',
        categories: ['productivity'],
        icon: { path: 'assets/logo.svg', bytes: CLEAN_SVG },
      }),
    ])
    const directory = await mkdtemp(join(tmpdir(), 'adea-icons-'))
    const result = await stageIconAssets({
      sources: resolveIconSources(base, index),
      assetsDirectory: directory,
      readBytes: async () => OTHER_SVG,
    })
    expect(result.staged).toEqual([])
    expect(result.skipped).toEqual([{ asset: svgAsset, reason: 'DIGEST_MISMATCH' }])
    expect(await fs.readdir(directory)).toEqual([])
  })

  test('reports a fetch failure and an existing conflicting file', async () => {
    const { base, index } = artifactsOf([
      plugin({
        sourceId: 'cursor-official',
        name: 'calendar',
        categories: ['productivity'],
        icon: { path: 'assets/logo.svg', bytes: CLEAN_SVG },
      }),
    ])
    const sources = resolveIconSources(base, index)
    const directory = await mkdtemp(join(tmpdir(), 'adea-icons-'))
    const failed = await stageIconAssets({
      sources,
      assetsDirectory: directory,
      readBytes: async () => {
        throw new Error('network down')
      },
    })
    expect(failed.skipped[0]!.reason).toContain('FETCH_FAILED')

    await fs.writeFile(join(directory, svgAsset), OTHER_SVG)
    const conflicted = await stageIconAssets({
      sources,
      assetsDirectory: directory,
      readBytes: async () => CLEAN_SVG,
    })
    expect(conflicted.skipped).toEqual([{ asset: svgAsset, reason: 'ASSET_CONFLICT' }])
  })
})
