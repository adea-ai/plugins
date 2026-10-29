import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

/** Read an already validated flat name without following a final-component symlink. */
export async function readStagedFile(directory: string, name: string): Promise<Buffer> {
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
