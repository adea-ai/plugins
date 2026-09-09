import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  AgentPackageSchema,
  HarnessProfileSchema,
  InstallationPlanSchema,
} from './agent-plugins.js'

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
