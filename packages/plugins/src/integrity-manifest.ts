import { z } from 'zod'
import { DIGEST_RE } from './schema.js'

// Assets were added after the first v1 snapshots, so their absence remains valid.
const IntegrityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  catalogId: z.string().regex(/^catalog:[a-f0-9]{64}$/),
  files: z.record(z.string(), z.string().regex(DIGEST_RE)),
  assets: z
    .array(
      z.object({
        name: z.string(),
        digest: z.string().regex(DIGEST_RE),
        bytes: z.number().int().positive(),
        contentType: z.string(),
        kind: z.enum(['content', 'favicon']),
        origin: z.string(),
      })
    )
    .optional(),
})

/** Validate all names before using a manifest to address local files or URLs. */
export function parseIntegrityManifest(input: unknown) {
  const parsed = IntegrityManifestSchema.safeParse(input)
  if (!parsed.success || Object.keys(parsed.data.files).length === 0)
    throw new Error('INTEGRITY_MANIFEST_INVALID')
  const manifest = parsed.data
  for (const name of Object.keys(manifest.files)) {
    if (!safeName(name) || name === 'integrity.json')
      throw new Error(`INTEGRITY_FILE_NAME_INVALID: ${name}`)
  }
  const assetNames = new Set<string>()
  for (const asset of manifest.assets ?? []) {
    if (!safeName(asset.name)) throw new Error(`INTEGRITY_ASSET_NAME_INVALID: ${asset.name}`)
    if (assetNames.has(asset.name)) throw new Error(`INTEGRITY_ASSET_DUPLICATE: ${asset.name}`)
    assetNames.add(asset.name)
  }
  return manifest
}

function safeName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)
}
