import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMaterializationPlan } from '../../harness-adapters/src/index.js'
import { createCatalogInstallationPlan } from '../../harness-adapters/src/agent-plugins.js'
import { parsePluginJson } from '../../catalog-core/src/agent-plugins.js'
import {
  synchronizePortable,
  verifyPortableCatalog,
} from '../../catalog-core/src/portable-catalog.js'
import { HarnessProfileSchema } from '../../catalog-schema/src/agent-plugins.js'
import {
  digest,
  synchronize,
  verifyArtifacts,
  writeArtifacts,
  type CatalogPolicy,
  type CategoryMap,
  type GeneratedArtifacts,
  type ProductAliases,
} from '../../catalog-core/src/index.js'
import {
  HarnessSchema,
  parseCatalog,
  parseSourcesLock,
  type Catalog,
  type SourcesLock,
} from '../../catalog-schema/src/index.js'
import type { SourceConfig } from '../../source-adapters/src/index.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export async function main(
  argv = process.argv.slice(2),
  options: { repositoryRoot?: string } = {}
): Promise<number> {
  let asJson = argv.some((value) => value === '--json' || value === '--json=true')
  try {
    const { command, positionals, flags } = parseArgs(argv)
    asJson = flags.json
    flags.root = options.repositoryRoot ? resolve(options.repositoryRoot) : repositoryRoot
    switch (command) {
      case 'sync':
        return await syncCommand(flags)
      case 'build-catalog':
        return await syncCommand({ ...flags, write: true })
      case 'validate':
        return await validateCommand(flags)
      case 'verify-integrity':
        return await verifyIntegrityCommand(flags)
      case 'inspect':
        return await inspectCommand(positionals[0], flags)
      case 'diff':
        return await diffCommand(positionals[0], positionals[1], flags)
      case 'materialize-plan':
        return await materializeCommand(flags)
      case 'help':
      case undefined:
        console.log(helpText())
        return 0
      default:
        throw new Error(`UNKNOWN_COMMAND: ${command}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (asJson) console.log(JSON.stringify({ ok: false, error: message }))
    else console.error(message)
    return 1
  }
}

async function syncCommand(flags: Flags): Promise<number> {
  const config = await loadConfiguration(flags.root)
  const directory = outputDirectory(flags)
  const existingLock = await readOptionalLock(flags.lockPath, directory)
  const existingCatalog = existingLock ? await readOptionalCatalog(directory) : undefined
  const fromLock = flags.fromLock ? await readRequiredLock(flags.fromLock) : undefined
  const compiler = flags.legacyCatalog ? synchronize : synchronizePortable
  const result = await compiler({
    sources: config.sources,
    categoryMap: config.categoryMap,
    productAliases: config.productAliases,
    policy: config.policy,
    mode: flags.offline ? 'offline' : 'live',
    fixtureRoot: flags.fixtureRoot
      ? resolve(flags.root, flags.fixtureRoot)
      : resolve(flags.root, 'fixtures'),
    ...(flags.source ? { sourceId: flags.source } : {}),
    metadataOnly: flags.metadataOnly || flags.dryRun,
    dryRun: flags.dryRun,
    ...(existingLock ? { existingLock } : {}),
    ...(existingCatalog ? { existingCatalog } : {}),
    ...(flags.legacyCatalog ? { forceRebuild: true } : {}),
    ...(fromLock ? { fromLock } : {}),
  })
  // Metadata-only and dry-run are always non-writing, including with --write.
  if (result.changed && result.artifacts && !flags.dryRun && !flags.metadataOnly) {
    await writeArtifacts(directory, result.artifacts)
  }
  const output = {
    ok: true,
    changed: result.changed,
    dryRun: result.dryRun,
    sourceHeads: result.sourceHeads,
    changeReport: result.changeReport,
    ...(result.catalog
      ? {
          catalogId: result.catalog.catalogId,
          pluginCount: result.catalog.plugins.length,
          sourceCount: result.catalog.sources.length,
        }
      : {}),
  }
  print(output, flags.json)
  return 0
}

async function validateCommand(flags: Flags): Promise<number> {
  const artifacts = await readArtifacts(outputDirectory(flags))
  const catalog = parseCatalog(JSON.parse(artifacts['catalog.v1.json']))
  parseSourcesLock(JSON.parse(artifacts['sources.lock.json']))
  verifyArtifacts(artifacts)
  verifyPortableCatalog(catalog, flags.requirePortable)
  if (flags.schemaOnly) {
    print({ ok: true, schema: 'catalog.v1, sources-lock.v1, generated-integrity' }, flags.json)
    return 0
  }
  const ids = new Set<string>()
  for (const plugin of catalog.plugins) {
    if (ids.has(plugin.pluginId)) throw new Error(`DUPLICATE_PLUGIN_ID: ${plugin.pluginId}`)
    ids.add(plugin.pluginId)
    if (plugin.currentReleaseId !== plugin.availableReleases[0]?.releaseId)
      throw new Error(`CURRENT_RELEASE_INVALID: ${plugin.pluginId}`)
  }
  print(
    {
      ok: true,
      catalogId: catalog.catalogId,
      pluginCount: catalog.plugins.length,
      sourceCount: catalog.sources.length,
    },
    flags.json
  )
  return 0
}

async function verifyIntegrityCommand(flags: Flags): Promise<number> {
  const artifacts = await readArtifacts(outputDirectory(flags))
  verifyArtifacts(artifacts)
  verifyPortableCatalog(
    parseCatalog(JSON.parse(artifacts['catalog.v1.json'])),
    flags.requirePortable
  )
  console.log(
    JSON.stringify({ ok: true, catalogDigest: digest(artifacts['catalog.v1.json']) }, null, 2)
  )
  return 0
}

async function inspectCommand(pluginId: string | undefined, flags: Flags): Promise<number> {
  if (!pluginId) throw new Error('PLUGIN_ID_REQUIRED')
  const catalog = await readCatalog(outputDirectory(flags))
  const plugin = catalog.plugins.find((candidate) => candidate.pluginId === pluginId)
  if (!plugin) throw new Error(`PLUGIN_NOT_FOUND: ${pluginId}`)
  console.log(JSON.stringify(plugin, null, 2))
  return 0
}

async function diffCommand(
  oldPath: string | undefined,
  newPath: string | undefined,
  flags: Flags
): Promise<number> {
  if (!oldPath || !newPath) throw new Error('DIFF_REQUIRES_TWO_LOCK_FILES')
  const oldLock = parseSourcesLock(JSON.parse(await fs.readFile(resolve(oldPath), 'utf8')))
  const newLock = parseSourcesLock(JSON.parse(await fs.readFile(resolve(newPath), 'utf8')))
  const changes = newLock.sources.map((source) => {
    const previous = oldLock.sources.find((candidate) => candidate.sourceId === source.sourceId)
    return {
      sourceId: source.sourceId,
      before: previous?.resolvedCommitSha ?? null,
      after: source.resolvedCommitSha,
      changed: previous?.resolvedCommitSha !== source.resolvedCommitSha,
    }
  })
  print({ ok: true, changes }, flags.json)
  return 0
}

async function materializeCommand(flags: Flags): Promise<number> {
  const pluginId = flags.plugin
  if (!pluginId) throw new Error('MATERIALIZE_REQUIRES_PLUGIN')
  const catalog = await readCatalog(outputDirectory(flags))
  if (flags.legacyPlan) {
    if (!flags.harness) throw new Error('LEGACY_PLAN_REQUIRES_HARNESS')
    const plan = createMaterializationPlan({
      catalog,
      pluginId,
      harness: HarnessSchema.parse(flags.harness),
      ...(flags.version ? { releaseId: flags.version } : {}),
    })
    print(plan, flags.json)
    return 0
  }
  if (!flags.capabilities || !flags.instance) {
    throw new Error(
      'PLAN_V2_REQUIRES_CAPABILITIES_AND_INSTANCE: provide the actual Control Plane adapter profile and a stable installation scope'
    )
  }
  const profile = HarnessProfileSchema.parse(
    parsePluginJson(await fs.readFile(resolve(flags.capabilities), 'utf8'))
  )
  if (flags.harness && flags.harness !== profile.harness)
    throw new Error('HARNESS_PROFILE_MISMATCH')
  const plan = createCatalogInstallationPlan({
    catalog,
    pluginId,
    ...(flags.version ? { releaseId: flags.version } : {}),
    instanceId: flags.instance,
    profile,
    allowPartial: flags.allowPartial,
  })
  print(plan, flags.json)
  return 0
}

async function loadConfiguration(root: string): Promise<{
  sources: SourceConfig[]
  categoryMap: CategoryMap
  productAliases: ProductAliases
  policy: CatalogPolicy
}> {
  const configDirectory = join(root, 'config')
  const [sources, categoryMap, productAliases, policy] = await Promise.all([
    readJson<{ sources: SourceConfig[] }>(join(configDirectory, 'sources.json')),
    readJson<CategoryMap>(join(configDirectory, 'category-map.json')),
    readJson<ProductAliases>(join(configDirectory, 'product-aliases.json')),
    readJson<CatalogPolicy>(join(configDirectory, 'policy.json')),
  ])
  return { sources: sources.sources, categoryMap, productAliases, policy }
}

async function readCatalog(directory: string): Promise<Catalog> {
  const artifacts = await readArtifacts(directory)
  verifyArtifacts(artifacts)
  const catalog = parseCatalog(JSON.parse(artifacts['catalog.v1.json']))
  verifyPortableCatalog(catalog)
  return catalog
}

async function readOptionalCatalog(directory: string): Promise<Catalog | undefined> {
  try {
    return await readCatalog(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function readOptionalLock(
  path: string | undefined,
  directory: string
): Promise<SourcesLock | undefined> {
  try {
    return parseSourcesLock(
      JSON.parse(
        await fs.readFile(path ? resolve(path) : join(directory, 'sources.lock.json'), 'utf8')
      )
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !path) return undefined
    throw error
  }
}

async function readRequiredLock(path: string): Promise<SourcesLock> {
  return parseSourcesLock(JSON.parse(await fs.readFile(resolve(path), 'utf8')))
}

async function readArtifacts(directory: string): Promise<GeneratedArtifacts> {
  const names = [
    'catalog.v1.json',
    'catalog-summary.v1.json',
    'sources.lock.json',
    'compatibility.v1.json',
    'categories.v1.json',
    'integrity.json',
  ] as const
  const values = await Promise.all(
    names.map(async (name) => [name, await fs.readFile(join(directory, name), 'utf8')] as const)
  )
  return Object.fromEntries(values) as unknown as GeneratedArtifacts
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as T
}

function print(value: unknown, asJson: boolean): void {
  console.log(asJson ? JSON.stringify(value) : JSON.stringify(value, null, 2))
}

function outputDirectory(flags: Flags): string {
  return flags.output ? resolve(flags.output) : join(flags.root, 'generated')
}

interface Flags {
  root: string
  legacyCatalog: boolean
  legacyPlan: boolean
  allowPartial: boolean
  requirePortable: boolean
  capabilities: string | undefined
  instance: string | undefined
  output: string | undefined
  json: boolean
  offline: boolean
  dryRun: boolean
  metadataOnly: boolean
  write: boolean
  schemaOnly: boolean
  source: string | undefined
  fixtureRoot: string | undefined
  lockPath: string | undefined
  fromLock: string | undefined
  plugin: string | undefined
  harness: string | undefined
  version: string | undefined
}

function parseArgs(argv: readonly string[]): {
  command: string | undefined
  positionals: string[]
  flags: Flags
} {
  const flags: Flags = {
    root: repositoryRoot,
    legacyCatalog: false,
    legacyPlan: false,
    allowPartial: false,
    requirePortable: false,
    capabilities: undefined,
    instance: undefined,
    output: undefined,
    json: false,
    offline: false,
    dryRun: false,
    metadataOnly: false,
    write: false,
    schemaOnly: false,
    source: undefined,
    fixtureRoot: undefined,
    lockPath: undefined,
    fromLock: undefined,
    plugin: undefined,
    harness: undefined,
    version: undefined,
  }
  const positionals: string[] = []
  let command: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value) continue
    if (!value.startsWith('-') && command === undefined) {
      command = value
      continue
    }
    if (!value.startsWith('-')) {
      positionals.push(value)
      continue
    }
    const equals = value.indexOf('=')
    const key = equals < 0 ? value : value.slice(0, equals)
    const inlineValue = equals < 0 ? undefined : value.slice(equals + 1)
    const next = inlineValue ?? argv[index + 1]
    const takeValue = () => {
      if (
        next === undefined ||
        next.length === 0 ||
        (inlineValue === undefined && next.startsWith('--'))
      )
        throw new Error(`FLAG_VALUE_REQUIRED: ${key}`)
      if (inlineValue === undefined) index += 1
      return next
    }
    const takeBoolean = (): boolean => {
      if (inlineValue === undefined || inlineValue === 'true') return true
      if (inlineValue === 'false') return false
      throw new Error(`BOOLEAN_FLAG_INVALID: ${key}`)
    }
    switch (key) {
      case '--legacy-catalog':
        flags.legacyCatalog = takeBoolean()
        break
      case '--legacy-plan':
        flags.legacyPlan = takeBoolean()
        break
      case '--allow-partial':
        flags.allowPartial = takeBoolean()
        break
      case '--require-portable':
        flags.requirePortable = takeBoolean()
        break
      case '--capabilities':
        flags.capabilities = takeValue()
        break
      case '--instance':
        flags.instance = takeValue()
        break
      case '--output':
        flags.output = takeValue()
        break
      case '--json':
        flags.json = takeBoolean()
        break
      case '--offline':
        flags.offline = takeBoolean()
        break
      case '--dry-run':
        flags.dryRun = takeBoolean()
        break
      case '--metadata-only':
        flags.metadataOnly = takeBoolean()
        break
      case '--write':
        flags.write = takeBoolean()
        break
      case '--schema-only':
        flags.schemaOnly = takeBoolean()
        break
      case '--source': {
        const option = takeValue()
        if (option !== undefined) flags.source = option
        break
      }
      case '--fixture-root': {
        const option = takeValue()
        if (option !== undefined) flags.fixtureRoot = option
        break
      }
      case '--lock': {
        const option = takeValue()
        if (option !== undefined) flags.lockPath = option
        break
      }
      case '--from-lock': {
        const option = takeValue()
        if (option !== undefined) flags.fromLock = option
        break
      }
      case '--plugin': {
        const option = takeValue()
        if (option !== undefined) flags.plugin = option
        break
      }
      case '--harness': {
        const option = takeValue()
        if (option !== undefined) flags.harness = option
        break
      }
      case '--version': {
        const option = takeValue()
        if (option !== undefined) flags.version = option
        break
      }
      case '--help':
        command = 'help'
        break
      default:
        throw new Error(`UNKNOWN_FLAG: ${key}`)
    }
  }
  return { command, positionals, flags }
}

function helpText(): string {
  return `plugins marketplace CLI

Commands:
  sync [--offline --fixture-root fixtures] [--dry-run] [--source ID] [--from-lock PATH]
       [--output DIR] [--legacy-catalog]
  validate [--schema-only] [--require-portable] [--output DIR]
  inspect <plugin-id>
  diff <old-lock> <new-lock>
  materialize-plan --plugin ID --capabilities PROFILE.json --instance SCOPE
                   [--harness ID] [--version RELEASE_ID] [--allow-partial] [--output DIR]
  materialize-plan --legacy-plan --plugin ID --harness ID [--version RELEASE_ID]
  build-catalog [--offline] [--write]
  verify-integrity

All commands support --json. Synchronization never executes upstream content.
Agent Plugins normalization and plan v2 are the defaults. Plans are not execution grants.
Dry-run and metadata-only never publish artifacts, even with --write.
Use --legacy-catalog only for v1 fixture compatibility or explicit rollback.`
}

if (import.meta.main) process.exitCode = await main()
