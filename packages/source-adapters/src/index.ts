import { createHash } from 'node:crypto'

export type MarketplaceDialect = 'openai' | 'cursor' | 'claude'

export interface SourceConfig {
  readonly sourceId: string
  readonly displayName: string
  readonly repositoryUrl: string
  readonly marketplaceDialect: MarketplaceDialect
  readonly manifestPath: string
  readonly defaultBranch: string
  readonly trustClassification: 'official'
  readonly fixturePath?: string
  readonly fixtureCommitSha?: string
}

export type PluginSourceSpec =
  | { readonly kind: 'local'; readonly path: string }
  | {
      readonly kind: 'git'
      readonly repositoryUrl: string
      readonly subdirectory: string
      readonly ref?: string
      readonly sha?: string
    }

export interface MarketplacePluginEntry {
  readonly name: string
  readonly displayName?: string | undefined
  readonly description: string
  readonly categories: readonly string[]
  readonly keywords: readonly string[]
  readonly authors: readonly string[]
  readonly homepage?: string | undefined
  readonly icons: readonly string[]
  readonly source: PluginSourceSpec
  readonly policy: Record<string, unknown>
  readonly raw: Record<string, unknown>
  readonly entryDigest: string
}

export interface ParsedMarketplace {
  readonly marketplaceName: string
  readonly marketplaceDescription: string
  readonly owner: readonly string[]
  readonly entries: readonly MarketplacePluginEntry[]
  readonly raw: Record<string, unknown>
}

export class SourceAdapterError extends Error {
  constructor(
    readonly code: string,
    readonly details: readonly string[] = []
  ) {
    super(`${code}${details.length > 0 ? `: ${details.join(', ')}` : ''}`)
    this.name = 'SourceAdapterError'
  }
}

export function parseMarketplaceManifest(input: unknown, source: SourceConfig): ParsedMarketplace {
  const root = record(input, 'MARKETPLACE_NOT_OBJECT')
  const plugins = root.plugins
  if (!Array.isArray(plugins)) throw new SourceAdapterError('MARKETPLACE_PLUGINS_REQUIRED')

  const entries = plugins.map((value, index) => parsePluginEntry(value, source, index))
  const duplicateNames = new Set<string>()
  for (const entry of entries) {
    if (duplicateNames.has(entry.name))
      throw new SourceAdapterError('DUPLICATE_PLUGIN_NAME', [entry.name])
    duplicateNames.add(entry.name)
  }
  return {
    marketplaceName: stringValue(root.name) ?? source.displayName,
    marketplaceDescription: stringValue(root.description) ?? '',
    owner: ownerNames(root.owner),
    entries,
    raw: root,
  }
}

/** Parse JSON while rejecting duplicate object keys instead of accepting last-key-wins input. */
export function parseJsonDocument(text: string): unknown {
  let index = 0
  const skip = () => {
    while (/\s/.test(text[index] ?? '')) index += 1
  }
  const string = (): string => {
    const start = index
    if (text[index] !== '"') throw new SourceAdapterError('JSON_MALFORMED')
    index += 1
    while (index < text.length) {
      const character = text[index]
      if (character === '\\') {
        index += 2
        continue
      }
      if (character === '"') {
        index += 1
        try {
          return JSON.parse(text.slice(start, index)) as string
        } catch {
          throw new SourceAdapterError('JSON_MALFORMED')
        }
      }
      if (character && character < ' ') throw new SourceAdapterError('JSON_MALFORMED')
      index += 1
    }
    throw new SourceAdapterError('JSON_MALFORMED')
  }
  const value = (): unknown => {
    skip()
    const character = text[index]
    if (character === '{') {
      index += 1
      const object: Record<string, unknown> = {}
      const keys = new Set<string>()
      skip()
      if (text[index] === '}') {
        index += 1
        return object
      }
      while (true) {
        skip()
        const key = string()
        if (keys.has(key)) throw new SourceAdapterError('JSON_DUPLICATE_KEY', [key])
        keys.add(key)
        skip()
        if (text[index] !== ':') throw new SourceAdapterError('JSON_MALFORMED')
        index += 1
        object[key] = value()
        skip()
        if (text[index] === '}') {
          index += 1
          return object
        }
        if (text[index] !== ',') throw new SourceAdapterError('JSON_MALFORMED')
        index += 1
      }
    }
    if (character === '[') {
      index += 1
      const array: unknown[] = []
      skip()
      if (text[index] === ']') {
        index += 1
        return array
      }
      while (true) {
        array.push(value())
        skip()
        if (text[index] === ']') {
          index += 1
          return array
        }
        if (text[index] !== ',') throw new SourceAdapterError('JSON_MALFORMED')
        index += 1
      }
    }
    if (character === '"') return string()
    const start = index
    while (index < text.length && !/[\s,\]}]/.test(text[index] ?? '')) index += 1
    const token = text.slice(start, index)
    try {
      return JSON.parse(token) as unknown
    } catch {
      throw new SourceAdapterError('JSON_MALFORMED')
    }
  }
  const parsed = value()
  skip()
  if (index !== text.length) throw new SourceAdapterError('JSON_MALFORMED')
  return parsed
}

