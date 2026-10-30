import assert from 'node:assert/strict'
import { mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { readStagedFile } = await import(pathToFileURL(resolve(process.argv[2])).href)
const dir = await mkdtemp(join(tmpdir(), 'staged-layout-'))
try {
  await writeFile(join(dir, 'regular'), 'expected')
  assert.equal((await readStagedFile(dir, 'regular')).toString(), 'expected')
  await symlink(join(dir, 'regular'), join(dir, 'link'))
  await assert.rejects(readStagedFile(dir, 'link'), /STAGED_FILE_UNSAFE|STAGED_FILE_OPEN_FAILED/)
  await rename(join(dir, 'regular'), join(dir, 'moved'))
  await assert.rejects(readStagedFile(dir, 'regular'), { code: 'ENOENT' })
} finally {
  await rm(dir, { recursive: true, force: true })
}
