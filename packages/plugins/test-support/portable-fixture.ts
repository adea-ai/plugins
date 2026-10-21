import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, cp, realpath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SyncInput } from '../src/index.js'
import { PLUGIN_SCHEMA_ID, MCP_SCHEMA_ID } from '../src/agent-plugins-schema.js'

/** The package root, derived from this file's location. */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
/** The workspace root, which holds the installed dependencies. */
const workspaceRoot = join(packageRoot, '..', '..')
/**
 * The Node 24 the compiled-import qualification runs under.
 *
 * The package's `bun` export condition intentionally selects `src/*.ts`, so
 * the COMPILED artifact is only reached by a runtime that honours the
 * `import` condition. Node 24 is therefore pinned: the first Node 24 found
 * under the user's version manager, else the `node` on PATH when it is a 24.
 */
function findPinnedNode(): string {
  return selectPinnedNode(nodeCandidates())
}

/**
 * The Node binaries the qualification may consider, most specific first.
 *
 * The explicit override wins, then a version manager's installs, then the
 * `node` on PATH — which is where a CI runner's setup action puts Node 24.
 */
export function nodeCandidates(): string[] {
  const candidates: string[] = []
  if (process.env.ADEA_NODE24) candidates.push(process.env.ADEA_NODE24)
  // The version manager's installs live under the account's home, which is an
  // ancestor of the checkout in the normal case; a sandbox may relocate the
  // environment's home, so the ancestors of the package are searched too.
  const homes = new Set<string>([homedir(), process.env.HOME ?? ''].filter(Boolean))
  let ancestor = packageRoot
  while (ancestor !== dirname(ancestor)) {
    homes.add(ancestor)
    ancestor = dirname(ancestor)
  }
  for (const home of homes) {
    const root = join(home, '.local/share/mise/installs/node')
    try {
      for (const entry of readdirSync(root))
        if (entry.startsWith('24.')) candidates.push(join(root, entry, 'bin', 'node'))
    } catch {
      /* no version manager install here */
    }
  }
  candidates.push('node')
  return candidates
}

/**
 * Selects the Node 24 the compiled-import qualification runs under.
 *
 * A candidate that is not Node 24 is refused. The qualification exists
 * because the package's `bun` export condition selects `src/*.ts`: running it
 * on an unpinned Node would silently change WHICH artifact is under test, so
 * a Node that is not 24 is not a candidate.
 */
export function selectPinnedNode(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ['--version'], { encoding: 'utf8' }).trim()
      if (version.startsWith('v24')) return candidate
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('the compiled-import qualification needs Node 24')
}

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

/** The capability profile the packed consumer presents to the planner. */
export const PACKED_CONSUMER_PROFILE = {
  profileVersion: 1,
  harness: 'example-harness',
  runtimeVersion: 'fixture-1',
  adapterVersion: 'fixture-1',
  agentPlugins: { versions: ['1.0.0'], skills: true, mcpTransports: ['stdio'] },
  components: { skillDirectories: true, mcpTransports: ['stdio'] },
} as const

/**
 * The package's own lifecycle scripts.
 *
 * A packing step must not be able to build: the packed artifact is the one
 * the consumer receives, and it has to be the artifact the build produced
 * from the CURRENT source. The package declares no lifecycle at all; the
 * workspace root declares a `prepare` that only wires git hooks.
 */
export function packageLifecycleScripts(
  manifests: Readonly<Record<string, { scripts?: Record<string, string> }>>
): Record<string, string> {
  const lifecycle: Record<string, string> = {}
  for (const [name, manifest] of Object.entries(manifests)) {
    for (const [script, command] of Object.entries(manifest.scripts ?? {})) {
      if (['prepack', 'postpack', 'prepare', 'prepublishOnly', 'prepublish'].includes(script))
        lifecycle[`${name}.${script}`] = command
    }
  }
  return lifecycle
}

/**
 * Copies one dependency into the consumer, SELF-CONTAINED.
 *
 * The workspace installs the package's dependencies as SYMLINKS into the
 * package manager's store, so a plain recursive copy copies the LINK and
 * leaves the consumer resolving packages from the workspace. The copy
 * dereferences the link, and the copy's realpath is then checked to be inside
 * the consumer: a dependency that still points outside is refused.
 */
