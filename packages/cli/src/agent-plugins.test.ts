import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from './index.js'
import { withPortableFixture } from '../../catalog-core/test-support/portable-fixture.js'

async function invoke(root: string, argv: string[]) {
  const output: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...values: unknown[]) => {
    output.push(values.map(String).join(' '))
  }
  console.error = (...values: unknown[]) => {
    output.push(values.map(String).join(' '))
  }
  try {
    return { code: await main([...argv, '--json'], { repositoryRoot: root }), output }
  } finally {
    console.log = originalLog
    console.error = originalError
  }
}
async function profileFile(root: string): Promise<string> {
  const path = join(root, 'profile.json')
  await writeFile(
    path,
    JSON.stringify({
      profileVersion: 1,
      harness: 'test-harness',
      runtimeVersion: 'test-1',
      adapterVersion: 'test-1',
      agentPlugins: { versions: ['1.0.0'], skills: true, mcpTransports: ['stdio'] },
      components: { skillDirectories: true, mcpTransports: ['stdio'] },
    })
  )
  return path
}
it('uses canonical synchronization and v2 planning by default', () =>
  withPortableFixture(async (_input, root) => {
    assert.equal((await invoke(root, ['sync', '--offline'])).code, 0)
    assert.equal((await invoke(root, ['validate', '--require-portable'])).code, 0)
    const capabilities = await profileFile(root)
    const result = await invoke(root, [
      'materialize-plan',
      '--plugin',
      'plugin:test-source:review-kit',
      '--capabilities',
      capabilities,
      '--instance',
      'workspace-a',
    ])
    assert.equal(result.code, 0, result.output.join('\n'))
    const plan = JSON.parse(result.output[0]!)
    assert.equal(plan.planVersion, 2)
    assert.equal(plan.strategy, 'native-agent-plugin')
    assert.equal(plan.allowedToActivate, false)
    assert.equal(plan.profile.harness, 'test-harness')
  }))
it('requires explicit capabilities and rejects a mismatched harness', () =>
  withPortableFixture(async (_input, root) => {
    await invoke(root, ['sync', '--offline'])
    const missing = await invoke(root, [
      'materialize-plan',
      '--plugin',
      'plugin:test-source:review-kit',
      '--harness',
      'codex',
    ])
    assert.equal(missing.code, 1)
    assert.match(missing.output.join(''), /PLAN_V2_REQUIRES/)
    const capabilities = await profileFile(root)
    const mismatch = await invoke(root, [
      'materialize-plan',
      '--plugin',
      'plugin:test-source:review-kit',
      '--capabilities',
      capabilities,
      '--instance',
      'a',
      '--harness',
      'different',
    ])
    assert.equal(mismatch.code, 1)
    assert.match(mismatch.output.join(''), /HARNESS_PROFILE_MISMATCH/)
  }))
it('retains the legacy compiler and v1 planner behind explicit switches', () =>
  withPortableFixture(async (_input, root) => {
    assert.equal((await invoke(root, ['sync', '--offline', '--legacy-catalog'])).code, 0)
    const old = await invoke(root, [
      'materialize-plan',
      '--legacy-plan',
      '--plugin',
      'plugin:test-source:review-kit',
      '--harness',
      'claude-code',
    ])
    assert.equal(old.code, 0)
    assert.equal(JSON.parse(old.output[0]!).planVersion, 1)
    const capabilities = await profileFile(root)
    const next = await invoke(root, [
      'materialize-plan',
      '--plugin',
      'plugin:test-source:review-kit',
      '--capabilities',
      capabilities,
      '--instance',
      'a',
    ])
    assert.equal(next.code, 1)
    assert.match(next.output.join(''), /PORTABLE_RESYNC_REQUIRED/)
    assert.equal((await invoke(root, ['sync', '--offline'])).code, 0)
    assert.equal((await invoke(root, ['validate', '--require-portable'])).code, 0)
  }))
it('explicit legacy mode rebuilds a canonical catalog without package metadata', () =>
  withPortableFixture(async (_input, root) => {
    assert.equal((await invoke(root, ['sync', '--offline'])).code, 0)
    const canonical = JSON.parse(await readFile(join(root, 'generated/catalog.v1.json'), 'utf8'))
    assert.ok(canonical.plugins[0].availableReleases[0].releaseMetadata.agentPlugins)
    const result = await invoke(root, ['sync', '--offline', '--legacy-catalog'])
    assert.equal(result.code, 0, result.output.join('\n'))
    assert.equal(JSON.parse(result.output[0]!).changed, true)
    const legacy = JSON.parse(await readFile(join(root, 'generated/catalog.v1.json'), 'utf8'))
    assert.equal(legacy.plugins[0].availableReleases[0].releaseMetadata.agentPlugins, undefined)
  }))

it('never publishes metadata-only or dry-run, even combined with --write', () =>
  withPortableFixture(async (_input, root) => {
    for (const flag of ['--dry-run', '--metadata-only']) {
      const result = await invoke(root, ['sync', '--offline', flag, '--write'])
      assert.equal(result.code, 0, result.output.join('\n'))
      assert.equal((await readdir(root)).includes('generated'), false)
    }
  }))
it('rejects corrupt catalogs without replacing last-known-good files', () =>
  withPortableFixture(async (_input, root) => {
    await invoke(root, ['sync', '--offline'])
    const path = join(root, 'generated/catalog.v1.json')
    const data = JSON.parse(await readFile(path, 'utf8'))
    data.plugins[0].description = 'corrupt'
    const changed = JSON.stringify(data)
    await writeFile(path, changed)
    const result = await invoke(root, ['sync', '--offline'])
    assert.equal(result.code, 1)
    assert.equal(await readFile(path, 'utf8'), changed)
  }))
it('fails when an explicitly requested lock file is missing', () =>
  withPortableFixture(async (_input, root) => {
    const result = await invoke(root, ['sync', '--offline', '--lock', join(root, 'missing.lock')])
    assert.equal(result.code, 1)
    assert.match(result.output.join(''), /ENOENT/)
  }))

it('returns structured errors for malformed option values', () =>
  withPortableFixture(async (_input, root) => {
    const result = await invoke(root, ['sync', '--output'])
    assert.equal(result.code, 1)
    assert.match(result.output.join(''), /FLAG_VALUE_REQUIRED/)
  }))

it('honors explicit false for security-relevant boolean flags', () =>
  withPortableFixture(async (_input, root) => {
    const hooks = join(root, 'fixtures/source/plugins/review-kit/hooks')
    await mkdir(hooks)
    await writeFile(join(hooks, 'hooks.json'), '{}')
    await invoke(root, ['sync', '--offline'])
    const capabilities = await profileFile(root)
    const result = await invoke(root, [
      'materialize-plan',
      '--plugin',
      'plugin:test-source:review-kit',
      '--capabilities',
      capabilities,
      '--instance',
      'a',
      '--allow-partial=false',
      '--legacy-plan=false',
    ])
    assert.equal(result.code, 0)
    const plan = JSON.parse(result.output[0]!)
    assert.equal(plan.planVersion, 2)
    assert.equal(plan.strategy, 'unavailable')
    assert.deepEqual(plan.selection.skillDirectories, [])
  }))
