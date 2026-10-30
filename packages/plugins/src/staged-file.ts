import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/** Read an already validated flat name without following a final-component symlink. */
export async function readStagedFile(directory: string, name: string): Promise<Buffer> {
  if (process.platform === 'win32') {
    // The binary is built and qualified separately for each supported Windows architecture.
    // Failure to load it is fatal: falling back to a path check would introduce a race.
    let reader: { read(path: string): Promise<Buffer> }
    try {
      if (process.arch !== 'x64' && process.arch !== 'arm64')
        throw new Error('unsupported architecture')
      reader = createRequire(import.meta.url)(
        `../native/staged-reader-win32-${process.arch}.node`
      ) as typeof reader
      if (typeof reader.read !== 'function') throw new Error('invalid native reader')
    } catch (cause) {
      throw new Error('STAGED_NOFOLLOW_UNSUPPORTED', { cause })
    }
    return reader.read(join(directory, name))
  }
  if (typeof constants.O_NOFOLLOW !== 'number' || constants.O_NOFOLLOW === 0)
    throw new Error('STAGED_NOFOLLOW_UNSUPPORTED')
  let file
  try {
    file = await open(
      join(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP')
      throw new Error(`STAGED_FILE_UNSAFE: ${name}`, { cause: error })
    throw error
  }
  try {
    if (!(await file.stat()).isFile()) throw new Error(`STAGED_FILE_UNSAFE: ${name}`)
    return await file.readFile()
  } finally {
    await file.close()
  }
}
