import { describe, expect, test } from 'bun:test'
import {
  buildCatalog,
  byteDigest,
  digest,
  type CatalogPolicy,
  type CategoryMap,
  type ProductAliases,
  type ResolvedSource,
  type Snapshot,
  type SnapshotLoader,
} from './index.js'
import { buildConsumerIndex } from './consumer-index.js'
import { resolveIconSources, stageIconAssets } from './icon-mirror.js'
import { selectIconPath } from './icons.js'

/**
 * End-to-end cover for the brand-mark fallback: a plugin that ships no mark of
 * its own gets the product site's icon, resolved during the build, recorded in
 * the catalog and carried into the consumer index and its asset manifest.
 */

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const HOME = 'https://vendor.example/'
const APPLE_ICON = 'https://vendor.example/apple-icon.png'

const policy: CatalogPolicy = {
  allowedRepositoryHosts: ['github.com'],
  allowedRepositoryProtocols: ['https:'],
  maxFilesPerPlugin: 4096,
  maxBytesPerPlugin: 50 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxMarketplacePlugins: 4096,
  denyExecutableLifecycleScripts: true,
  publishRequiresCompleteContent: false,
  sensitiveCapabilityTypes: ['mcp-server', 'hook', 'executable'],
}
const categoryMap: CategoryMap = { aliases: {}, fallback: 'other' }
const productAliases: ProductAliases = { aliases: {} }

/** Serves plugin content from memory, so no filesystem or tree fetch is needed. */
function loader(files: Record<string, Uint8Array>): SnapshotLoader {
  return {
    load: async (): Promise<Snapshot> => ({ files: new Map(Object.entries(files)), symlinks: [] }),
  }
}

function source(entryName: string, homepage?: string): ResolvedSource {
  return {
    config: {
      sourceId: 'test-source',
      displayName: 'Test Source',
      repositoryUrl: 'https://github.com/acme/marketplace',
      marketplaceDialect: 'claude',
      manifestPath: 'marketplace.json',
      defaultBranch: 'main',
      trustClassification: 'official',
    },
    commitSha: 'a'.repeat(40),
    manifestText: '{}',
    parsed: {
      marketplaceName: 'Acme',
      marketplaceDescription: 'Acme',
      owner: ['Acme'],
      entries: [
        {
          name: entryName,
          description: `${entryName} plugin`,
          categories: ['productivity'],
          keywords: [],
          authors: ['Acme'],
          icons: [],
          ...(homepage ? { homepage } : {}),
          source: { kind: 'local', path: '.' },
          policy: {},
          raw: {},
          entryDigest: `sha256:${'e'.repeat(64)}`,
        },
      ],
      raw: {},
    },
    pluginPins: [],
    retrievedAt: '2026-01-01T00:00:00.000Z',
    manifestDigest: digest('{}'),
  }
}

function stubFetch(handler: (url: string) => Response) {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    return handler(url)
  }) as typeof fetch
  return { calls, restore: () => void (globalThis.fetch = original) }
}

async function build(entryName: string, homepage?: string, options: { live?: boolean } = {}) {
  const stub = stubFetch((url) => {
    if (url === HOME)
      return new Response(`<head><link rel="apple-touch-icon" href="/apple-icon.png"></head>`, {
        status: 200,
      })
    if (url === APPLE_ICON) return new Response(PNG, { status: 200 })
    return new Response('missing', { status: 404 })
  })
  try {
    const catalog = await buildCatalog({
      resolvedSources: [source(entryName, homepage)],
      categoryMap,
      productAliases,
      policy,
      metadataOnly: false,
      snapshotLoader: loader({ 'README.md': new TextEncoder().encode('no mark here') }),
      resolveExternalRefs: options.live ?? true,
    })
    return { catalog, calls: stub.calls }
  } finally {
    stub.restore()
  }
}

