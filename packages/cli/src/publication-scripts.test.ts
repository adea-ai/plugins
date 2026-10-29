import { describe, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { synchronizePortable } from '../../plugins/src/portable-catalog.js'
import { writeArtifacts } from '../../plugins/src/index.js'
import { withPortableFixture } from '../../plugins/test-support/portable-fixture.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const digest = `sha256:${'a'.repeat(64)}`
const catalogId = `catalog:${'b'.repeat(64)}`

async function run(script: string, args: string[]) {
  const child = Bun.spawn([process.execPath, join(root, 'scripts', script), ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, output: stdout + stderr }
}

describe('publication script manifest boundaries', () => {
  test('rejects malformed metadata and traversal before opening listed files', () =>
    withPortableFixture(async (_input, dir) => {
      const cases = [
        [
          { schemaVersion: 1, catalogId, files: { '../missing': digest } },
          'INTEGRITY_FILE_NAME_INVALID',
        ],
        [
          {
            schemaVersion: 1,
            catalogId,
            files: { 'catalog.v1.json': digest },
            assets: [
              {
                name: '../missing',
                digest,
                bytes: 1,
                contentType: 'image/png',
                kind: 'content',
                origin: 'x',
              },
            ],
          },
          'INTEGRITY_ASSET_NAME_INVALID',
        ],
        [{ schemaVersion: 1, catalogId, files: [] }, 'INTEGRITY_MANIFEST_INVALID'],
        [
          { schemaVersion: 1, catalogId, files: { 'catalog.v1.json': digest }, assets: [null] },
          'INTEGRITY_MANIFEST_INVALID',
        ],
      ] as const
      for (const [manifest, error] of cases) {
        await writeFile(join(dir, 'integrity.json'), JSON.stringify(manifest))
        for (const [script, args] of [
          ['verify-published-artifacts.ts', [dir]],
          [
            'verify-catalog-branch.ts',
            ['--artifacts', dir, '--assets', dir, '--base', 'http://127.0.0.1:1'],
          ],
        ] as const) {
          const result = await run(script, [...args])
          expect(result.code).not.toBe(0)
          expect(result.output).toContain(error)
          expect(result.output).not.toContain('ENOENT')
        }
      }
    }))

  test('accepts a valid v1 manifest without the later assets field', () =>
    withPortableFixture(async (input, dir) => {
      const result = await synchronizePortable(input)
      await writeArtifacts(dir, result.artifacts!)
      const integrity = JSON.parse(await readFile(join(dir, 'integrity.json'), 'utf8'))
      delete integrity.assets
      await writeFile(join(dir, 'integrity.json'), JSON.stringify(integrity))
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const name = new URL(request.url).pathname.split('/').at(-1)!
          const local = name === 'catalog-latest.v1.json' ? 'catalog.v1.json' : name
          try {
            return new Response(await readFile(join(dir, local)))
          } catch {
            return new Response('missing', { status: 404 })
          }
        },
      })
      try {
        const published = await run('verify-published-artifacts.ts', [dir])
        expect(published.code, published.output).toBe(0)
        const branch = await run('verify-catalog-branch.ts', [
          '--artifacts',
          dir,
          '--assets',
          dir,
          '--base',
          `http://127.0.0.1:${server.port}`,
        ])
        expect(branch.code, branch.output).toBe(0)
      } finally {
        server.stop(true)
      }
    }))
})
