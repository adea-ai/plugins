import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { byteDigest, type PublishedAsset } from '../packages/plugins/src/index.js'
import {
  catalogAssetsBaseUrl,
  catalogIdSuffix,
  latestPointerName,
  publishedArtifactNames,
} from '../packages/plugins/src/publication.js'

/**
 * Verifies a published catalog by reading it back off the publication branch.
 *
 * Publication is a force-push of a directory tree, so nothing in the transport
 * refuses a partial or divergent write the way an immutable release tag did.
 * This is the gate that replaces that refusal: every artifact and mirrored mark
 * is fetched from the URL a consumer will actually use and compared against the
 * bytes this build staged, and the mutable pointer is confirmed to be the
 * catalog it claims to be. A snapshot that cannot be read back byte-for-byte is
 * not published, whatever the push reported.
 *
 * Usage: bun run verify:catalog-branch [--artifacts DIR] [--assets DIR] [--base URL]
 *
 * `--base` is the root of the publication branch, which is also where the
 * mutable pointer and the digest-addressed brand marks live.
 */
function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const artifactsDirectory = resolve(flag('artifacts', 'generated'))
const assetsDirectory = resolve(flag('assets', 'catalog-assets'))
const base = flag('base', catalogAssetsBaseUrl('https://github.com/adea-ai/plugins')).replace(
  /\/$/u,
  ''
)

const integrity = JSON.parse(
  await fs.readFile(join(artifactsDirectory, 'integrity.json'), 'utf8')
) as { catalogId?: string; files?: Record<string, string>; assets?: PublishedAsset[] }

const catalogId = integrity.catalogId
if (typeof catalogId !== 'string') throw new Error('INTEGRITY_CATALOG_ID_MISSING')
const snapshotBase = `${base}/catalogs/${catalogIdSuffix(catalogId)}`

interface Divergence {
  readonly name: string
  readonly reason: 'unreachable' | 'digest' | 'bytes'
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function compare(
  name: string,
  url: string,
  local: Uint8Array
): Promise<Divergence | undefined> {
  let remote: Uint8Array
  try {
    remote = await fetchBytes(url)
  } catch {
    return { name, reason: 'unreachable' }
  }
  if (byteDigest(remote) !== byteDigest(local)) return { name, reason: 'digest' }
  if (remote.byteLength !== local.byteLength) return { name, reason: 'bytes' }
  return undefined
}

const divergences: Divergence[] = []
const names = Object.keys(integrity.files ?? {}).toSorted()
for (const name of names) {
  const local = new Uint8Array(await fs.readFile(join(artifactsDirectory, name)))
  const divergence = await compare(name, `${snapshotBase}/${name}`, local)
  if (divergence) divergences.push(divergence)
}

// integrity.json is not self-describing, so it is compared against the staged
// copy directly rather than against a digest it declares about itself.
{
  const local = new Uint8Array(await fs.readFile(join(artifactsDirectory, 'integrity.json')))
  const divergence = await compare('integrity.json', `${snapshotBase}/integrity.json`, local)
  if (divergence) divergences.push(divergence)
}

for (const asset of integrity.assets ?? []) {
  const local = await fs.readFile(join(assetsDirectory, asset.name)).catch(() => undefined)
  if (local === undefined) {
    // A declared mark this build never staged cannot be published, and a
    // snapshot that advertises it is incomplete wherever it is read.
    divergences.push({ name: asset.name, reason: 'unreachable' })
    continue
  }
  const divergence = await compare(asset.name, `${base}/${asset.name}`, new Uint8Array(local))
  if (divergence) divergences.push(divergence)
}

// The pointer is the only mutable path, so it is the one that can disagree with
// the snapshot it names. Byte-identity here is what lets a consumer trust the
// catalogId it just read.
{
  const local = new Uint8Array(await fs.readFile(join(artifactsDirectory, 'catalog.v1.json')))
  const divergence = await compare(latestPointerName, `${base}/${latestPointerName}`, local)
  if (divergence) divergences.push(divergence)
}

if (divergences.length > 0) {
  console.error(JSON.stringify({ ok: false, base, catalogId, divergences }, null, 2))
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      ok: true,
      catalogId,
      snapshotBase,
      artifacts: [
        ...names,
        'integrity.json',
        ...publishedArtifactNames.filter((n) => !names.includes(n)),
      ].toSorted(),
      assets: (integrity.assets ?? []).map((asset) => asset.name),
      pointer: `${base}/${latestPointerName}`,
    },
    null,
    2
  )
)
