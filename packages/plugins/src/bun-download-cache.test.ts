import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
for (const name of ['marketplace-ci', 'marketplace-sync', 'publish-packages']) {
  test(`${name} restores compatible downloads before frozen install with a reachable trusted writer`, () => {
    const source = readFileSync(
      new URL(`../../../.github/workflows/${name}.yml`, import.meta.url),
      'utf8'
    )
    const restore = source.indexOf('- name: Restore Bun package downloads')
    const install = source.indexOf('run: bun install --frozen-lockfile')
    const save = source.indexOf('- name: Save Bun package downloads')
    expect(restore).toBeGreaterThan(0)
    expect(install).toBeGreaterThan(restore)
    expect(save).toBeGreaterThan(install)
    const block = source.slice(
      restore,
      source.indexOf('key: ${{ steps.bun-downloads.outputs.cache-primary-key }}', save)
    )
    expect(block.match(/path: ~\/\.bun\/install\/cache/g)).toHaveLength(2)
    expect(block).not.toContain('node_modules')
    expect(block).toContain(
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)"
    )
    expect(block).toContain("steps.bun-downloads.outputs.cache-hit != 'true'")
    expect(block).toContain("runner.os }}-${{ runner.arch }}-1.4.4-${{ hashFiles('bun.lock')")
    const events = name === 'marketplace-sync' ? ['schedule', 'workflow_dispatch'] : ['push']
    for (const event of events) {
      expect(source.slice(0, source.indexOf('\npermissions:'))).toContain(`${event}:`)
      expect(block).toContain(`github.event_name == '${event}'`)
    }
  })
}

test('new PRs supersede checks while trusted push cache writers finish', () => {
  const source = readFileSync(
    new URL('../../../.github/workflows/marketplace-ci.yml', import.meta.url),
    'utf8'
  )
  expect(source).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
})

test('marketplace checks rerun on ready PR updates without running on draft updates', () => {
  const source = readFileSync(new URL('../../../.github/workflows/marketplace-ci.yml', import.meta.url), 'utf8')
  expect(source).toContain('types: [ready_for_review, synchronize]')
  expect(source).toContain("if: github.event_name != 'pull_request' || github.event.pull_request.draft == false")
})
