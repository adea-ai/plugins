import { expect, test } from 'bun:test'
import { YAML } from 'bun'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workflow = YAML.parse(
  readFileSync(resolve(import.meta.dir, '../../../.github/workflows/validation.yml'), 'utf8')
) as {
  on: { push: { branches: string[] } }
  jobs: Record<string, { if: string }>
}

test('default-branch CodeQL runs on every main push regardless of commit subject', () => {
  const codeql = workflow.jobs['default-branch-codeql']

  expect(workflow.on.push.branches).toEqual(['main'])
  expect(codeql.if).toContain("github.event_name == 'push'")
  expect(codeql.if).not.toContain('github.event.head_commit.message')
})
