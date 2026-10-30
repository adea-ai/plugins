import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Windows qualification unpacks from a directory whose path contains a drive colon', () => {
  const workflows = [
    '.github/workflows/staged-reader-manual-qualification.yml',
    '.github/workflows/staged-reader-windows.yml',
  ].filter((path) => existsSync(path))
  expect(workflows.length).toBeGreaterThan(0)
  const temp = mkdtempSync(join(tmpdir(), 'staged-unpack-'))
  try {
    const runnerTemp = process.platform === 'win32' ? temp : join(temp, 'C:', 'runner temp')
    mkdirSync(join(runnerTemp, 'source', 'package'), { recursive: true })
    writeFileSync(join(runnerTemp, 'source', 'package', 'proof.txt'), 'packed bytes')
    execFileSync('tar', ['-czf', 'adea-ai-plugins-test.tgz', '-C', 'source', 'package'], {
      cwd: runnerTemp,
    })
    for (const workflow of workflows) {
      const source = readFileSync(workflow, 'utf8')
      const command = source
        .split('\n')
        .find((line) => line.includes('tar -xzf'))
        ?.trim()
      expect(command).toBeDefined()
      const destination = join(runnerTemp, 'packed-reader')
      rmSync(destination, { recursive: true, force: true })
      mkdirSync(destination)
      execFileSync('bash', ['-eu', '-c', command!], {
        env: { ...process.env, RUNNER_TEMP: runnerTemp },
      })
      expect(readFileSync(join(destination, 'package', 'proof.txt'), 'utf8')).toBe('packed bytes')
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
