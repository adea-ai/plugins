import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { parseProductPreference } from '../../catalog-core/src/consumer-index.js'
import { parseProductIconOverrides } from '../../catalog-core/src/icons.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const read = <T>(name: string): T =>
  JSON.parse(readFileSync(join(root, 'config', name), 'utf8')) as T

const categoryMap = read<{ aliases: Record<string, string>; fallback: string }>('category-map.json')
const productCategories = read<{ categories: Record<string, string> }>('product-categories.json')
const productAliases = read<{ aliases: Record<string, string> }>('product-aliases.json')
const leading = read<{ leading: Record<string, string[]>; topCount?: number }>('leading.json')
const sources = read<{ sources: { sourceId: string }[] }>('sources.json')

const knownCategories = new Set(Object.values(categoryMap.aliases))
const curatedCategories = Object.keys(leading.leading)
const curatedNames = Object.entries(leading.leading).flatMap(([category, names]) =>
  names.map((name) => ({ category, name }))
)

describe('category configuration', () => {
  test('every alias target and product category is a real category', () => {
    for (const [alias, target] of Object.entries(categoryMap.aliases))
      expect(knownCategories, `alias ${alias}`).toContain(target)
    for (const [product, category] of Object.entries(productCategories.categories))
      expect(knownCategories, `product ${product}`).toContain(category)
  })

  test('every curated category is a real category', () => {
    for (const category of curatedCategories) expect(knownCategories).toContain(category)
  })

  test('keeps research grouped with education and research', () => {
    // Regression guard: the scientific-research group is folded into one
    // Education / Research category rather than published on its own.
    expect(knownCategories).not.toContain('scientific-research')
    for (const alias of ['research', 'math', 'scientific research', 'scientific-research'])
      expect(categoryMap.aliases[alias]).toBe('education-research')
    for (const category of Object.values(productCategories.categories))
      expect(category).not.toBe('scientific-research')
  })

  test('curates each name in one category only', () => {
    const owners = new Map<string, string>()
    for (const { category, name } of curatedNames) {
      const existing = owners.get(name)
      expect(existing === undefined || existing === category, `${name}: ${existing}`).toBe(true)
      owners.set(name, category)
    }
  })

  test('declares a positive shelf size', () => {
    expect(Number.isInteger(leading.topCount)).toBe(true)
    expect(leading.topCount!).toBeGreaterThan(0)
  })
})

describe('placement configuration', () => {
  test('names every configured source and no unknown one', () => {
    const preference = parseProductPreference(read('product-preference.json'))
    const configured = sources.sources.map((source) => source.sourceId).toSorted()
    expect([...preference.sourcePreference].toSorted()).toEqual(configured)
  })

  test('only overrides products that aliases resolve to a product key', () => {
    const preference = parseProductPreference(read('product-preference.json'))
    const keys = new Set([
      ...Object.keys(productCategories.categories),
      ...Object.values(productAliases.aliases),
    ])
    for (const productKey of Object.keys(preference.canonicalOverrides ?? {}))
      expect(keys).toContain(productKey)
  })
})

describe('brand mark configuration', () => {
  test('the shipped override file parses', () => {
    const overrides = parseProductIconOverrides(read('product-icons.json'))
    for (const productKey of Object.keys(overrides.overrides))
      expect(productKey.length).toBeGreaterThan(1)
  })
})

describe('curation of the checked-in snapshot', () => {
  const snapshot = JSON.parse(
    readFileSync(join(root, 'generated', 'categories.v1.json'), 'utf8')
  ) as { products?: unknown; diagnostics?: { category: string; name: string; reason: string }[] }

  // A snapshot published before the consumer index existed carries membership
  // only, so there is nothing yet to check. This guard lifts automatically once
  // a live synchronization republishes the index.
  test.skipIf(snapshot.products === undefined)(
    'every curated shelf name resolves in the published catalog',
    () => {
      expect(snapshot.diagnostics).toEqual([])
    }
  )
})
