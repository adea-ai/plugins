import { describe, expect, test } from 'bun:test'
import {
  iconAssetName,
  iconOverrideFor,
  inspectIconBytes,
  MAX_ICON_BYTES,
  parseProductIconOverrides,
  selectIconPath,
  sniffContentType,
} from './icons.js'

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const GIF = new Uint8Array([...'GIF89a'].map((character) => character.charCodeAt(0)))
const WEBP = new Uint8Array([
  ...'RIFF'.split('').map((c) => c.charCodeAt(0)),
  0,
  0,
  0,
  0,
  ...'WEBP'.split('').map((c) => c.charCodeAt(0)),
])
const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const CLEAN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>'

describe('icon file selection', () => {
  test('prefers the conventional mark in a conventional location', () => {
    expect(selectIconPath(['assets/logo.png', 'assets/icon.svg'])).toBe('assets/icon.svg')
    expect(selectIconPath(['assets/logo.png', 'docs/media/logo.png'])).toBe('assets/logo.png')
    expect(selectIconPath(['images/logo.png', 'assets/logo.png'])).toBe('assets/logo.png')
  })

  test('prefers a scalable variant and the larger size of the same stem', () => {
    expect(selectIconPath(['assets/icon.png', 'assets/icon.svg'])).toBe('assets/icon.svg')
    expect(selectIconPath(['assets/icon-small.png', 'assets/icon-large.png'])).toBe(
      'assets/icon-large.png'
    )
  })

  test('accepts a vendor-named mark inside an asset directory', () => {
    expect(selectIconPath(['codex-plugin/assets/atlan-logo.png'])).toBe(
      'codex-plugin/assets/atlan-logo.png'
    )
    expect(selectIconPath(['assets/databricks.svg'])).toBe('assets/databricks.svg')
  })

  test('never mistakes documentation or repository infrastructure for a mark', () => {
    expect(selectIconPath(['assets/screenshot-1.png', 'docs/preview.png'])).toBeNull()
    expect(selectIconPath(['.github/img/cpu.svg'])).toBeNull()
    expect(selectIconPath(['docs/architecture.svg'])).toBeNull()
    expect(selectIconPath(['assets/banner.png'])).toBeNull()
  })

  test('ignores unsupported files and escapes, and is order independent', () => {
    expect(selectIconPath(['assets/logo.txt', 'assets/logo.svg'])).toBe('assets/logo.svg')
    expect(selectIconPath(['../assets/logo.svg'])).toBeNull()
    expect(selectIconPath([])).toBeNull()
    // An unnamed image at the plugin root is as likely a screenshot as a mark.
    expect(selectIconPath(['screenshot.png', 'readme.md'])).toBeNull()
    expect(selectIconPath(['assets/logo.png', 'assets/logo.svg'])).toBe(
      selectIconPath(['assets/logo.svg', 'assets/logo.png'])
    )
  })

  test('keeps a bare mark at the plugin root when it is named like a mark', () => {
    expect(selectIconPath(['logo.svg'])).toBe('logo.svg')
    expect(selectIconPath(['icon.png', 'readme.png'])).toBe('icon.png')
  })
})

