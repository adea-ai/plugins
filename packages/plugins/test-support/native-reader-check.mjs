// Run against a locally built test addon: node native-reader-check.mjs /path/to/addon.node
// Compile with STAGED_MAX_BYTES=131072 to exercise the bound without large allocations.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { read } = createRequire(import.meta.url)(process.argv[2])
const dir = await mkdtemp(join(tmpdir(), 'staged-native-'))
try {
  const file = join(dir, 'regular')
  await writeFile(file, 'expected')
  const pending = read(file)
  assert.ok(pending instanceof Promise)
  assert.equal((await pending).toString(), 'expected')
  await assert.rejects(read(join(dir, 'missing')), { code: 'ENOENT' })
  await mkdir(join(dir, 'directory'))
  await assert.rejects(read(join(dir, 'directory')), /STAGED_FILE_UNSAFE|STAGED_FILE_OPEN_FAILED/)
  await symlink(file, join(dir, 'link'))
  await assert.rejects(read(join(dir, 'link')), /STAGED_FILE_UNSAFE|STAGED_FILE_OPEN_FAILED/)
  assert.throws(() => read(`${file}\0suffix`), /STAGED_FILE_INVALID_REQUEST/)
  await writeFile(file, Buffer.alloc(131072, 7))
  assert.equal((await read(file)).length, 131072)
  await writeFile(file, Buffer.alloc(131073, 7))
  await assert.rejects(read(file), /STAGED_FILE_TOO_LARGE/)
  console.log('native reader boundary tests passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