export async function copyDependency(
  source: string,
  name: string,
  consumerRoot: string
): Promise<{ name: string; path: string; realpath: string }> {
  const destination = join(consumerRoot, 'node_modules', name)
  await cp(source, destination, { recursive: true, dereference: true })
  const real = await realpath(destination)
  const root = await realpath(consumerRoot)
  if (real !== root && !real.startsWith(root + '/'))
    throw new Error(`the copied dependency ${name} resolves outside the consumer: ${real}`)
  return { name, path: destination, realpath: real }
}

/**
 * The dependency closure of a set of declared dependencies.
 *
 * Only the PACKED manifest's own dependencies and their legitimate closure are
 * linked into the consumer: the whole workspace is never exposed, so a
 * consumer cannot accidentally resolve a package the artifact does not declare.
 */
function dependencyClosure(
  names: readonly string[],
  searchRoots: readonly string[]
): { name: string; path: string }[] {
  const found = new Map<string, string>()
  const roots = [...searchRoots]
  const queue = [...names]
  while (queue.length > 0) {
    const name = queue.shift()!
    if (found.has(name)) continue
    const path = roots
      .map((root) => join(root, name))
      .find((candidate) => existsSync(join(candidate, 'package.json')))
    if (!path) continue
    found.set(name, path)
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    // A package manager's isolated store keeps a package's own dependencies
    // as SIBLINGS of it, so the store's node_modules directory is a search
    // root too, next to the package's own.
    // The store's own directory, reached through the package's REAL path: a
    // package manager's isolated store keeps a package's dependencies as
    // siblings of it.
    const real = realpathSync(path)
    roots.push(join(real, 'node_modules'), dirname(real))
    for (const dependency of Object.keys(manifest.dependencies ?? {})) queue.push(dependency)
  }
  return [...found].map(([name, path]) => ({ name, path }))
}

/** The result of running the consumer script. */
export type ConsumerRun = {
  status: number
  stdout: string
  stderr: string
}

/** The packed consumer, and the two runtimes it is qualified under. */
export type PackedConsumer = {
  /** The consumer's own directory: its package.json and its node_modules. */
  consumerRoot: string
  /** The extracted package directory. */
  packedRoot: string
  /** The tarball the package was packed into. */
  tarball: string
  /** The fixture root the offline sources live in. */
  root: string
  /** The offline compiler input the consumer compiles from. */
  input: SyncInput
  /** The dependency names the consumer's node_modules holds. */
  linkedDependencies: readonly string[]
  /** Where each copied dependency really resolves. */
  dependencyRealpaths: readonly string[]
  /** Where the copied package really resolves. */
  packageRealpath: string
  /** Whether the packed artifact was built from the current source. */
  builtFromCurrentSource: boolean
  /** Runs the consumer script under the pinned Node 24. */
  runUnderNode: (script: string, request: string) => ConsumerRun
  /** Runs the consumer script under Bun, which selects the source condition. */
  runUnderBun: (script: string, request: string) => ConsumerRun
}

const STALE_MARKER = '/* stale-build-sentinel */'

/**
 * Builds the package, packs it, and sets up an ISOLATED consumer that
 * imports the package by its PUBLIC specifiers.
 *
 * The consumer is a separate directory with its own package.json and its own
 * node_modules: the packed package plus the dependency closure the packed
 * manifest declares, and nothing else. It imports
 * `@adea-ai/plugins/agent-plugins/harness` and
 * `@adea-ai/plugins/portable-catalog` by name, exactly as a consumer does.
 *
 * The package is REBUILT from the current source before it is packed, so a
 * stale `dist` can never be the artifact under test; the build is proven by a
 * sentinel that the rebuild removes. The pack runs with lifecycle scripts
 * disabled, so no `prepare`/`prepack` hook can produce the artifact instead.
 *
 * The compiled-import qualification runs under the pinned Node 24, because the
 * package's `bun` export condition intentionally selects `src/*.ts`. Bun is
 * qualified separately, as the source-condition consumer.
 */
