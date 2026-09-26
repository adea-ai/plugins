import { describe, expect, test } from 'bun:test'
import {
  discoverSiteIcons,
  isPublicHostname,
  isVendorHomepage,
  resolveSiteIcon,
  type SiteIconFetcher,
} from './site-icons.js'
import { byteDigest } from './index.js'

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0])
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>'
)
const SCRIPTED_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
)

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value
}

function fetcher(site: Record<string, string | Uint8Array>): SiteIconFetcher & {
  textCalls: string[]
  byteCalls: string[]
} {
  const textCalls: string[] = []
  const byteCalls: string[] = []
  return {
    textCalls,
    byteCalls,
    digest: (bytes) => byteDigest(bytes),
    fetchText: async (url) => {
      textCalls.push(url)
      const value = site[url]
      if (value === undefined) throw new Error('ENOENT')
      return typeof value === 'string' ? value : new TextDecoder().decode(value)
    },
    fetchBytes: async (url) => {
      byteCalls.push(url)
      const value = site[url]
      if (value === undefined) throw new Error('ENOENT')
      return toBytes(value)
    },
  }
}

describe('vendor homepage eligibility', () => {
  test('accepts a vendor site and rejects repository and non-public hosts', () => {
    expect(isVendorHomepage('https://appwrite.io/')).toBe(true)
    expect(isVendorHomepage('https://docs.voxel51.com/')).toBe(true)
    expect(isVendorHomepage('https://github.com/foo/bar')).toBe(false)
    expect(isVendorHomepage('https://raw.githubusercontent.com/foo/bar')).toBe(false)
    expect(isVendorHomepage('https://gitlab.com/foo/bar')).toBe(false)
    expect(isVendorHomepage('http://appwrite.io/')).toBe(false)
    expect(isVendorHomepage('http://localhost:8080/')).toBe(false)
    expect(isVendorHomepage('https://127.0.0.1/')).toBe(false)
    expect(isVendorHomepage('https://10.0.0.5/')).toBe(false)
    expect(isVendorHomepage('https://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isVendorHomepage('https://192.168.1.10/')).toBe(false)
    expect(isVendorHomepage('https://service.internal/')).toBe(false)
    expect(isVendorHomepage('not a url')).toBe(false)
    expect(isVendorHomepage(undefined)).toBe(false)
  })

  test('classifies hostnames', () => {
    expect(isPublicHostname('example.com')).toBe(true)
    expect(isPublicHostname('bare-hostname')).toBe(false)
    expect(isPublicHostname('::1')).toBe(false)
    expect(isPublicHostname('fd00::1')).toBe(false)
  })
})

describe('site icon discovery', () => {
  const html = `<!doctype html><html><head>
    <link rel="icon" href="/favicon.ico">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-icon.png">
    <link rel="stylesheet" href="/app.css">
    <link rel="mask-icon" href="/mask.svg">
    <link rel="icon" type="image/svg+xml" href="https://cdn.example.com/icon.svg">
  </head><body><img src="/hero.png"></body></html>`

  test('ranks apple-touch-icon first and resolves relative URLs', () => {
    expect(discoverSiteIcons(html, 'https://vendor.example/')).toEqual([
      'https://vendor.example/apple-icon.png',
      'https://vendor.example/favicon.ico',
      'https://cdn.example.com/icon.svg',
      'https://vendor.example/mask.svg',
    ])
  })

  test('prefers the larger declared size within a group', () => {
    const sizes = `<link rel="icon" sizes="32x32" href="/small.png">
      <link rel="icon" sizes="512x512" href="/large.png">`
    expect(discoverSiteIcons(sizes, 'https://vendor.example/')[0]).toBe(
      'https://vendor.example/large.png'
    )
  })

  test('falls back to /favicon.ico and refuses unsafe candidates', () => {
    expect(discoverSiteIcons('<html><head></head></html>', 'https://vendor.example/page')).toEqual([
      'https://vendor.example/favicon.ico',
    ])
    expect(
      discoverSiteIcons(
        '<link rel="icon" href="http://vendor.example/icon.png">',
        'https://vendor.example/'
      )
    ).toEqual(['https://vendor.example/favicon.ico'])
    expect(
      discoverSiteIcons('<link rel="icon" href="http://localhost/icon.png">', 'https://v.example/')
    ).toEqual(['https://v.example/favicon.ico'])
  })
})

describe('site icon resolution', () => {
  const homepage = 'https://vendor.example/'
  const html = '<head><link rel="apple-touch-icon" href="/apple-icon.png"></head>'

  test('returns the first usable icon with provenance', async () => {
    const io = fetcher({ [homepage]: html, 'https://vendor.example/apple-icon.png': PNG })
    const result = await resolveSiteIcon(homepage, io)
    expect('contentType' in result && result).toMatchObject({
      url: 'https://vendor.example/apple-icon.png',
      homepage,
      contentType: 'image/png',
      digest: byteDigest(PNG),
    })
    expect(io.byteCalls).toEqual(['https://vendor.example/apple-icon.png'])
  })

  test('accepts an icon container and skips a candidate that fails inspection', async () => {
    const ico = fetcher({ [homepage]: html, 'https://vendor.example/apple-icon.png': ICO })
    expect(await resolveSiteIcon(homepage, ico)).toMatchObject({ contentType: 'image/x-icon' })

    const scripted = fetcher({
      [homepage]: html,
      'https://vendor.example/apple-icon.png': SCRIPTED_SVG,
      'https://vendor.example/favicon.ico': SVG,
    })
    expect(await resolveSiteIcon(homepage, scripted)).toMatchObject({
      url: 'https://vendor.example/favicon.ico',
      contentType: 'image/svg+xml',
    })
  })

  test('reports a reason instead of throwing', async () => {
    const missing = fetcher({})
    expect(await resolveSiteIcon(homepage, missing)).toMatchObject({
      failed: expect.stringContaining('HOMEPAGE_FETCH_FAILED') as never,
    })
    const noIcon = fetcher({ [homepage]: '<head></head>' })
    expect(await resolveSiteIcon(homepage, noIcon)).toEqual({ failed: 'NO_USABLE_ICON' })
    expect(await resolveSiteIcon('https://github.com/foo/bar', fetcher({}))).toEqual({
      failed: 'NOT_VENDOR_HOMEPAGE',
    })
  })

  test('parses only the document head of a large landing page', async () => {
    const huge = `${html}${'x'.repeat(600 * 1024)}`
    const io = fetcher({ [homepage]: huge, 'https://vendor.example/apple-icon.png': PNG })
    const result = await resolveSiteIcon(homepage, io)
    expect('contentType' in result).toBe(true)

    const oversized = fetcher({ [homepage]: 'x'.repeat(5 * 1024 * 1024) })
    expect(await resolveSiteIcon(homepage, oversized)).toEqual({ failed: 'HOMEPAGE_TOO_LARGE' })
  })
})
