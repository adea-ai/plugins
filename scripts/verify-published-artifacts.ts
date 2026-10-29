import { resolve } from 'node:path'
import {
  byteDigest,
  verifyArtifacts,
  type GeneratedArtifacts,
} from '../packages/plugins/src/index.js'
import { parseIntegrityManifest } from '../packages/plugins/src/integrity-manifest.js'
import { readStagedFile } from '../packages/plugins/src/staged-file.js'

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
const integrityText = (await readStagedFile(directory, 'integrity.json')).toString('utf8')
const integrity = parseIntegrityManifest(JSON.parse(integrityText))
const names = Object.keys(integrity.files).toSorted()
const entries = await Promise.all(
  names.map(
    async (name) => [name, (await readStagedFile(directory, name)).toString('utf8')] as const
  )
)
const artifacts = Object.fromEntries([
  ...entries,
  ['integrity.json', integrityText],
]) as unknown as GeneratedArtifacts
verifyArtifacts(artifacts)

const missing: string[] = []
const mismatched: string[] = []
for (const asset of integrity.assets ?? []) {
  const bytes = await readStagedFile(artifactsDirectory, asset.name).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
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