describe('product site icon fallback', () => {
  test('records the site icon for a plugin that ships no mark', async () => {
    const { catalog, calls } = await build('connector', HOME)
    const release = catalog.plugins[0]!.availableReleases[0]!
    expect(release.icon).toEqual({
      kind: 'favicon',
      url: APPLE_ICON,
      homepage: HOME,
      contentType: 'image/png',
      digest: byteDigest(PNG),
      bytes: PNG.byteLength,
    })
    expect(calls).toEqual([HOME, APPLE_ICON])
  })

  test('prefers the plugin content and never contacts the site when a mark exists', async () => {
    const stub = stubFetch(() => new Response('unexpected', { status: 500 }))
    try {
      const catalog = await buildCatalog({
        resolvedSources: [source('connector', HOME)],
        categoryMap,
        productAliases,
        policy,
        metadataOnly: false,
        snapshotLoader: loader({
          'assets/logo.svg': new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>'
          ),
        }),
        resolveExternalRefs: true,
      })
      expect(catalog.plugins[0]!.availableReleases[0]!.icon).toMatchObject({
        kind: 'content',
        path: 'assets/logo.svg',
      })
      expect(stub.calls).toEqual([])
    } finally {
      stub.restore()
    }
  })

  test('does not reach the network for a metadata-only build', async () => {
    const { catalog, calls } = await build('connector', HOME, { live: false })
    expect(calls).toEqual([])
    expect(catalog.plugins[0]!.availableReleases[0]!.icon).toBeUndefined()
  })

  test('skips a repository homepage, which would only yield the forge logo', async () => {
    const { catalog, calls } = await build('connector', 'https://github.com/acme/connector')
    expect(calls).toEqual([])
    expect(catalog.plugins[0]!.availableReleases[0]!.icon).toBeUndefined()
  })

  test('carries the site icon into the index, the manifest and the mirror', async () => {
    const { catalog } = await build('connector', HOME)
    const index = buildConsumerIndex({ catalog })
    const product = index.products.connector!
    expect(product.icon).toMatchObject({ kind: 'favicon', url: APPLE_ICON, homepage: HOME })
    expect(product.monogram.text).toBe('CO')

    const sources = resolveIconSources(catalog, index)
    expect(sources).toEqual([
      {
        kind: 'favicon',
        asset: product.icon!.asset,
        digest: byteDigest(PNG),
        bytes: PNG.byteLength,
        contentType: 'image/png',
        url: APPLE_ICON,
        homepage: HOME,
      },
    ])

    const staged = await stageIconAssets({
      sources,
      assetsDirectory: `${import.meta.dir}/.icon-mirror-test`,
      readBytes: async () => PNG,
    })
    expect(staged.skipped).toEqual([])
    expect(staged.staged.map((asset) => asset.origin)).toEqual([APPLE_ICON])
    expect(staged.staged[0]!.kind).toBe('favicon')
    await Bun.$`rm -rf ${`${import.meta.dir}/.icon-mirror-test`}`.quiet()
  })

  test('a curated site override supplies the mark for a repository-only plugin', async () => {
    const stub = stubFetch((url) => {
      if (url === 'https://curated.example/')
        return new Response('<head><link rel="apple-touch-icon" href="/mark.png"></head>')
      if (url === 'https://curated.example/mark.png') return new Response(PNG)
      return new Response('missing', { status: 404 })
    })
    try {
      const catalog = await buildCatalog({
        resolvedSources: [source('connector', 'https://github.com/acme/connector')],
        categoryMap,
        productAliases,
        productIconOverrides: {
          schemaVersion: 1,
          overrides: { connector: 'https://curated.example/' },
        },
        policy,
        metadataOnly: false,
        snapshotLoader: loader({ 'README.md': new TextEncoder().encode('x') }),
        resolveExternalRefs: true,
      })
      expect(catalog.plugins[0]!.availableReleases[0]!.icon).toMatchObject({
        kind: 'favicon',
        url: 'https://curated.example/mark.png',
        homepage: 'https://curated.example/',
      })
      expect(stub.calls).toEqual(['https://curated.example/', 'https://curated.example/mark.png'])
    } finally {
      stub.restore()
    }
  })

  test('falls back to a monogram when the site yields no usable icon', async () => {
    const stub = stubFetch((url) =>
      url === HOME
        ? new Response('<head><link rel="icon" href="/broken.png"></head>', { status: 200 })
        : new Response('not an image', { status: 200 })
    )
    try {
      const catalog = await buildCatalog({
        resolvedSources: [source('connector', HOME)],
        categoryMap,
        productAliases,
        policy,
        metadataOnly: false,
        snapshotLoader: loader({ 'README.md': new TextEncoder().encode('x') }),
        resolveExternalRefs: true,
      })
      expect(catalog.plugins[0]!.availableReleases[0]!.icon).toBeUndefined()
      const index = buildConsumerIndex({ catalog })
      expect(index.products.connector!.icon).toBeNull()
      expect(index.products.connector!.monogram).toEqual({ text: 'CO', hue: expect.any(Number) })
      expect(selectIconPath(catalog.plugins[0]!.availableReleases[0]!.fileIndex!)).toBeNull()
    } finally {
      stub.restore()
    }
  })
})
