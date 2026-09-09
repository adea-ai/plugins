import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Publishes the marketplace toolkit packages to the public npm registry:
// @adea-ai/catalog-schema (with the versioned JSON Schema artifacts),
// @adea-ai/source-adapters, @adea-ai/harness-adapters, and @adea-ai/catalog-core.
// All four are metadata-only — pure schemas, parsing, planning, and
// compilation with no marketplace data, network installs, or lifecycle
// scripts; that is what makes public publishing safe. The marketplace CLI
// stays repository-internal: it wires the toolkit to the configured
// official marketplace sources.
//
// The npm `adea` org must exist and NPM_TOKEN must be an automation token
// with publish rights on it. Versions come from each package manifest
// (release-please lockstep with the repository root); already-published
// versions are skipped, so the script is safe to re-run and runs on every
// main push touching these paths. Packages are built in dependency order
// because each build resolves sibling types from their freshly built dist.

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

const SCHEMA_DIR = 'schemas'

// In dependency order: each package's build resolves sibling types from
// their dist output.
const PUBLISH_PACKAGES = [
  { dir: 'packages/catalog-schema', schemas: true },
  { dir: 'packages/source-adapters', schemas: false },
  { dir: 'packages/catalog-core', schemas: false },
  { dir: 'packages/harness-adapters', schemas: false },
]

function sh(args, cwd, extraEnv) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  })
  if (result.error) throw result.error
  return result
}

function shOrThrow(args, cwd) {
  const result = sh(args, cwd)
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr)
    throw new Error(`[publish] ${args.join(' ')} failed`)
  }
}

async function publishedVersion(name) {
  const result = sh(['npm', 'view', `${name}`, 'version'], repoRoot)
  if (result.status !== 0) return null
  return result.stdout.trim() || null
}

// Workspace manifests are the source of truth for workspace: ranges; bun
// links workspace members lazily, so node_modules lookups are unreliable.
const workspaceVersions = new Map()
{
  let entries = []
  try {
    entries = await readdir(join(repoRoot, 'packages'), { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const manifest = JSON.parse(
        await readFile(join(repoRoot, 'packages', entry.name, 'package.json'), 'utf8')
      )
      workspaceVersions.set(manifest.name, manifest.version)
    } catch {
      // Not a workspace package manifest; skip.
    }
  }
}

async function rewriteSection(section, workspaceName) {
  const rewritten = {}
  for (const [dep, range] of Object.entries(section ?? {})) {
    if (typeof range === 'string' && range.startsWith('workspace:')) {
      const depVersion = workspaceVersions.get(dep)
      if (!depVersion) {
        throw new Error(`[publish] cannot resolve ${range} for ${dep} in ${workspaceName}`)
      }
      rewritten[dep] = `^${depVersion}`
    } else {
      rewritten[dep] = range
    }
  }
  return rewritten
}

for (const { dir, schemas } of PUBLISH_PACKAGES) {
  const source = resolve(repoRoot, dir)
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  const { name, version } = manifest
  if (manifest.private) {
    throw new Error(`[publish] refusing to publish ${name}: remove "private": true first`)
  }
  // Build even an already-published dependency: dependents need its local declarations.
  shOrThrow(['bunx', 'tsc', '-p', join(source, 'tsconfig.json')], repoRoot)
  if ((await publishedVersion(name)) === version) {
    console.log(`[publish] ${name}@${version} already published; skipping.`)
    continue
  }
  // Stage an isolated copy with workspace: ranges resolved to their locked
  // versions so the published tarball has no workspace: protocol leftovers.
  const stage = await mkdtemp(join(tmpdir(), 'plugins-publish-'))
  await cp(source, join(stage, 'package'), { recursive: true })
  if (schemas) {
    await cp(resolve(repoRoot, SCHEMA_DIR), join(stage, 'package', SCHEMA_DIR), {
      recursive: true,
    })
  }
  const stagedManifestPath = join(stage, 'package', 'package.json')
  const staged = JSON.parse(await readFile(stagedManifestPath, 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    staged[section] = await rewriteSection(staged[section], name)
  }
  await writeFile(stagedManifestPath, `${JSON.stringify(staged, null, 2)}\n`)
  // Ship the repository license inside the tarball so registry consumers and
  // license scanners see it without visiting the repository.
  await cp(join(repoRoot, 'LICENSE'), join(stage, 'package', 'LICENSE'))
  console.log(`[publish] publishing ${name}@${version}...`)
  const result = sh(['npm', 'publish', '--access', 'public'], join(stage, 'package'))
  await rm(stage, { recursive: true, force: true })
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr)
    throw new Error(`[publish] failed for ${name}@${version}`)
  }
  console.log(`[publish] published ${name}@${version}.`)
}