export async function withPackedConsumerFixture(
  run: (consumer: PackedConsumer) => Promise<void>
): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'adea-packed-consumer-'))
  try {
    // 1. Rebuild from the current source. A stale build is marked first, so
    // the rebuild is proved rather than assumed.
    const built = join(packageRoot, 'dist', 'agent-plugins-harness.js')
    const staleBefore = existsSync(built)
    if (staleBefore) await writeFile(built, `${STALE_MARKER}\n${await readFile(built, 'utf8')}`)
    execFileSync('bun', ['run', 'build'], { cwd: packageRoot, stdio: 'inherit' })
    // The build must EXIST and must no longer carry the sentinel: a missing
    // output is not a fresh build.
    const builtFromCurrentSource =
      existsSync(built) && !(await readFile(built, 'utf8')).includes(STALE_MARKER)

    // 2. Pack without lifecycle scripts, and extract.
    const destination = join(workspace, 'tarball')
    await mkdir(destination, { recursive: true })
    execFileSync('bun', ['pm', 'pack', '--destination', destination, '--ignore-scripts'], {
      cwd: packageRoot,
      stdio: 'ignore',
    })
    const [packed] = (await readdir(destination)).filter((name) => name.endsWith('.tgz'))
    if (!packed) throw new Error('the package produced no tarball')
    const tarball = join(destination, packed)
    const extracted = join(workspace, 'extracted')
    await mkdir(extracted, { recursive: true })
    execFileSync('tar', ['-xzf', tarball, '-C', extracted], { stdio: 'inherit' })
    const packedRoot = join(extracted, 'package')

    // 3. The consumer's own directory: the packed package and the closure the
    //    PACKED manifest declares. Nothing else is exposed.
    const consumerRoot = join(workspace, 'consumer')
    await mkdir(join(consumerRoot, 'node_modules', '@adea-ai'), { recursive: true })
    // The package is COPIED into the consumer, the way an install lays it
    // out: a symlinked package would resolve its dependencies from the
    // extracted tree instead of from the consumer's own install.
    const installedPackage = await copyDependency(packedRoot, '@adea-ai/plugins', consumerRoot)
    const packedManifest = JSON.parse(await readFile(join(packedRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const declared = Object.keys(packedManifest.dependencies ?? {})
    const closure = dependencyClosure(declared, [
      join(packageRoot, 'node_modules'),
      join(workspaceRoot, 'node_modules'),
    ])
    // The closure is COPIED, never symlinked, and each copy is checked to
    // resolve inside the consumer: a symlink would let the consumer resolve
    // a package from the workspace, and a transitive import could then escape
    // the consumer entirely.
    const installedDependencies: { name: string; path: string; realpath: string }[] = []
    for (const { name, path } of closure)
      installedDependencies.push(await copyDependency(path, name, consumerRoot))
    await writeFile(
      join(consumerRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'adea-packed-consumer',
          private: true,
          type: 'module',
          dependencies: { '@adea-ai/plugins': `file:${packedRoot}` },
        },
        null,
        2
      )}\n`
    )

    // 4. The offline sources the consumer compiles from.
    const root = join(workspace, 'fixture')
    await mkdir(root, { recursive: true })
    const input = portableFixtureInput(root)
    await writePortableFixture(root, input)

    const runWith = (
      command: string,
      args: readonly string[],
      script: string,
      request: string
    ): ConsumerRun => {
      try {
        const stdout = execFileSync(command, [...args, script, request], {
          cwd: consumerRoot,
          encoding: 'utf8',
        })
        return { status: 0, stdout, stderr: '' }
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string }
        return {
          status: failure.status ?? 1,
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? '',
        }
      }
    }
    const nodeBinary = findPinnedNode()

    await run({
      consumerRoot,
      packedRoot,
      tarball,
      root,
      input,
      linkedDependencies: installedDependencies.map((entry) => entry.name),
      dependencyRealpaths: installedDependencies.map((entry) => entry.realpath),
      packageRealpath: installedPackage.realpath,
      builtFromCurrentSource,
      runUnderNode: (script, request) => runWith(nodeBinary, [], script, request),
      runUnderBun: (script, request) => runWith('bun', [], script, request),
    })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}
