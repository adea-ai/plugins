import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { posix } from 'node:path'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { parseDocument } from 'yaml'
import {
  AGENT_PLUGINS_VERSION,
  PLUGIN_SCHEMA_ID,
  MCP_SCHEMA_ID,
  NORMALIZER_VERSION,
  AgentManifestSchema,
  McpServerSchema,
  SkillFrontmatterSchema,
  AgentPackageSchema,
  type AgentManifest,
  type McpServer,
  type AgentPackage,
  type PackageFile,
  type Diagnostic,
} from '@adea-ai/catalog-schema/agent-plugins'

export { NORMALIZER_VERSION }
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()
const manifestKeys = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
])
const extensionName = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
const remoteTransportHeaders = new Set([
  'authorization',
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .toSorted(compare)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}
export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}
/** Existing v1 source-byte identity, deliberately distinct from the derived package identity. */
export function sourceDigest(files: ReadonlyMap<string, Uint8Array>): string {
  const hash = createHash('sha256')
  for (const [path, bytes] of [...files].toSorted(([a], [b]) => a.localeCompare(b))) {
    hash.update(`${path.length}:${path}:${bytes.byteLength}:`)
    hash.update(bytes)
  }
  return `sha256:${hash.digest('hex')}`
}
export function packageDigest(files: readonly PackageFile[]): string {
  return sha256(
    stableJson({
      algorithm: 'adea-package-files/1',
      files: [...files]
        .toSorted((a, b) => compare(a.targetPath, b.targetPath))
        .map((file) => ({
          path: file.targetPath,
          digest: file.digest,
          mode: file.action === 'copy' ? 'preserve-source' : file.mode,
        })),
    })
  )
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
/** JSON grammar plus duplicate-key detection, including escaped/nested keys. No reviver or code evaluation. */
export function parsePluginJson(text: string): unknown {
  const value: unknown = JSON.parse(text)
  const document = parseDocument(text, { schema: 'json', uniqueKeys: true, strict: true })
  if (document.errors.length > 0) throw new Error('Invalid or duplicate JSON object key.')
  return value
}
function hasControlCharacters(value: string, includeSpace = false): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (code < (includeSpace ? 33 : 32) || code === 127) return true
  }
  return false
}

export function assertPackagePath(path: string): void {
  if (
    !path ||
    path.length > 1024 ||
    /[\\:]/.test(path) ||
    hasControlCharacters(path) ||
    path.startsWith('/') ||
    path
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )
  ) {
    throw new Error('Unsafe package-relative path.')
  }
}
/** Lexical checks do not replace realpath containment checks at activation time. */
export function containedRelative(path: string): string {
  if (path.includes('\\') || hasControlCharacters(path)) throw new Error('Invalid path characters.')
  const normalized = posix.normalize(path)
  if (
    normalized.startsWith('/') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    /^[A-Za-z]:/.test(normalized)
  )
    throw new Error('Path escapes its root.')
  return normalized
}
function checkCwd(cwd: string): void {
  const prefix = ['./', '${PLUGIN_ROOT}', '${PLUGIN_DATA}'].find((candidate) =>
    candidate === './'
      ? cwd.startsWith(candidate)
      : cwd === candidate || cwd.startsWith(`${candidate}/`)
  )
  if (!prefix) throw new Error('cwd must be rooted in the plugin or plugin data directory.')
  const suffix = prefix === './' ? cwd.slice(2) : cwd.slice(prefix.length).replace(/^\//, '')
  if (/\$\{(?:PLUGIN_ROOT|PLUGIN_DATA)\}/.test(suffix))
    throw new Error('cwd cannot combine filesystem roots.')
  containedRelative(suffix || '.')
}
function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '')
  return host === 'localhost' || (isIP(host) === 4 && host.startsWith('127.')) || host === '::1'
}
export function validateServer(input: unknown): McpServer {
  const server = McpServerSchema.parse(input)
  if (server.type === 'stdio') {
    if (server.command.startsWith('./')) {
      const path = containedRelative(server.command.slice(2))
      if (path === '.' || path.includes('${')) throw new Error('Invalid package executable.')
    } else if (
      !/^[^\s/\\:$]+$/.test(server.command) ||
      hasControlCharacters(server.command) ||
      server.command === '.' ||
      server.command === '..'
    ) {
      throw new Error(
        'command must be one bare executable or ./package-relative path; no shell strings or expansion.'
      )
    }
    for (const [key, value] of Object.entries(server.env ?? {})) {
      if (/^(PLUGIN_ROOT|PLUGIN_DATA)$/i.test(key))
        throw new Error('Reserved plugin environment variable.')
      if (!key || key.includes('=') || key.includes('\0') || value.includes('\0'))
        throw new Error('Invalid environment entry.')
    }
    if (server.args?.some((arg) => arg.includes('\0'))) throw new Error('Invalid argument.')
    if (server.cwd !== undefined) checkCwd(server.cwd)
  } else {
    const url = new URL(server.url)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      server.url.includes('#') ||
      /^https?:\/\/[^/]*@/.test(server.url) ||
      server.url.includes('\\') ||
      hasControlCharacters(server.url, true) ||
      (url.protocol !== 'https:' && !isLoopback(url.hostname))
    )
      throw new Error(
        'Remote MCP requires HTTPS, except HTTP loopback; credentials and fragments are forbidden.'
      )
    const keys = new Set<string>()
    for (const [key, value] of Object.entries(server.headers ?? {})) {
      validateHeaderName(key)
      validateHeaderValue(key, value)
      const folded = key.toLowerCase()
      if (remoteTransportHeaders.has(folded))
        throw new Error('Protocol-owned or authorization HTTP header.')
      if (keys.has(folded)) throw new Error('Duplicate case-insensitive HTTP header.')
      keys.add(folded)
    }
  }
  return server
}

