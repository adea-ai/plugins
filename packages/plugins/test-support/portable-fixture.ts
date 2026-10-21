import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SyncInput } from '../src/index.js'
import { PLUGIN_SCHEMA_ID, MCP_SCHEMA_ID } from '../src/agent-plugins-schema.js'

/** The package root, derived from this file's location. */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
/** The workspace root, which holds the installed dependencies. */
const workspaceRoot = join(packageRoot, '..', '..')

/**
 * The offline fixture's sources: a synthetic marketplace, a plugin manifest, an
 * MCP server, a skill and a skill resource.
 */
function portableFixtureFiles(input: SyncInput): Record<string, string> {
  return {
    'config/sources.json': JSON.stringify({ sources: input.sources }),
    'config/category-map.json': JSON.stringify(input.categoryMap),
    'config/product-aliases.json': JSON.stringify(input.productAliases),
    'config/policy.json': JSON.stringify(input.policy),
    'fixtures/source/marketplace.json': JSON.stringify({
      name: 'fixture',
      plugins: [{ name: 'review-kit', source: './plugins/review-kit' }],
    }),
    'fixtures/source/plugins/review-kit/plugin.json': JSON.stringify({
      $schema: PLUGIN_SCHEMA_ID,
      name: 'review-kit',
      description: 'Fixture only',
    }),
    'fixtures/source/plugins/review-kit/mcp.json': JSON.stringify({
      $schema: MCP_SCHEMA_ID,
      mcpServers: {
        local: { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/bin/server.mjs'] },
      },
    }),
    'fixtures/source/plugins/review-kit/bin/server.mjs': '// Fixture only; never executed.\n',
    'fixtures/source/plugins/review-kit/skills/review/SKILL.md':
      '---\nname: review\ndescription: Review changes.\n---\nSee references/checklist.md.\n',
    'fixtures/source/plugins/review-kit/skills/review/references/checklist.md':
      'Keep complete resources.\n',
  }
}

/** The offline compiler input, over synthetic sources only. */
function portableFixtureInput(root: string): SyncInput {
  return {
    mode: 'offline',
    fixtureRoot: join(root, 'fixtures'),
    sources: [
      {
        sourceId: 'test-source',
        displayName: 'Test Source',
        marketplaceDialect: 'claude',
        repositoryUrl: 'https://github.com/example/portable-fixture',
        manifestPath: 'marketplace.json',
        defaultBranch: 'main',
        trustClassification: 'official',
        fixturePath: 'source',
        fixtureCommitSha: 'a'.repeat(40),
      },
    ],
    categoryMap: { aliases: {}, fallback: 'other' },
    productAliases: { aliases: {} },
    policy: {
      allowedRepositoryHosts: ['github.com'],
      allowedRepositoryProtocols: ['https:'],
      maxFilesPerPlugin: 4096,
      maxBytesPerPlugin: 50 * 1024 * 1024,
      maxFileBytes: 5 * 1024 * 1024,
      maxMarketplacePlugins: 4096,
      denyExecutableLifecycleScripts: true,
      publishRequiresCompleteContent: false,
      sensitiveCapabilityTypes: ['mcp-server', 'hook', 'executable'],
    },
  }
}

async function writePortableFixture(root: string, input: SyncInput): Promise<void> {
  for (const [path, content] of Object.entries(portableFixtureFiles(input))) {
    const target = join(root, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

export async function withPortableFixture(
  run: (input: SyncInput, root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'adea-portable-'))
  const input = portableFixtureInput(root)
  try {
    await writePortableFixture(root, input)
    await run(input, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/**
 * The BUILT public artifact of this package, as a consumer receives it.
 *
 * These are the module shapes a consumer of the packed package gets: the
 * compiled `dist` entries, not the workspace sources.
 */
export type PackedConsumerModules = {
  /** The built harness module from the EXTRACTED package. */
  harness: typeof import('../src/agent-plugins-harness.js')
  /** The built portable-catalog module from the EXTRACTED package. */
  catalog: typeof import('../src/portable-catalog.js')
}

/** The extracted package, and the tarball it came from. */
export type PackedConsumer = PackedConsumerModules & {
  /** The directory the package was extracted into. */
  packedRoot: string
  /** The tarball the package was packed into. */
  tarball: string
}

/**
 * Builds the package and packs it, then extracts it for a consumer.
 *
 * The consumer imports the EXTRACTED package's built entries, so the case
 * exercises the artifact a consumer actually receives rather than the
 * workspace sources. The extracted package resolves its declared
 * dependencies from the workspace install: a consumer installs them, and
 * nothing is fetched. No harness is executed and no network is used.
 */
export async function withPackedConsumerFixture(
  run: (context: {
    consumer: PackedConsumer
    /** The offline compiler input the consumer compiles from. */
    input: SyncInput
    /** The fixture root the offline sources live in. */
    root: string
  }) => Promise<void>
): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'adea-packed-consumer-'))
  try {
    const built = join(packageRoot, 'dist', 'agent-plugins-harness.js')
    if (!existsSync(built)) {
      execFileSync('bun', ['run', 'build'], { cwd: packageRoot, stdio: 'inherit' })
    }
    const destination = join(workspace, 'tarball')
    await mkdir(destination, { recursive: true })
    execFileSync('bun', ['pm', 'pack', '--destination', destination], {
      cwd: packageRoot,
      stdio: 'ignore',
    })
    const { readdir } = await import('node:fs/promises')
    const [packed] = (await readdir(destination)).filter((name) => name.endsWith('.tgz'))
    if (!packed) throw new Error('the package produced no tarball')
    const tarball = join(destination, packed)
    const extracted = join(workspace, 'extracted')
    await mkdir(extracted, { recursive: true })
    execFileSync('tar', ['-xzf', tarball, '-C', extracted], { stdio: 'inherit' })
    const packedRoot = join(extracted, 'package')
    // The extracted package resolves its declared dependencies from the
    // workspace install of THIS package: a consumer installs them, and
    // nothing is fetched.
    const installed = [join(packageRoot, 'node_modules'), join(workspaceRoot, 'node_modules')].find(
      (candidate) => existsSync(candidate)
    )
    if (!installed) throw new Error('the workspace has no installed dependencies')
    await symlink(installed, join(packedRoot, 'node_modules'))
    const harness = (await import(
      pathToFileURL(join(packedRoot, 'dist', 'agent-plugins-harness.js')).href
    )) as PackedConsumerModules['harness']
    const catalog = (await import(
      pathToFileURL(join(packedRoot, 'dist', 'portable-catalog.js')).href
    )) as PackedConsumerModules['catalog']
    const root = join(workspace, 'fixture')
    await mkdir(root, { recursive: true })
    const input = portableFixtureInput(root)
    await writePortableFixture(root, input)
    await run({ consumer: { harness, catalog, packedRoot, tarball }, input, root })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}
