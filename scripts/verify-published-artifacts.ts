import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  byteDigest,
  verifyArtifacts,
  type GeneratedArtifacts,
  type PublishedAsset,
} from '../packages/catalog-core/src/index.js'

/**
 * Verifies a downloaded catalog release.
 *
 * `integrity.json` is the manifest of record: every published JSON artifact and
 * every mirrored brand mark is checked against the digest it declares, so a
 * release cannot advertise content it does not carry. Mirrored marks may sit in
 * a separate directory because they are never committed to the repository.
 */
const directory = resolve(process.argv[2] ?? 'generated')
const artifactsDirectory = resolve(process.argv[3] ?? directory)
const integrity = JSON.parse(await fs.readFile(join(directory, 'integrity.json'), 'utf8')) as {
  files?: Record<string, string>
  assets?: PublishedAsset[]
}
const names = Object.keys(integrity.files ?? {}).toSorted()
const entries = await Promise.all(
  names.map(async (name) => [name, await fs.readFile(join(directory, name), 'utf8')] as const)
)
const artifacts = Object.fromEntries([
  ...entries,
  ['integrity.json', JSON.stringify(integrity)],
]) as unknown as GeneratedArtifacts
verifyArtifacts(artifacts)

const missing: string[] = []
const mismatched: string[] = []
for (const asset of integrity.assets ?? []) {
  const bytes = await fs.readFile(join(artifactsDirectory, asset.name)).catch(() => undefined)
  if (!bytes) {
    missing.push(asset.name)
    continue
  }
  if (byteDigest(bytes) !== asset.digest || bytes.byteLength !== asset.bytes)
    mismatched.push(asset.name)
}
if (missing.length > 0 || mismatched.length > 0) {
  console.error(JSON.stringify({ ok: false, missing, mismatched }))
  process.exit(1)
}
console.log(
  JSON.stringify(
    {
      ok: true,
      directory,
      artifacts: names,
      assets: (integrity.assets ?? []).map((asset) => asset.name),
    },
    null,
    2
  )
)
