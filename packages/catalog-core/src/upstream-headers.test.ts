import { afterEach, describe, expect, test } from 'bun:test'
import { createSiteIconFetcher, fetchUpstreamBytes, upstreamRequestHeaders } from './index.js'

/**
 * Header policy for upstream requests.
 *
 * A live build runs with a GitHub token that authorises repository writes, and
 * the same helper fetches vendor sites for brand marks. The credential must
 * never leave GitHub's hosts — and sending it changes what a vendor answers:
 * appwrite.io replies 500 to a page carrying an Authorization header, so a
 * build that leaked the token also lost marks it had already curated.
 */

const VENDOR = 'https://appwrite.io/'
const VENDOR_ICON = 'https://cdn.example/apple-touch-icon.png'
const GITHUB_API = 'https://api.github.com/repos/adea-ai/plugins/git/trees/abc?recursive=1'
const RAW = 'https://raw.githubusercontent.com/adea-ai/plugins/abc/plugin.json'

const saved = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
}

afterEach(() => {
  for (const key of ['GITHUB_TOKEN', 'GH_TOKEN'] as const) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function withTokens(github?: string, gh?: string): void {
  for (const [key, value] of [
    ['GITHUB_TOKEN', github],
    ['GH_TOKEN', gh],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

/** Captures the init each fetch is called with, so headers and signals are inspectable. */
function captureFetch(response: () => Response = () => new Response('ok')) {
  const original = globalThis.fetch
  const inits: RequestInit[] = []
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    inits.push(init ?? {})
    return response()
  }) as typeof fetch
  return {
    inits,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

describe('upstream request headers', () => {
  test('never attach the repository credential to a vendor host', () => {
    withTokens('ghs_realtoken', 'ghs_realtoken')
    for (const url of [VENDOR, VENDOR_ICON]) {
      const headers = upstreamRequestHeaders(url)
      expect(headers.authorization).toBeUndefined()
      // GitHub's media type is part of the same disclosure: a vendor asked for
      // an image with it can answer with something that is not the mark.
      expect(headers.accept).toBeUndefined()
      expect(headers['user-agent']).toBeDefined()
    }
  })

  test('attach the credential to GitHub hosts', () => {
    withTokens('ghs_realtoken', 'ghs_realtoken')
    for (const url of [GITHUB_API, RAW]) {
      const headers = upstreamRequestHeaders(url)
      expect(headers.authorization).toBe('Bearer ghs_realtoken')
      expect(headers.accept).toBe('application/vnd.github+json')
    }
  })

  test('attach nothing when no token is configured', () => {
    withTokens(undefined, undefined)
    expect(upstreamRequestHeaders(GITHUB_API).authorization).toBeUndefined()
  })

  test('treat an unparseable URL as anonymous', () => {
    withTokens('ghs_realtoken', 'ghs_realtoken')
    expect(upstreamRequestHeaders('not a url').authorization).toBeUndefined()
  })

  test('fetchUpstreamBytes sends no credential to a vendor host', async () => {
    withTokens('ghs_realtoken', 'ghs_realtoken')
    const mock = captureFetch(() => new Response(new Uint8Array([1, 2, 3])))
    try {
      await fetchUpstreamBytes(VENDOR_ICON)
    } finally {
      mock.restore()
    }
    expect(mock.inits).toHaveLength(1)
    const headers = mock.inits[0]?.headers as Record<string, string>
    expect(headers.authorization).toBeUndefined()
  })

  test('fetchUpstreamBytes still authenticates a GitHub host', async () => {
    withTokens('ghs_realtoken', 'ghs_realtoken')
    const mock = captureFetch(() => new Response('{}'))
    try {
      await fetchUpstreamBytes(GITHUB_API)
    } finally {
      mock.restore()
    }
    const headers = mock.inits[0]?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer ghs_realtoken')
  })
})

describe('site-icon fetcher bounds', () => {
  test('gives every request a live ceiling instead of a shared, aged one', async () => {
    const mock = captureFetch()
    try {
      const fetcher = createSiteIconFetcher()
      await fetcher.fetchBytes(VENDOR_ICON)
      await fetcher.fetchBytes(VENDOR_ICON)
    } finally {
      mock.restore()
    }
    // Both requests carry a signal, and neither is already aborted: the ceiling
    // is created per request, so a second call cannot inherit a spent budget.
    expect(mock.inits).toHaveLength(2)
    for (const init of mock.inits) {
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.signal?.aborted).toBe(false)
    }
  })

  test('honours a caller deadline that has already passed', async () => {
    const mock = captureFetch()
    try {
      const fetcher = createSiteIconFetcher(AbortSignal.abort())
      await fetcher.fetchBytes(VENDOR_ICON)
    } finally {
      mock.restore()
    }
    // The request still goes out carrying the spent deadline, so the platform
    // aborts it; a real fetch rejects rather than returning a page.
    expect(mock.inits).toHaveLength(1)
    expect(mock.inits[0]?.signal?.aborted).toBe(true)
  })
})
