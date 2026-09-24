import { describe, expect, test } from 'bun:test'
import type { Catalog, Plugin } from '../../catalog-schema/src/index.js'
import {
  buildConsumerIndex,
  DEFAULT_SOURCE_PREFERENCE,
  parseProductPreference,
  type ProductPreference,
} from './consumer-index.js'
import { createArtifacts, verifyConsumerIndex } from './index.js'

const preference: ProductPreference = {
  schemaVersion: 1,
  sourcePreference: [...DEFAULT_SOURCE_PREFERENCE],
}

interface PluginInput {
  sourceId: string
  name: string
  categories: string[]
  displayName?: string
  releaseRepositoryUrl?: string
  productGroupingKey?: string
}

function plugin(input: PluginInput): Plugin {
  return {
    pluginId: `plugin:${input.sourceId}:${input.name}`,
    displayName: input.displayName ?? input.name,
    description: `${input.name} description`,
    productGroupingKey: input.productGroupingKey ?? input.name,
    categories: input.categories,
    keywords: [input.name],
    authors: ['Test'],
    icons: [],
    sourceId: input.sourceId,
    upstreamPluginName: input.name,
    currentReleaseId: `release:${input.sourceId}-${input.name}`,
    // Defaults to the marketplace's own repository, i.e. a wrapper package.
    availableReleases: [
      {
        resolvedRepositoryUrl:
          input.releaseRepositoryUrl ?? `https://github.com/${input.sourceId}/marketplace`,
      },
    ],
    capabilitySummary: { 'mcp-server': 1 },
    harnessCompatibility: {
      cursor: { status: 'native', reasons: [], responsibleCapabilities: [] },
    },
    license: { name: 'MIT', source: 'plugin-manifest' },
    provenance: {},
    securityClassification: {},
  } as unknown as Plugin
}

function catalog(plugins: Plugin[]): Catalog {
  const sourceIds = [...new Set(plugins.map((item) => item.sourceId))].toSorted()
  return {
    schemaVersion: 1,
    catalogId: `catalog:${'a'.repeat(64)}`,
    generatedAt: '2026-01-01T00:00:00.000Z',
    sources: sourceIds.map((sourceId) => ({
      sourceId,
      repositoryUrl: `https://github.com/${sourceId}/marketplace`,
    })),
    plugins,
  } as unknown as Catalog
}

describe('product placement', () => {
  test('collapses one product published by several sources into a single entry', () => {
    const index = buildConsumerIndex({
      catalog: catalog([
        plugin({
          sourceId: 'cursor-official',
          name: 'google-calendar',
          categories: ['productivity'],
        }),
        plugin({
          sourceId: 'openai-official',
          name: 'google-calendar',
          categories: ['productivity'],
        }),
      ]),
      preference,
    })
    expect(index.counts).toEqual({ plugins: 2, products: 1, redundantPlugins: 1 })
    expect(index.products['google-calendar']).toMatchObject({
      pluginId: 'plugin:cursor-official:google-calendar',
      variantPluginIds: [
        'plugin:cursor-official:google-calendar',
        'plugin:openai-official:google-calendar',
      ],
      variantsIdentical: false,
    })
    expect(index.categories[0]!.productKeys).toEqual(['google-calendar'])
    expect(index.categories[0]!.topProductKeys).toEqual(['google-calendar'])
  })

  test('marks variants that ship byte-identical content', () => {
    const shared = { releaseRepositoryUrl: 'https://github.com/vendor/plugin' }
    const first = plugin({
      sourceId: 'claude-official',
      name: 'atlan',
      categories: ['data-analytics'],
      ...shared,
    })
    const second = plugin({
      sourceId: 'knowledge-work-official',
      name: 'atlan',
      categories: ['data-analytics'],
      ...shared,
    })
    const identical = buildConsumerIndex({
      catalog: catalog([
        { ...first, currentReleaseId: 'release:same' },
        { ...second, currentReleaseId: 'release:same' },
      ]),
      preference,
    })
    expect(identical.products.atlan!.variantsIdentical).toBe(true)
  })

  test('prefers vendor-published content over a marketplace wrapper package', () => {
    const index = buildConsumerIndex({
      catalog: catalog([
        plugin({ sourceId: 'claude-official', name: 'slack', categories: ['communication'] }),
        plugin({
          sourceId: 'openai-official',
          name: 'slack',
          categories: ['communication'],
          releaseRepositoryUrl: 'https://github.com/slackapi/slack-mcp-plugin',
        }),
      ]),
      preference,
    })
    expect(index.products.slack!.pluginId).toBe('plugin:openai-official:slack')
  })

  test('falls back to the configured source order when every variant is a wrapper', () => {
    const index = buildConsumerIndex({
      catalog: catalog([
        plugin({ sourceId: 'openai-official', name: 'github', categories: ['developer-tools'] }),
        plugin({ sourceId: 'claude-official', name: 'github', categories: ['developer-tools'] }),
      ]),
      preference,
    })
    expect(index.products.github!.pluginId).toBe('plugin:claude-official:github')
  })

  test('applies an explicit override ahead of every heuristic', () => {
    const index = buildConsumerIndex({
      catalog: catalog([
        plugin({ sourceId: 'claude-official', name: 'github', categories: ['developer-tools'] }),
        plugin({ sourceId: 'cursor-official', name: 'github', categories: ['developer-tools'] }),
      ]),
      preference: {
        ...preference,
        canonicalOverrides: { github: 'plugin:cursor-official:github' },
      },
    })
    expect(index.products.github!.pluginId).toBe('plugin:cursor-official:github')
  })

  test('prefers a human-formatted label among variants', () => {
    const index = buildConsumerIndex({
      catalog: catalog([
        plugin({ sourceId: 'claude-official', name: 'figma', categories: ['creativity'] }),
        plugin({
          sourceId: 'openai-official',
          name: 'figma',
          categories: ['creativity'],
          displayName: 'Figma',
        }),
      ]),
      preference,
    })
    expect(index.products.figma!.displayName).toBe('Figma')
    expect(index.products.figma!.pluginId).toBe('plugin:claude-official:figma')
  })

  test('places a product from a source the preference list does not name', () => {
    const index = buildConsumerIndex({
      catalog: catalog([
        plugin({ sourceId: 'unlisted-source', name: 'tool', categories: ['developer-tools'] }),
      ]),
      preference,
    })
    expect(index.products.tool!.pluginId).toBe('plugin:unlisted-source:tool')
  })
})

