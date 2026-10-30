// Exercise pathname replacement while native async reads are in flight.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

const { read } = createRequire(import.meta.url)(process.argv[2])
const dir = await mkdtemp(join(tmpdir(), 'staged-native-race-'))
const target = join(dir, 'target')
const outside = join(dir, 'outside')
await writeFile(target, 'safe')
await writeFile(outside, 'outside-secret')
const counts = new SharedArrayBuffer(8)
const observed = new Int32Array(counts)
const worker = new Worker(
  `const {parentPort,workerData}=require('node:worker_threads');
   const fs=require('node:fs'); const p=require('node:path'); let i=0; const counts=new Int32Array(workerData.counts);
   function next(){for(let j=0;j<50;j++){const t=p.join(workerData.dir,'next');
   try {const link=i++%2; if(link)fs.symlinkSync(workerData.outside,t); else fs.writeFileSync(t,'safe');
   fs.renameSync(t,workerData.target); Atomics.add(counts,link?1:0,1)}catch(e){try{fs.unlinkSync(t)}catch{}}} setImmediate(next)}
   parentPort.postMessage('ready'); next()`,
  { eval: true, workerData: { dir, target, outside, counts } }
)
try {
  await new Promise((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
  })
  for (let i = 0; i < 250; i++) {
    try {
      assert.equal((await read(target)).toString(), 'safe')
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error
      assert.match(error.message, /STAGED_FILE_UNSAFE|STAGED_FILE_OPEN_FAILED/)
    }
  }
  assert.ok(Atomics.load(observed, 0) > 0, 'no regular replacements completed')
  assert.ok(Atomics.load(observed, 1) > 0, 'no symlink replacements completed')
  console.log('native pathname replacement test passed')
} finally {
  await worker.terminate()
  await rm(dir, { recursive: true, force: true })
}