function parsePluginEntry(
  value: unknown,
  source: SourceConfig,
  index: number
): MarketplacePluginEntry {
  const entry = record(value, 'PLUGIN_ENTRY_NOT_OBJECT', String(index))
  const name = requiredString(entry.name, 'PLUGIN_NAME_REQUIRED', String(index))
  const rawSource = entry.source
  if (rawSource === undefined) throw new SourceAdapterError('PLUGIN_SOURCE_REQUIRED', [name])
  const sourceSpec = parseSourceSpec(rawSource, source, name)
  const category = stringValue(entry.category)
  const categories = [
    ...(Array.isArray(entry.categories) ? entry.categories.filter(isString) : []),
    ...(category ? [category] : []),
  ]
  return {
    name,
    ...(stringValue(entry.displayName) ? { displayName: stringValue(entry.displayName) } : {}),
    description: stringValue(entry.description) ?? '',
    categories: uniqueStrings(categories),
    keywords: uniqueStrings(Array.isArray(entry.keywords) ? entry.keywords.filter(isString) : []),
    authors: authorNames(entry.author ?? entry.authors),
    ...(safeOptionalUrl(entry.homepage) ? { homepage: safeOptionalUrl(entry.homepage) } : {}),
    icons: uniqueStrings(
      [entry.icon, ...(Array.isArray(entry.icons) ? entry.icons : [])].filter(isString)
    ),
    source: sourceSpec,
    policy: recordOrEmpty(entry.policy),
    raw: entry,
    entryDigest: digest(entry),
  }
}

export function parseSourceSpec(
  value: unknown,
  source: SourceConfig,
  pluginName = 'unknown'
): PluginSourceSpec {
  if (typeof value === 'string') {
    if (looksLikeUrl(value)) {
      return { kind: 'git', repositoryUrl: canonicalRepositoryUrl(value), subdirectory: '' }
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value))
      throw new SourceAdapterError('PLUGIN_SOURCE_SCHEME_UNSUPPORTED', [pluginName, value])
    return { kind: 'local', path: safeRelativePath(value, `PLUGIN_SOURCE_PATH:${pluginName}`) }
  }
  const object = record(value, 'PLUGIN_SOURCE_INVALID', pluginName)
  const kind = stringValue(object.source) ?? stringValue(object.type)
  if (kind === 'local') {
    return {
      kind: 'local',
      path: safeRelativePath(requiredString(object.path, 'LOCAL_PATH_REQUIRED', pluginName)),
    }
  }
  if (kind === 'git-subdir' || kind === 'url' || kind === 'git') {
    const url = canonicalRepositoryUrl(requiredString(object.url, 'GIT_URL_REQUIRED', pluginName))
    const subdirectory =
      kind === 'git-subdir'
        ? safeRelativePath(requiredString(object.path, 'GIT_PATH_REQUIRED', pluginName))
        : ''
    const ref = stringValue(object.ref)
    const sha = stringValue(object.sha)
    if (sha !== undefined && !/^[a-f0-9]{40}$/.test(sha)) {
      throw new SourceAdapterError('GIT_SHA_INVALID', [pluginName, sha])
    }
    return {
      kind: 'git',
      repositoryUrl: url,
      subdirectory,
      ...(ref === undefined ? {} : { ref }),
      ...(sha === undefined ? {} : { sha }),
    }
  }
  throw new SourceAdapterError('PLUGIN_SOURCE_KIND_UNSUPPORTED', [pluginName, kind ?? 'missing'])
}

export function canonicalRepositoryUrl(input: string): string {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new SourceAdapterError('GIT_URL_INVALID', [input])
  }
  if (parsed.protocol !== 'https:')
    throw new SourceAdapterError('GIT_URL_PROTOCOL_UNSUPPORTED', [input])
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new SourceAdapterError('GIT_URL_CREDENTIALS_OR_QUERY_FORBIDDEN', [input])
  }
  const path = parsed.pathname
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)) {
    throw new SourceAdapterError('GIT_URL_REPOSITORY_PATH_INVALID', [input])
  }
  return `https://${parsed.hostname.toLowerCase()}${path}`
}

export function safeRelativePath(input: string, code = 'PATH_INVALID'): string {
  if (!input || input.startsWith('/') || input.startsWith('\\') || /^[A-Za-z]:/.test(input)) {
    throw new SourceAdapterError(code, [input])
  }
  const normalized = input.replaceAll('\\', '/').replace(/^(\.\/)+/, '')
  if (!normalized) throw new SourceAdapterError(code, [input])
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '.'))
    throw new SourceAdapterError('PATH_TRAVERSAL', [input])
  if (parts.some((part) => part.length === 0)) throw new SourceAdapterError(code, [input])
  return parts.join('/')
}

function record(input: unknown, code: string, detail?: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new SourceAdapterError(code, detail ? [detail] : [])
  }
  return input as Record<string, unknown>
}

function recordOrEmpty(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function requiredString(input: unknown, code: string, detail: string): string {
  const result = stringValue(input)
  if (!result) throw new SourceAdapterError(code, [detail])
  return result
}

function stringValue(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined
}

function isString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0
}

function uniqueStrings(input: readonly string[]): string[] {
  return [...new Set(input.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )
}

function authorNames(input: unknown): string[] {
  if (Array.isArray(input)) return uniqueStrings(input.flatMap((item) => authorNames(item)))
  if (typeof input === 'string') return uniqueStrings([input])
  if (input && typeof input === 'object') {
    const object = input as Record<string, unknown>
    const name = stringValue(object.name) ?? stringValue(object.email)
    return name ? [name] : []
  }
  return []
}

function ownerNames(input: unknown): string[] {
  return authorNames(input)
}

function safeOptionalUrl(input: unknown): string | undefined {
  if (!isString(input)) return undefined
  try {
    const parsed = new URL(input)
    return parsed.protocol === 'https:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input)
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}
