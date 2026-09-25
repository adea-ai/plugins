import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { byteDigest, type PublishedAsset } from '../packages/catalog-core/src/index.js'
import {
  auditReleaseAssets,
  type DeclaredAsset,
  type ReleaseAssetState,
} from '../packages/catalog-core/src/publication.js'

/**
 * Audits an existing release against the artifacts this build staged.
 *
 * The publish step used to upload only what was absent, so a release could
 * carry one build's asset beside another build's manifest and still look
 * complete. This reports every disagreement — missing, divergent,
 * unverifiable and surplus — and whether a draft can be repaired or a
 * published release has to stop the publication instead.
 *
 * The comparison is over published bytes: the release API states the sha256 of
 * each asset and the staged files are hashed locally, so it holds whatever
 * digest convention the artifacts themselves declare.
 */
const flags = parseFlags(process.argv.slice(2))
const artifactsDirectory = resolve(flagValue('--artifacts'))
const assetsDirectory = resolve(flagValue('--assets'))
const catalogId = flagValue('--catalog-id')
const releaseTag = flagValue('--release-tag')
const releaseStatePath = flags.get('--release-state')

const integrity = JSON.parse(
  await fs.readFile(join(artifactsDirectory, 'integrity.json'), 'utf8')
) as { files?: Record<string, string>; assets?: PublishedAsset[] }

async function declare(name: string, path: string): Promise<DeclaredAsset> {
  const bytes = await fs.readFile(path).catch(() => undefined)
  if (bytes === undefined) throw new Error(`DECLARED_ASSET_MISSING: ${path}`)
  return { name, digest: byteDigest(bytes), bytes: bytes.byteLength }
}

const declared: DeclaredAsset[] = []
for (const name of Object.keys(integrity.files ?? {}))
  declared.push(await declare(name, join(artifactsDirectory, name)))
declared.push(await declare('integrity.json', join(artifactsDirectory, 'integrity.json')))
for (const asset of integrity.assets ?? [])
  declared.push(await declare(asset.name, join(assetsDirectory, asset.name)))
// The latest pointer is published as a copy of the catalog, so the release can
// only be consistent when that asset's bytes are the catalog's bytes.
const catalog = declared.find((asset) => asset.name === 'catalog.v1.json')
if (catalog === undefined) throw new Error('DECLARED_ASSET_MISSING: catalog.v1.json')
declared.push({ name: 'catalog-latest.v1.json', digest: catalog.digest, bytes: catalog.bytes })

const releaseState = releaseStatePath
  ? ((JSON.parse(await fs.readFile(releaseStatePath, 'utf8')) as {
      assets?: { name?: unknown; digest?: unknown; size?: unknown }[]
      isDraft?: unknown
    }) ?? {})
  : {}
const releaseAssets: ReleaseAssetState[] | undefined = Array.isArray(releaseState.assets)
  ? releaseState.assets.flatMap((asset) =>
      typeof asset.name === 'string'
        ? [
            {
              name: asset.name,
              ...(typeof asset.digest === 'string' ? { digest: asset.digest } : {}),
              ...(typeof asset.size === 'number' ? { bytes: asset.size } : {}),
            },
          ]
        : []
    )
  : undefined

const audit = auditReleaseAssets({
  catalogId,
  releaseTag,
  ...(releaseState.isDraft === undefined ? {} : { releaseIsDraft: releaseState.isDraft === true }),
  ...(releaseAssets === undefined ? {} : { releaseAssets }),
  declared,
})
console.log(
  JSON.stringify({ ok: audit.blocked === undefined, catalogId, releaseTag, ...audit }, null, 2)
)

function flagValue(name: string): string {
  const value = flags.get(name)
  if (value === undefined) throw new Error(`FLAG_REQUIRED: ${name}`)
  return value
}

function parseFlags(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name === undefined || !name.startsWith('--') || value === undefined)
      throw new Error(`FLAG_INVALID: ${argv.slice(index).join(' ')}`)
    parsed.set(name, value)
  }
  return parsed
}