function portableName(name: string): string {
  const cleaned =
    name
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/\.+/g, '.')
      .replace(/^[.-]+|[.-]+$/g, '') || 'plugin'
  return cleaned.length <= 64
    ? cleaned
    : `${cleaned.slice(0, 54).replace(/[.-]+$/, '')}-${sha256(name).slice(-8)}`
}
function diagnostic(
  code: string,
  scope: Diagnostic['scope'],
  path: string,
  message: string,
  severity: Diagnostic['severity'] = 'error'
): Diagnostic {
  return { code, scope, path, severity, message }
}
function nativeManifest(raw: unknown, diagnostics: Diagnostic[]): AgentManifest {
  if (!isRecord(raw)) throw new Error('The root manifest must be an object.')
  const filtered = Object.fromEntries(Object.entries(raw).filter(([key]) => manifestKeys.has(key)))
  for (const key of Object.keys(raw)
    .filter((field) => !manifestKeys.has(field))
    .toSorted(compare))
    diagnostics.push(
      diagnostic(
        'UNKNOWN_MANIFEST_FIELD',
        'plugin',
        `plugin.json/${key}`,
        'Unknown core field ignored; it does not override fixed component locations.',
        'warning'
      )
    )
  if (own(filtered, 'extensions')) {
    if (!isRecord(filtered.extensions)) {
      delete filtered.extensions
      diagnostics.push(
        diagnostic(
          'INVALID_EXTENSIONS',
          'extension',
          'plugin.json/extensions',
          'Non-object extensions field ignored.',
          'warning'
        )
      )
    } else {
      // No extension namespace is implemented by this portable compiler.
      // Never recursively validate an unknown namespace's client-owned data.
      const extensions = Object.fromEntries(
        Object.entries(filtered.extensions).filter(([key, value]) => {
          if (extensionName.test(key) && isRecord(value)) return true
          diagnostics.push(
            diagnostic(
              'IGNORED_EXTENSION',
              'extension',
              `plugin.json/extensions/${key}`,
              'Unimplemented extension data is opaque and was not projected into the portable manifest.',
              'warning'
            )
          )
          return false
        })
      )
      filtered.extensions = extensions
    }
  }
  return AgentManifestSchema.parse(filtered)
}
function legacyManifest(raw: Record<string, unknown>, name: string): AgentManifest {
  const output: Record<string, unknown> = { $schema: PLUGIN_SCHEMA_ID, name: portableName(name) }
  for (const key of ['version', 'description', 'homepage', 'repository', 'license'])
    if (typeof raw[key] === 'string') output[key] = raw[key]
  if (typeof raw.author === 'string') output.author = { name: raw.author }
  else if (isRecord(raw.author))
    output.author = Object.fromEntries(
      Object.entries(raw.author).filter(
        ([key, value]) => ['name', 'email', 'url'].includes(key) && typeof value === 'string'
      )
    )
  if (Array.isArray(raw.keywords))
    output.keywords = raw.keywords.filter((item) => typeof item === 'string')
  return AgentManifestSchema.parse(output)
}
function replaceLegacyRoot(value: string): string {
  return value
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}')
    .replaceAll('${CURSOR_PLUGIN_ROOT}', '${PLUGIN_ROOT}')
}
function translateLegacyServer(input: unknown): McpServer {
  if (!isRecord(input)) throw new Error('Server must be an object.')
  const out = { ...input }
  if (out.type === 'http') out.type = 'streamable-http'
  if (out.type === undefined && typeof out.command === 'string') out.type = 'stdio'
  // A URL alone is ambiguous across legacy dialects. Never infer transport from a suffix.
  if (out.type === undefined)
    throw new Error('Legacy remote server must declare http, streamable-http, or sse explicitly.')
  if (typeof out.command === 'string') {
    const command = replaceLegacyRoot(out.command)
    out.command = command.startsWith('${PLUGIN_ROOT}/')
      ? `./${command.slice('${PLUGIN_ROOT}/'.length)}`
      : command
  }
  if (Array.isArray(out.args))
    out.args = out.args.map((arg) => (typeof arg === 'string' ? replaceLegacyRoot(arg) : arg))
  if (isRecord(out.env))
    out.env = Object.fromEntries(
      Object.entries(out.env).map(([key, value]) => [
        key,
        typeof value === 'string' ? replaceLegacyRoot(value) : value,
      ])
    )
  if (typeof out.cwd === 'string') out.cwd = replaceLegacyRoot(out.cwd)
  const strings: string[] = []
  const collect = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (isRecord(value)) Object.values(value).forEach(collect)
  }
  collect(out)
  if (strings.some((value) => /\$\{(?!PLUGIN_ROOT\}|PLUGIN_DATA\})[^}]+\}/.test(value)))
    throw new Error(
      'Legacy environment/credential interpolation needs an explicit Control Plane binding; it is not portable substitution.'
    )
  if (
    out.type !== 'stdio' &&
    strings.some((value) => /\$\{(?:PLUGIN_ROOT|PLUGIN_DATA)\}/.test(value))
  )
    throw new Error('Remote MCP fields cannot use plugin path expansion.')
  return validateServer(out)
}

