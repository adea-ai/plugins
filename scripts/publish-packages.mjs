import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Publishes @adea-ai/catalog-schema — the deterministic plugin-catalog schema —
// to the public npm registry. The package is metadata-only: pure Zod schemas
// plus the versioned JSON Schema artifacts from the repository-root schemas/
// directory. It contains no marketplace data, no network code, and no
// lifecycle scripts; that is what makes public publishing safe.
//
// The npm `adea` org must exist and NPM_TOKEN must be an automation token
// with publish rights on it. The version comes from the package manifest
// (release-please lockstep with the repository root); an already-published
// version is skipped, so the script is safe to re-run and runs on every main
// push touching these paths.

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

const PACKAGE_DIR = 'packages/catalog-schema'
const SCHEMA_DIR = 'schemas'

function sh(args, cwd, extraEnv) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  })
  if (result.error) throw result.error
  return result
}

async function publishedVersion(name) {
  const result = sh(['npm', 'view', `${name}`, 'version'], repoRoot)
  if (result.status !== 0) return null
  return result.stdout.trim() || null
}

function shOrThrow(args, cwd) {
  const result = sh(args, cwd)
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr)
    throw new Error(`[publish] ${args.join(' ')} failed`)
  }
  return result
}

const source = resolve(repoRoot, PACKAGE_DIR)
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const { name, version } = manifest
if (manifest.private) {
  throw new Error(`[publish] refusing to publish ${name}: remove "private": true first`)
}
if ((await publishedVersion(name)) === version) {
  console.log(`[publish] ${name}@${version} already published; skipping.`)
  process.exit(0)
}

shOrThrow(['bunx', 'tsc', '-p', join(source, 'tsconfig.json')], repoRoot)

// Stage an isolated copy with the repository-root JSON Schema artifacts
// folded into the package so the ./schema/* subpath export resolves.
const stage = await mkdtemp(join(tmpdir(), 'plugins-publish-'))
await cp(source, join(stage, 'package'), { recursive: true })
await cp(resolve(repoRoot, SCHEMA_DIR), join(stage, 'package', SCHEMA_DIR), { recursive: true })
const stagedManifestPath = join(stage, 'package', 'package.json')
const staged = JSON.parse(await readFile(stagedManifestPath, 'utf8'))
for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
  for (const [dep, range] of Object.entries(staged[section] ?? {})) {
    if (typeof range === 'string' && range.startsWith('workspace:')) {
      throw new Error(`[publish] ${name} must not use workspace: ranges (${dep}: ${range})`)
    }
  }
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