describe('icon byte inspection', () => {
  test('sniffs supported raster types from magic bytes', () => {
    expect(sniffContentType(PNG)).toBe('image/png')
    expect(sniffContentType(JPEG)).toBe('image/jpeg')
    expect(sniffContentType(GIF)).toBe('image/gif')
    expect(sniffContentType(WEBP)).toBe('image/webp')
    expect(sniffContentType(encode(`<?xml version="1.0"?>${CLEAN_SVG}`))).toBe('image/svg+xml')
  })

  test('accepts a clean mark and reports its content type', () => {
    expect(inspectIconBytes(PNG)).toEqual({ contentType: 'image/png' })
    expect(inspectIconBytes(encode(CLEAN_SVG))).toEqual({ contentType: 'image/svg+xml' })
  })

  test('accepts an exporter prologue and leading comments before the root element', () => {
    const illustrator = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 24.0.0, SVG Export Plug-In . SVG Version: 6.00 -->
<!-- Second comment -->
<svg version="1.1" xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>`
    expect(sniffContentType(encode(illustrator))).toBe('image/svg+xml')
    expect(inspectIconBytes(encode(illustrator))).toEqual({ contentType: 'image/svg+xml' })
    // A document whose root element is not `<svg>` is still not an icon.
    const html = `<!DOCTYPE html><html><body><svg></svg></body></html>`
    expect(sniffContentType(encode(html))).toBeNull()
    const declared = `<svg-not xmlns="http://www.w3.org/2000/svg"></svg-not>`
    expect(sniffContentType(encode(declared))).toBeNull()
  })

  test('rejects empty, oversized and unsupported payloads', () => {
    expect(inspectIconBytes(new Uint8Array())).toEqual({ rejected: 'EMPTY_FILE' })
    expect(inspectIconBytes(new Uint8Array(MAX_ICON_BYTES + 1))).toEqual({
      rejected: 'SIZE_LIMIT_EXCEEDED',
    })
    expect(inspectIconBytes(encode('#!/bin/sh\nrm -rf /'))).toEqual({
      rejected: 'CONTENT_TYPE_UNSUPPORTED',
    })
  })

  test('rejects SVG that could execute or reach the network', () => {
    const cases = [
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`,
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="//evil.example">x</a></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg"><use href="//evil.example#x"/></svg>`,
      `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>`,
    ]
    for (const source of cases)
      expect(inspectIconBytes(encode(source)), source.slice(0, 40)).toEqual({
        rejected: expect.stringMatching(/^SVG_(ACTIVE_CONTENT|EXTERNAL_REFERENCE)$/) as never,
      })
  })
})

describe('icon asset names', () => {
  test('is content addressed and keeps a usable extension', () => {
    const name = iconAssetName(`sha256:${'a'.repeat(64)}`, 'image/png')
    expect(name).toBe(`icon-${'a'.repeat(32)}.png`)
    expect(iconAssetName(`sha256:${'b'.repeat(64)}`, 'image/svg+xml')).toBe(
      `icon-${'b'.repeat(32)}.svg`
    )
    // Identical bytes always resolve to the same asset, so caches stay warm.
    expect(iconAssetName(`sha256:${'c'.repeat(64)}`, 'image/webp')).toBe(
      iconAssetName(`sha256:${'c'.repeat(64)}`, 'image/webp')
    )
  })

  test('refuses a content type it cannot name', () => {
    expect(() => iconAssetName(`sha256:${'d'.repeat(64)}`, 'text/html' as never)).toThrow(
      'ICON_CONTENT_TYPE_UNSUPPORTED'
    )
  })
})

describe('brand mark overrides', () => {
  test('accepts a forced path, an explicit opt-out and a vendor site', () => {
    const parsed = parseProductIconOverrides({
      schemaVersion: 1,
      overrides: {
        github: 'assets/logo.svg',
        legacy: null,
        servicenow: 'https://www.servicenow.com/',
      },
    })
    expect(iconOverrideFor(parsed, 'github')).toEqual({ forced: 'assets/logo.svg' })
    expect(iconOverrideFor(parsed, 'legacy')).toEqual({ forced: null })
    expect(iconOverrideFor(parsed, 'servicenow')).toEqual({ site: 'https://www.servicenow.com/' })
    expect(iconOverrideFor(parsed, 'unlisted')).toBeUndefined()
    expect(iconOverrideFor(undefined, 'github')).toBeUndefined()
  })

  test('rejects malformed configuration', () => {
    expect(() => parseProductIconOverrides(null)).toThrow('PRODUCT_ICONS_INVALID')
    expect(() => parseProductIconOverrides({ schemaVersion: 2, overrides: {} })).toThrow(
      'PRODUCT_ICONS_INVALID'
    )
    expect(() => parseProductIconOverrides({ schemaVersion: 1 })).toThrow('PRODUCT_ICONS_INVALID')
    expect(() =>
      parseProductIconOverrides({ schemaVersion: 1, overrides: { Github: null } })
    ).toThrow('PRODUCT_ICONS_KEY_INVALID')
    expect(() =>
      parseProductIconOverrides({ schemaVersion: 1, overrides: { github: '/etc/passwd' } })
    ).toThrow('PRODUCT_ICONS_PATH_INVALID')
    expect(() =>
      parseProductIconOverrides({ schemaVersion: 1, overrides: { github: '../../secret.png' } })
    ).toThrow('PRODUCT_ICONS_PATH_INVALID')
    expect(() =>
      parseProductIconOverrides({ schemaVersion: 1, overrides: { github: 'https://localhost/' } })
    ).toThrow('PRODUCT_ICONS_SITE_UNSUPPORTED')
  })
})
