const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const { createCutoutService, validateImage } = require('../electron/cutout.cjs')
const tick = () => new Promise(resolve => setImmediate(resolve))
const payload = () => ({ id: randomUUID(), image: new Float32Array(3 * 1024 * 1024) })
function setup(options = {}) {
  const children = [], phases = [], ids = []
  const service = createCutoutService({ readModel: async id => { ids.push(id); return new ArrayBuffer(1) },
    spawn: () => {
      const child = new EventEmitter(); child.killed = 0
      child.kill = () => { child.killed++; return true }
      child.postMessage = value => { child.sent = value }
      children.push(child); return child
    }, notify: progress => phases.push(progress), ...options })
  return { service, children, phases, ids }
}
test('Cutout IPC rejects unknown requests, tensor shape/type and non-finite/out-of-range data', () => {
  const { service } = setup()
  assert.throws(() => service.run({ ...payload(), id: '../model' }), /Invalid cutout request/)
  for (const image of [null, new Float64Array(3 * 1024 * 1024), new Float32Array(2), new Float32Array(3 * 1024 * 1024).fill(NaN), new Float32Array(3 * 1024 * 1024).fill(5)]) {
    assert.throws(() => validateImage(image), /Invalid cutout/)
  }
})
test('Cutout runs only the pinned model, filters phases and kills successful native processes', async () => {
  const { service, children, phases, ids } = setup(), request = payload()
  const pending = service.run(request); await tick()
  assert.throws(() => service.run(payload()), /already running/)
  const child = children[0]
  assert.deepEqual(ids, ['birefnet-lite-v1']); assert.equal(child.sent.image, request.image)
  child.emit('message', { phase: 'inference' })
  const output = new Float32Array(1024 * 1024)
  child.emit('message', { output })
  assert.equal(await pending, output); assert.equal(child.killed, 1)
  assert.equal(phases.at(-1).id, request.id)
  child.emit('exit', 1) // late exit must not settle another request.
})
test('Cutout cancellation during model verification never starts a stale child', async () => {
  let complete
  const { service, children } = setup({ readModel: () => new Promise(resolve => { complete = resolve }) })
  const request = payload(), pending = service.run(request)
  service.cancel(request.id); await assert.rejects(pending, /canceled/)
  complete(new ArrayBuffer(1)); await tick(); assert.equal(children.length, 0)
})
test('Cutout cancellation/timeout/crashes free the single job and stale replies cannot finish retries', async () => {
  const { service, children } = setup(), request = payload(), first = service.run(request)
  await tick(); service.cancel(randomUUID()); assert.equal(children[0].killed, 0)
  service.cancel(request.id); await assert.rejects(first, /canceled/); assert.equal(children[0].killed, 1)
  const second = service.run(payload()); await tick()
  children[0].emit('message', { output: new Float32Array(1024 * 1024) })
  children[1].emit('exit', 1); await assert.rejects(second, /stopped/)
  const third = service.run(payload()); await tick(); service.dispose(); await assert.rejects(third, /canceled/)
  const timed = setup({ timeout: 5 }); await assert.rejects(timed.service.run(payload()), /timed out/)
  assert.equal(timed.children[0].killed, 1)
})
test('Cutout rejects malformed native results and isolates spawn/model failures', async () => {
  for (const output of [new Uint8Array(1024 * 1024), new Float32Array(1), new Float32Array(1024 * 1024).fill(Infinity)]) {
    const { service, children } = setup(), pending = service.run(payload()); await tick()
    children[0].emit('message', { output }); await assert.rejects(pending, /Unexpected/)
    assert.equal(children[0].killed, 1)
  }
  for (const options of [{ readModel: async () => { throw new Error('Invalid checksum') } }, { spawn: () => { throw new Error('Spawn failure') } }]) {
    const { service } = setup(options)
    await assert.rejects(service.run(payload()), /checksum|Spawn/)
    await assert.rejects(service.run(payload()), /checksum|Spawn/) // no leaked job
  }
})