describe('category shelves', () => {
  const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta']

  test('orders curated products first and fills the rest deterministically', () => {
    const index = buildConsumerIndex({
      catalog: catalog(
        names.map((name) =>
          plugin({ sourceId: 'claude-official', name, categories: ['productivity'] })
        )
      ),
      leading: { productivity: ['zeta', 'gamma'] },
      topCount: 4,
      preference,
    })
    const category = index.categories[0]!
    expect(category.productKeys).toEqual([
      'zeta',
      'gamma',
      'alpha',
      'beta',
      'delta',
      'epsilon',
      'eta',
    ])
    expect(category.topProductKeys).toEqual(['zeta', 'gamma', 'alpha', 'beta'])
    expect(index.diagnostics).toEqual([])
  })

  test('a curated product is never taken by another category that only fills', () => {
    // 'teaching' sorts first under developer-tools, but education-research
    // curates it, so developer-tools must fill from nothing instead.
    const index = buildConsumerIndex({
      catalog: catalog([
        plugin({
          sourceId: 'cursor-official',
          name: 'teaching',
          categories: ['developer-tools', 'education-research'],
        }),
      ]),
      leading: { 'education-research': ['teaching'] },
      preference,
    })
    expect(
      index.categories.find((item) => item.category === 'developer-tools')!.topProductKeys
    ).toEqual([])
    expect(
      index.categories.find((item) => item.category === 'education-research')!.topProductKeys
    ).toEqual(['teaching'])
  })

  test('reports every curated name that no longer resolves and skips it', () => {
    const index = buildConsumerIndex({
      catalog: catalog([
        plugin({ sourceId: 'claude-official', name: 'sentry', categories: ['developer-tools'] }),
        plugin({
          sourceId: 'claude-official',
          name: 'nightvision',
          categories: ['developer-tools'],
        }),
        plugin({ sourceId: 'claude-official', name: 'zscaler', categories: ['security'] }),
      ]),
      leading: {
        'developer-tools': ['getsentry', 'sentry'],
        security: ['nightvision', 'no-such-plugin'],
        'unknown-category': ['anything'],
      },
      preference,
    })
    expect(index.diagnostics).toEqual([
      { category: 'developer-tools', name: 'getsentry', reason: 'PRODUCT_NOT_FOUND' },
      { category: 'security', name: 'nightvision', reason: 'PRODUCT_NOT_IN_CATEGORY' },
      { category: 'security', name: 'no-such-plugin', reason: 'PRODUCT_NOT_FOUND' },
      { category: 'unknown-category', name: 'anything', reason: 'UNKNOWN_CATEGORY' },
    ])
    const developer = index.categories.find((item) => item.category === 'developer-tools')!
    // The stale name leaves no slot behind; only the real product is shelved.
    expect(developer.topProductKeys).toEqual(['sentry', 'nightvision'])
  })

  test('is deterministic for the same catalog in any input order', () => {
    const forward = names
      .slice(0, 3)
      .map((name) => plugin({ sourceId: 'claude-official', name, categories: ['productivity'] }))
    const first = buildConsumerIndex({
      catalog: catalog(forward),
      leading: { productivity: ['gamma'] },
      preference,
    })
    const second = buildConsumerIndex({
      catalog: catalog(forward.toReversed()),
      leading: { productivity: ['gamma'] },
      preference,
    })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

describe('product preference configuration', () => {
  test('rejects malformed placement configuration', () => {
    expect(() => parseProductPreference(null)).toThrow('PRODUCT_PREFERENCE_INVALID')
    expect(() => parseProductPreference({ schemaVersion: 2, sourcePreference: ['a'] })).toThrow(
      'PRODUCT_PREFERENCE_INVALID'
    )
    expect(() => parseProductPreference({ schemaVersion: 1, sourcePreference: [] })).toThrow(
      'PRODUCT_PREFERENCE_INVALID'
    )
    expect(() =>
      parseProductPreference({ schemaVersion: 1, sourcePreference: ['a', 'a'] })
    ).toThrow('PRODUCT_PREFERENCE_DUPLICATE_SOURCE')
    expect(() =>
      parseProductPreference({
        schemaVersion: 1,
        sourcePreference: ['a'],
        canonicalOverrides: { tool: 'tool' },
      })
    ).toThrow('PRODUCT_PREFERENCE_OVERRIDE_INVALID: tool')
  })

  test('accepts and normalizes the checked-in configuration shape', () => {
    expect(
      parseProductPreference({
        schemaVersion: 1,
        sourcePreference: ['claude-official'],
        canonicalOverrides: { github: 'plugin:claude-official:github' },
      })
    ).toEqual({
      schemaVersion: 1,
      sourcePreference: ['claude-official'],
      canonicalOverrides: { github: 'plugin:claude-official:github' },
    })
  })
})

describe('artifact publication', () => {
  const lock = {
    schemaVersion: 1 as const,
    lockId: `lock:${'b'.repeat(64)}`,
    sources: [],
  }

  function publishedDiagnostics(curationDiagnostics?: boolean) {
    const base = catalog([
      plugin({ sourceId: 'claude-official', name: 'sentry', categories: ['developer-tools'] }),
    ])
    const artifacts = createArtifacts(base, lock as never, {
      leading: { 'developer-tools': ['getsentry'] },
      ...(curationDiagnostics === undefined ? {} : { curationDiagnostics }),
    })
    return JSON.parse(artifacts['categories.v1.json']).diagnostics
  }

  test('publishes curated-name drift for a live catalog', () => {
    expect(publishedDiagnostics()).toHaveLength(1)
    expect(publishedDiagnostics(true)).toHaveLength(1)
  })

  test('omits curated-name drift for an offline fixture build', () => {
    expect(publishedDiagnostics(false)).toEqual([])
  })
})

describe('consumer index verification', () => {
  const plugins = [
    plugin({ sourceId: 'claude-official', name: 'a', categories: ['productivity'] }),
    plugin({ sourceId: 'claude-official', name: 'b', categories: ['productivity'] }),
  ]

  test('accepts an index that agrees with its catalog', () => {
    const base = catalog(plugins)
    const index = buildConsumerIndex({
      catalog: base,
      leading: { productivity: ['b'] },
      preference,
    })
    const result = verifyConsumerIndex(JSON.stringify(index), base)
    expect(result.hasConsumerIndex).toBe(true)
    expect(result.counts?.products).toBe(2)
    expect(result.diagnostics).toEqual([])
  })

  test('accepts a snapshot published before the index existed', () => {
    const base = catalog(plugins)
    const legacy = JSON.stringify({
      schemaVersion: 1,
      catalogId: base.catalogId,
      categories: [
        {
          category: 'productivity',
          pluginIds: ['plugin:claude-official:a', 'plugin:claude-official:b'],
        },
      ],
    })
    const result = verifyConsumerIndex(legacy, base)
    expect(result.hasConsumerIndex).toBe(false)
    expect(result.counts).toBeUndefined()
  })

  test('rejects a category list that names a plugin outside the catalog', () => {
    const base = catalog(plugins)
    const index = buildConsumerIndex({ catalog: base, preference })
    const tampered = {
      ...index,
      categories: index.categories.map((category) => ({
        ...category,
        pluginIds: ['plugin:claude-official:a', 'plugin:claude-official:missing'],
      })),
    }
    expect(() => verifyConsumerIndex(JSON.stringify(tampered), base)).toThrow(
      'CONSUMER_INDEX_FOREIGN_PLUGIN'
    )
  })

  test('rejects a shelf that repeats a product across categories', () => {
    const base = catalog([
      plugin({
        sourceId: 'claude-official',
        name: 'a',
        categories: ['productivity', 'communication'],
      }),
    ])
    const index = buildConsumerIndex({ catalog: base, preference })
    const tampered = {
      ...index,
      categories: index.categories.map((category) => ({
        ...category,
        topProductKeys: ['a'],
      })),
    }
    expect(() => verifyConsumerIndex(JSON.stringify(tampered), base)).toThrow(
      'CONSUMER_INDEX_TOP_CROSS_CATEGORY'
    )
  })
})