export interface CompilePackageInput {
  readonly files: ReadonlyMap<string, Uint8Array>
  readonly symlinks?: readonly string[]
  readonly name: string
  readonly sourceDigest?: string
}
/** Compile a package recipe only. No writes, subprocesses, network access or lifecycle scripts. */
export function compileAgentPackage(input: CompilePackageInput): AgentPackage {
  const diagnostics: Diagnostic[] = []
  const nonPortable: AgentPackage['nonPortable'] = []
  const skills: AgentPackage['skills'] = []
  const servers = new Map<string, McpServer>()
  const omitted = new Set<string>()
  const files = input.files
  const originFormat =
    files.has('plugin.json') &&
    (() => {
      try {
        const raw = parsePluginJson(decoder.decode(files.get('plugin.json')!))
        return isRecord(raw) && own(raw, '$schema')
      } catch {
        return true
      }
    })()
      ? 'agent-plugins'
      : 'legacy'
  const actualSourceDigest = sourceDigest(files)
  const base = {
    contractVersion: 1 as const,
    normalizerVersion: NORMALIZER_VERSION,
    format: 'agent-plugins' as const,
    specVersion: AGENT_PLUGINS_VERSION,
    originFormat,
    sourceDigest: actualSourceDigest,
    skills,
    nonPortable,
    diagnostics,
  }
  const unavailable = (message: string): AgentPackage =>
    AgentPackageSchema.parse({
      ...base,
      status: 'unavailable',
      skills: [],
      files: [],
      mcpServers: {},
      requirements: { skills: false, mcpTransports: [], executables: [], environmentReview: true },
      diagnostics: [...diagnostics, diagnostic('INVALID_PLUGIN', 'plugin', 'plugin.json', message)],
    })
  try {
    if (input.sourceDigest && input.sourceDigest !== actualSourceDigest)
      throw new Error('Source content digest mismatch.')
    if (input.symlinks?.length) throw new Error('Symlinks are excluded by marketplace policy.')
    const paths = new Set<string>()
    const spellings = new Map<string, string>()
    let total = 0
    if (files.size > 4096) throw new Error('Package exceeds file-count policy.')
    for (const [path, bytes] of files) {
      assertPackagePath(path)
      const folded = path.normalize('NFC').toLowerCase()
      if (paths.has(folded)) throw new Error('Case/Unicode-normalization path collision.')
      paths.add(folded)
      for (let component = path; component !== '.'; component = posix.dirname(component)) {
        const key = component.normalize('NFC').toLowerCase()
        if (spellings.has(key) && spellings.get(key) !== component)
          throw new Error('Case/Unicode-normalization directory collision.')
        spellings.set(key, component)
      }
      total += bytes.byteLength
      if (bytes.byteLength > 5 * 1024 * 1024 || total > 50 * 1024 * 1024)
        throw new Error('Package exceeds byte-size policy.')
      for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent))
        if (files.has(parent)) throw new Error('File/directory path collision.')
    }
    for (const path of paths)
      for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent))
        if (paths.has(parent)) throw new Error('File/directory path collision.')
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : 'Invalid snapshot.')
  }
  let manifest: AgentManifest
  let rawManifest: Record<string, unknown> = {}
  let manifestSourcePath = 'plugin.json'
  try {
    if (originFormat === 'agent-plugins') {
      const raw = parsePluginJson(decoder.decode(files.get('plugin.json')!))
      manifest = nativeManifest(raw, diagnostics)
      rawManifest = isRecord(raw) ? raw : {}
    } else {
      const manifestPath = [
        'plugin.json',
        '.claude-plugin/plugin.json',
        '.cursor-plugin/plugin.json',
        '.codex-plugin/plugin.json',
        '.agents/plugin.json',
      ].find((path) => files.has(path))
      if (manifestPath) {
        manifestSourcePath = manifestPath
        const raw = parsePluginJson(decoder.decode(files.get(manifestPath)!))
        if (!isRecord(raw)) throw new Error('Legacy manifest is not an object.')
        rawManifest = raw
      }
      manifest = legacyManifest(rawManifest, input.name)
      const declarations = Array.isArray(rawManifest.skills)
        ? rawManifest.skills
        : [rawManifest.skills]
      if (
        rawManifest.skills !== undefined &&
        !declarations.every((path) => path === './skills' || path === './skills/')
      )
        nonPortable.push({
          kind: 'legacy-skill-discovery',
          paths: [manifestSourcePath],
          reason:
            'Custom skill discovery declarations need review. Only fixed skills/<name>/SKILL.md directories are projected.',
        })
    }
  } catch {
    return unavailable(
      'Root manifest is malformed, has invalid required metadata, or declares an unsupported schema. No legacy fallback is attempted.'
    )
  }

  if (files.has('skills')) {
    omitted.add('skills')
    diagnostics.push(
      diagnostic('INVALID_SKILLS_LOCATION', 'skills', 'skills', 'skills must be a directory.')
    )
  }
  for (const [path, bytes] of [...files].toSorted(([a], [b]) => compare(a, b))) {
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(path)
    if (!match) continue
    try {
      const text = decoder.decode(bytes)
      const frontmatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
        text
      )?.[1]
      if (frontmatter === undefined) throw new Error('Missing YAML frontmatter.')
      const document = parseDocument(frontmatter, { uniqueKeys: true, strict: true })
      if (document.errors.length || document.warnings.length)
        throw new Error('Invalid or unsupported YAML.')
      const skill = SkillFrontmatterSchema.parse(document.toJS({ maxAliasCount: 100 }))
      if (skill.name !== match[1]) throw new Error('Skill name must match its directory.')
      skills.push({
        name: skill.name,
        path: posix.dirname(path),
        description: skill.description,
        ...(skill.compatibility ? { compatibility: skill.compatibility } : {}),
        ...(skill['allowed-tools'] ? { allowedTools: skill['allowed-tools'] } : {}),
      })
    } catch {
      omitted.add(path)
      diagnostics.push(
        diagnostic(
          'INVALID_SKILL',
          'skill',
          path,
          'Invalid Agent Skills frontmatter; this skill is excluded without disabling other components.'
        )
      )
    }
  }
  // Deeper SKILL.md files are resources, never additional discovered skills.
  let mcpEntries: Record<string, unknown> = {}
  let mcpPath = 'mcp.json'
  try {
    if (originFormat === 'agent-plugins') {
      if ([...files.keys()].some((path) => path.startsWith('mcp.json/')))
        throw new Error('mcp.json is not a file.')
      if (files.has('mcp.json')) {
        const root = parsePluginJson(decoder.decode(files.get('mcp.json')!))
        if (
          !isRecord(root) ||
          root.$schema !== MCP_SCHEMA_ID ||
          !isRecord(root.mcpServers) ||
          Object.keys(root).some((key) => !['$schema', 'mcpServers'].includes(key))
        )
          throw new Error('Invalid MCP root/schema.')
        mcpEntries = root.mcpServers
      }
    } else {
      const candidates = ['mcp.json', '.mcp.json'].filter((path) => files.has(path))
      const declared = rawManifest.mcpServers ?? rawManifest.mcp
      if (typeof declared === 'string') {
        const path = declared.replace(/^\.\//, '')
        assertPackagePath(path)
        if (!files.has(path)) throw new Error('Declared MCP file is missing.')
        if (!candidates.includes(path)) candidates.push(path)
      } else if (declared !== undefined && !isRecord(declared))
        throw new Error('Unsupported legacy MCP declaration.')
      if (candidates.length + (isRecord(declared) ? 1 : 0) > 1)
        throw new Error('Ambiguous legacy MCP sources require an explicit translation.')
      if (candidates.length) {
        mcpPath = candidates[0]!
        const root = parsePluginJson(decoder.decode(files.get(mcpPath)!))
        if (!isRecord(root)) throw new Error('Invalid legacy MCP document.')
        mcpEntries = isRecord(root.mcpServers) ? root.mcpServers : root
      } else if (isRecord(declared)) mcpEntries = declared
    }
  } catch {
    diagnostics.push(
      diagnostic(
        'INVALID_MCP_CONFIGURATION',
        'mcp',
        mcpPath,
        'MCP configuration/schema/location is invalid or ambiguous; other component types remain available.'
      )
    )
    mcpEntries = {}
  }
  for (const [name, inputServer] of Object.entries(mcpEntries).toSorted(([a], [b]) =>
    compare(a, b)
  )) {
    try {
      if (['__proto__', 'constructor', 'prototype'].includes(name) || hasControlCharacters(name))
        throw new Error('Unsafe server identifier under marketplace policy.')
      const server =
        originFormat === 'agent-plugins'
          ? validateServer(inputServer)
          : translateLegacyServer(inputServer)
      if (
        server.type === 'stdio' &&
        server.command.startsWith('./') &&
        !files.has(containedRelative(server.command.slice(2)))
      )
        throw new Error('Bundled executable is missing.')
      servers.set(name, server)
    } catch {
      diagnostics.push(
        diagnostic(
          'INVALID_MCP_SERVER',
          'server',
          `${mcpPath}#${name}`,
          'Server is invalid or needs an explicit legacy transport/credential/path translation. It is excluded; no transport or authorization behavior is guessed.'
        )
      )
    }
  }
  const extras = new Map<string, string[]>()
  for (const path of files.keys()) {
    const top = path.split('/')[0]!
    const lower = path.toLowerCase()
    const kind = [
      'commands',
      'agents',
      'hooks',
      'rules',
      'subagents',
      'schedules',
      'cron',
      'ui',
      'components',
    ].includes(top)
      ? top
      : ['claude.md', 'agents.md'].includes(lower) || lower.startsWith('.cursor/rules/')
        ? 'rules'
        : lower === 'hooks.json'
          ? 'hooks'
          : ['.claude', '.cursor', '.agents'].includes(top) ||
              (extensionName.test(top) && path.includes('/'))
            ? 'client-extension'
            : undefined
    if (kind) extras.set(kind, [...(extras.get(kind) ?? []), path])
  }
  for (const key of ['commands', 'agents', 'hooks', 'rules'])
    if (rawManifest[key] !== undefined)
      extras.set(key, [...(extras.get(key) ?? []), manifestSourcePath])
  for (const key of Object.keys(manifest.extensions ?? {}))
    extras.set('client-extension', [
      ...(extras.get('client-extension') ?? []),
      `plugin.json/extensions/${key}`,
    ])
  for (const [kind, paths] of [...extras].toSorted(([a], [b]) => compare(a, b)))
    nonPortable.push({
      kind,
      paths: [...new Set(paths)].toSorted(compare),
      reason:
        'Preserved as source content, not activated or presented as portable Agent Plugins behavior.',
    })

  const operations: PackageFile[] = []
  for (const [path, bytes] of files) {
    if (
      path === 'plugin.json' ||
      path === 'mcp.json' ||
      path.startsWith('plugin.json/') ||
      path.startsWith('mcp.json/') ||
      omitted.has(path)
    )
      continue
    operations.push({
      action: 'copy',
      sourcePath: path,
      targetPath: path,
      digest: sha256(bytes),
      preserveMode: true,
    })
  }
  const mcpServers = Object.fromEntries(servers)
  for (const [targetPath, data] of [
    ['plugin.json', manifest],
    ['mcp.json', { $schema: MCP_SCHEMA_ID, mcpServers }],
  ] as const) {
    const content = stableJson(data) + '\n'
    operations.push({ action: 'write', targetPath, content, digest: sha256(content), mode: '0644' })
  }
  operations.sort((a, b) => compare(a.targetPath, b.targetPath))
  const values = [...servers.values()]
  const local = values.filter((server) => server.type === 'stdio')
  diagnostics.sort((a, b) => compare(`${a.path}:${a.code}`, `${b.path}:${b.code}`))
  try {
    return verifyAgentPackage({
      ...base,
      manifest,
      status:
        diagnostics.some((item) => item.severity === 'error') || nonPortable.length
          ? 'partial'
          : 'portable',
      packageDigest: packageDigest(operations),
      files: operations,
      mcpServers,
      requirements: {
        skills: skills.length > 0,
        mcpTransports: [...new Set(values.map((server) => server.type))].toSorted(compare),
        executables: [...new Set(local.map((server) => server.command))].toSorted(compare),
        environmentReview:
          local.length > 0 ||
          skills.some((skill) => !!skill.compatibility || !!skill.allowedTools) ||
          [...files.keys()].some((path) => /(?:^|\/)scripts\//.test(path)),
      },
    })
  } catch {
    return unavailable(
      'Canonical output contains conflicting paths or inconsistent component metadata.'
    )
  }
}

export function verifyAgentPackage(input: unknown): AgentPackage {
  const pkg = AgentPackageSchema.parse(input)
  if (pkg.status === 'unavailable') {
    if (
      pkg.manifest ||
      pkg.packageDigest ||
      pkg.files.length ||
      pkg.skills.length ||
      Object.keys(pkg.mcpServers).length
    )
      throw new Error('Unavailable package contains activatable content.')
    return pkg
  }
  if (!pkg.manifest || !pkg.packageDigest || packageDigest(pkg.files) !== pkg.packageDigest)
    throw new Error('Canonical package digest/manifest mismatch.')
  const paths = new Set<string>()
  for (const file of pkg.files) {
    assertPackagePath(file.targetPath)
    const key = file.targetPath.normalize('NFC').toLowerCase()
    if (paths.has(key)) throw new Error('Duplicate package target.')
    paths.add(key)
    if (file.action === 'copy') assertPackagePath(file.sourcePath)
    else if (sha256(file.content) !== file.digest)
      throw new Error('Generated file digest mismatch.')
  }
  for (const path of paths)
    for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent))
      if (paths.has(parent)) throw new Error('File/directory target collision.')
  const generated = (path: string): unknown => {
    const file = pkg.files.find((entry) => entry.targetPath === path)
    if (!file || file.action !== 'write') throw new Error('Missing canonical control file.')
    return parsePluginJson(file.content)
  }
  if (stableJson(generated('plugin.json')) !== stableJson(pkg.manifest))
    throw new Error('Manifest descriptor differs from package bytes.')
  if (
    stableJson(generated('mcp.json')) !==
    stableJson({ $schema: MCP_SCHEMA_ID, mcpServers: pkg.mcpServers })
  )
    throw new Error('MCP descriptor differs from package bytes.')
  for (const server of Object.values(pkg.mcpServers)) validateServer(server)
  const names = new Set<string>()
  for (const skill of pkg.skills) {
    if (
      skill.path !== `skills/${skill.name}` ||
      names.has(skill.name) ||
      !paths.has(`${skill.path}/SKILL.md`.toLowerCase())
    )
      throw new Error('Invalid skill directory binding.')
    names.add(skill.name)
  }
  const discovered = pkg.files
    .map((file) => /^skills\/([^/]+)\/SKILL\.md$/.exec(file.targetPath)?.[1])
    .filter((name) => name !== undefined)
  if (discovered.length !== names.size || discovered.some((name) => !names.has(name)))
    throw new Error('Skill inventory differs from package discovery.')
  const expectedTransports = [
    ...new Set(Object.values(pkg.mcpServers).map((server) => server.type)),
  ].toSorted(compare)
  const expectedExecutables = [
    ...new Set(
      Object.values(pkg.mcpServers)
        .filter((server) => server.type === 'stdio')
        .map((server) => server.command)
    ),
  ].toSorted(compare)
  if (
    stableJson([...pkg.requirements.executables].toSorted(compare)) !==
    stableJson(expectedExecutables)
  )
    throw new Error('Package executable requirements differ from components.')
  if (
    pkg.requirements.skills !== pkg.skills.length > 0 ||
    stableJson([...pkg.requirements.mcpTransports].toSorted(compare)) !==
      stableJson(expectedTransports)
  )
    throw new Error('Package requirements differ from components.')
  if (
    pkg.status === 'portable' &&
    (pkg.nonPortable.length || pkg.diagnostics.some((item) => item.severity === 'error'))
  )
    throw new Error('Partial package is marked fully portable.')
  return pkg
}

/** Apply a verified recipe in memory. Filesystem installation/approval remains Control Plane-owned. */
export function materializeAgentPackage(
  input: unknown,
  source: ReadonlyMap<string, Uint8Array>
): Map<string, Uint8Array> {
  const pkg = verifyAgentPackage(input)
  if (pkg.status === 'unavailable' || sourceDigest(source) !== pkg.sourceDigest)
    throw new Error('Unavailable package or source digest mismatch.')
  const rebuilt = compileAgentPackage({
    files: source,
    name: pkg.manifest!.name,
    sourceDigest: pkg.sourceDigest,
  })
  if (stableJson(rebuilt) !== stableJson(pkg))
    throw new Error('Recipe differs from deterministic source normalization.')
  const result = new Map<string, Uint8Array>()
  for (const file of pkg.files) {
    const bytes =
      file.action === 'write' ? encoder.encode(file.content) : source.get(file.sourcePath)
    if (!bytes || sha256(bytes) !== file.digest)
      throw new Error('Package file missing or digest mismatch.')
    result.set(file.targetPath, bytes.slice())
  }
  return result
}
