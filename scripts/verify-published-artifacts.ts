import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { verifyArtifacts, type GeneratedArtifacts } from '../packages/catalog-core/src/index.js'
import { publishedArtifactNames } from '../packages/catalog-core/src/publication.js'

const directory = resolve(process.argv[2] ?? 'generated')
const entries = await Promise.all(
  publishedArtifactNames.map(
    async (name) => [name, await fs.readFile(join(directory, name), 'utf8')] as const
  )
)
const artifacts = Object.fromEntries(entries) as unknown as GeneratedArtifacts
verifyArtifacts(artifacts)
console.log(JSON.stringify({ ok: true, directory, artifacts: publishedArtifactNames }, null, 2))
