import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  AgentPackageSchema,
  HarnessProfileSchema,
  InstallationPlanSchema,
} from './agent-plugins-schema.js'

// Run test commands from the repository root, like the repository's Bun scripts.
for (const [name, schema] of [
  ['agent-package.v1', AgentPackageSchema],
  ['harness-profile.v1', HarnessProfileSchema],
  ['installation-plan.v2', InstallationPlanSchema],
] as const) {
  it(`keeps ${name} JSON Schema synchronized with the runtime contract`, async () => {
    const artifact = JSON.parse(
      await readFile(join(process.cwd(), 'schemas', `${name}.json`), 'utf8')
    )
    assert.deepEqual(artifact, {
      ...z.toJSONSchema(schema, { target: 'draft-2020-12' }),
      $id: `https://adea.dev/schemas/plugins/${name}.json`,
    })
  })
}

it('rejects an oversized file collection before reading any attacker-controlled entries', () => {
  let visitedEntries = 0
  const oversizedFiles = new Proxy([], {
    get(target, property, receiver) {
      if (property === 'length') return 8193
      if (typeof property === 'string' && /^(0|[1-9][0-9]*)$/.test(property)) {
        visitedEntries += 1
        throw new Error('Oversized file entries must not be traversed.')
      }
      return Reflect.get(target, property, receiver)
    },
  })

  const result = AgentPackageSchema.shape.files.safeParse(oversizedFiles)

  assert.equal(result.success, false)
  assert.equal(visitedEntries, 0)
  if (!result.success) assert.equal(result.error.issues[0]?.code, 'too_big')
})

it('accepts a file collection at the public schema limit', () => {
  const file = {
    action: 'copy',
    sourcePath: 'source.txt',
    targetPath: 'target.txt',
    digest: `sha256:${'a'.repeat(64)}`,
    preserveMode: true,
  } as const

  const result = AgentPackageSchema.shape.files.safeParse(Array.from({ length: 8192 }, () => file))

  assert.equal(result.success, true)
  if (result.success) assert.equal(result.data.length, 8192)
})
