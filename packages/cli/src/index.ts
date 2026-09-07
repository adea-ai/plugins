import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMaterializationPlan } from '../../harness-adapters/src/index.js'
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
const generatedDirectory = join(repositoryRoot, 'generated')
const configDirectory = join(repositoryRoot, 'config')

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { command, positionals, flags } = parseArgs(argv)
  try {
    switch (command) {
      case 'sync':
        return await syncCommand(flags)
      case 'build-catalog':
        return await syncCommand({ ...flags, write: true })
      case 'validate':
        return await validateCommand(flags)
      case 'verify-integrity':
        return await verifyIntegrityCommand()
      case 'inspect':
        return await inspectCommand(positionals[0])
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
    if (flags.json) console.log(JSON.stringify({ ok: false, error: message }))
    else console.error(message)
    return 1
  }
}

async function syncCommand(flags: Flags): Promise<number> {
  const config = await loadConfiguration()
  const existingLock = await readOptionalLock(flags.lockPath)
  const existingCatalog = existingLock ? await readOptionalCatalog() : undefined
  const fromLock = flags.fromLock ? await readRequiredLock(flags.fromLock) : undefined
  const result = await synchronize({
    sources: config.sources,
    categoryMap: config.categoryMap,
    productAliases: config.productAliases,
    policy: config.policy,
    mode: flags.offline ? 'offline' : 'live',
    fixtureRoot: flags.fixtureRoot
      ? resolve(repositoryRoot, flags.fixtureRoot)
      : resolve(repositoryRoot, 'fixtures'),
    ...(flags.source ? { sourceId: flags.source } : {}),
    metadataOnly: flags.metadataOnly || flags.dryRun,
    dryRun: flags.dryRun,
    ...(existingLock ? { existingLock } : {}),
    ...(existingCatalog ? { existingCatalog } : {}),
    ...(fromLock ? { fromLock } : {}),
  })
  if (result.changed && result.artifacts && (flags.write || !flags.dryRun)) {
    await writeArtifacts(generatedDirectory, result.artifacts)
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
  const artifacts = await readArtifacts()
  const catalog = parseCatalog(JSON.parse(artifacts['catalog.v1.json']))
  parseSourcesLock(JSON.parse(artifacts['sources.lock.json']))
  verifyArtifacts(artifacts)
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

async function verifyIntegrityCommand(): Promise<number> {
  const artifacts = await readArtifacts()
  verifyArtifacts(artifacts)
  console.log(
    JSON.stringify({ ok: true, catalogDigest: digest(artifacts['catalog.v1.json']) }, null, 2)
  )
  return 0
}

async function inspectCommand(pluginId: string | undefined): Promise<number> {
  if (!pluginId) throw new Error('PLUGIN_ID_REQUIRED')
  const catalog = await readCatalog()
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
  const harness = flags.harness
  if (!pluginId || !harness) throw new Error('MATERIALIZE_REQUIRES_PLUGIN_AND_HARNESS')
  const parsedHarness = HarnessSchema.parse(harness)
  const catalog = await readCatalog()
  const plan = createMaterializationPlan({
    catalog,
    pluginId,
    harness: parsedHarness,
    ...(flags.version ? { releaseId: flags.version } : {}),
  })
  print(plan, flags.json)
  return 0
}

async function loadConfiguration(): Promise<{
  sources: SourceConfig[]
  categoryMap: CategoryMap
  productAliases: ProductAliases
  policy: CatalogPolicy
}> {
  const [sources, categoryMap, productAliases, policy] = await Promise.all([
    readJson<{ sources: SourceConfig[] }>(join(configDirectory, 'sources.json')),
    readJson<CategoryMap>(join(configDirectory, 'category-map.json')),
    readJson<ProductAliases>(join(configDirectory, 'product-aliases.json')),
    readJson<CatalogPolicy>(join(configDirectory, 'policy.json')),
  ])
  return { sources: sources.sources, categoryMap, productAliases, policy }
}

async function readCatalog(): Promise<Catalog> {
  const artifacts = await readArtifacts()
  return parseCatalog(JSON.parse(artifacts['catalog.v1.json']))
}

async function readOptionalCatalog(): Promise<Catalog | undefined> {
  try {
    return await readCatalog()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return undefined
  }
}

async function readOptionalLock(path: string | undefined): Promise<SourcesLock | undefined> {
  try {
    return parseSourcesLock(
      JSON.parse(
        await fs.readFile(
          path ? resolve(path) : join(generatedDirectory, 'sources.lock.json'),
          'utf8'
        )
      )
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    if (path) throw error
    return undefined
  }
}

async function readRequiredLock(path: string): Promise<SourcesLock> {
  return parseSourcesLock(JSON.parse(await fs.readFile(resolve(path), 'utf8')))
}

async function readArtifacts(): Promise<GeneratedArtifacts> {
  const names = [
    'catalog.v1.json',
    'catalog-summary.v1.json',
    'sources.lock.json',
    'compatibility.v1.json',
    'categories.v1.json',
    'integrity.json',
  ] as const
  const values = await Promise.all(
    names.map(
      async (name) => [name, await fs.readFile(join(generatedDirectory, name), 'utf8')] as const
    )
  )
  return Object.fromEntries(values) as unknown as GeneratedArtifacts
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as T
}

function print(value: unknown, asJson: boolean): void {
  console.log(asJson ? JSON.stringify(value) : JSON.stringify(value, null, 2))
}

interface Flags {
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
    const [key, inlineValue] = value.split('=', 2)
    const next = inlineValue ?? argv[index + 1]
    const takeValue = () => {
      if (inlineValue !== undefined) return inlineValue
      index += 1
      return next
    }
    switch (key) {
      case '--json':
        flags.json = true
        break
      case '--offline':
        flags.offline = true
        break
      case '--dry-run':
        flags.dryRun = true
        break
      case '--metadata-only':
        flags.metadataOnly = true
        break
      case '--write':
        flags.write = true
        break
      case '--schema-only':
        flags.schemaOnly = true
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
  validate [--schema-only]
  inspect <plugin-id>
  diff <old-lock> <new-lock>
  materialize-plan --plugin ID --harness codex [--version RELEASE_ID]
  build-catalog [--offline] [--write]
  verify-integrity

All commands support --json. Synchronization never executes upstream content.`
}

if (import.meta.main) process.exitCode = await main()
