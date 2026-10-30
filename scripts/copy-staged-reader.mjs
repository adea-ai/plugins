import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const source = 'packages/plugins/native'
const destination = 'dist/packages/plugins/native'
await mkdir(destination, { recursive: true })
for (const arch of ['x64', 'arm64']) {
  await rm(join(destination, `staged-reader-win32-${arch}.node`), { force: true })
}
for (const name of await readdir(source)) {
  if (/^staged-reader-win32-(x64|arm64)\.node$/.test(name)) {
    await copyFile(join(source, name), join(destination, name))
  }
}
