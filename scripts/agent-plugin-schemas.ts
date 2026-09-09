import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  AgentPackageSchema,
  HarnessProfileSchema,
  InstallationPlanSchema,
} from '../packages/catalog-schema/src/agent-plugins.js'

function formatSchema(path: string, schema: unknown): string {
  const result = spawnSync('bunx', ['oxfmt', '--stdin-filepath', path], {
    input: `${JSON.stringify(schema, null, 2)}\n`,
    encoding: 'utf8',
  })
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to format generated schema: ${result.stderr || result.error}`)
  }
  return result.stdout
}

const check = process.argv.includes('--check')
for (const [name, schema] of [
  ['agent-package.v1', AgentPackageSchema],
  ['harness-profile.v1', HarnessProfileSchema],
  ['installation-plan.v2', InstallationPlanSchema],
] as const) {
  const path = fileURLToPath(new URL(`../schemas/${name}.json`, import.meta.url))
  const generated = {
    ...z.toJSONSchema(schema, { target: 'draft-2020-12' }),
    $id: `https://adea.dev/schemas/plugins/${name}.json`,
  }
  const expected = formatSchema(path, generated)
  if (check) {
    const actual = await readFile(path, 'utf8')
    if (actual !== expected) throw new Error(`Schema differs from the runtime contract: ${name}`)
  } else {
    await writeFile(path, expected)
  }
}
console.log(check ? 'Agent Plugin schemas are current.' : 'Agent Plugin schemas generated.')
