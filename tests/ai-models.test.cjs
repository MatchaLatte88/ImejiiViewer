const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { createModelManager, downloadURL } = require('../electron/ai-models.cjs')

async function fixture(t, fetchImpl) {
  const parent = await fs.realpath(os.tmpdir())
  const root = await fs.mkdtemp(path.join(parent, 'imejii-model-test-'))
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(root)), parent)
    assert.ok(path.basename(root).startsWith('imejii-model-test-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  const bytes = Buffer.from('trusted model fixture'), sha256 = createHash('sha256').update(bytes).digest('hex')
  const models = { test: { id: 'test', bytes: bytes.length, sha256, url: 'https://huggingface.co/test/model.onnx' } }
  const progress = [], manager = createModelManager({ root, models, fetchImpl: fetchImpl || (async () => new Response(bytes)), notify: value => progress.push(value) })
  return { manager, bytes, progress, root, file: path.join(root, sha256 + '.onnx') }
}
test('model URLs are HTTPS and exact host allow-listed, never arbitrary redirects', () => {
  assert.equal(downloadURL('https://us.aws.cdn.hf.co/model'), 'https://us.aws.cdn.hf.co/model')
  for (const url of ['http://huggingface.co/a', 'https://huggingface.co.evil.test/a', 'https://127.0.0.1/model', 'file:///model', 'https://user:pass@huggingface.co/a', 'https://huggingface.co:444/a']) assert.throws(() => downloadURL(url), /Unapproved/)
})
test('model cache installs atomically, verifies on every read, and removes only its own file', async t => {
  const { manager, bytes, root, file } = await fixture(t)
  await fs.writeFile(path.join(root, 'keep.txt'), 'unrelated')
  assert.equal((await manager.status('test')).state, 'missing')
  await manager.install('test')
  assert.equal((await manager.status('test')).state, 'ready')
  assert.deepEqual(Buffer.from(await manager.read('test')), bytes)
  await fs.writeFile(file, Buffer.alloc(bytes.length))
  assert.equal((await manager.status('test')).state, 'corrupt')
  await assert.rejects(manager.read('test'), /checksum/)
  await manager.install('test')
  assert.deepEqual(Buffer.from(await manager.read('test')), bytes)
  await manager.remove('test')
  assert.deepEqual(await fs.readdir(root), ['keep.txt'])
})
test('invalid model identifiers never touch the filesystem or network', async t => {
  let fetched = false
  const { manager, root } = await fixture(t, async () => { fetched = true; throw new Error('should not fetch') })
  for (const id of ['../secret', '__proto__', 'https://example.com/model', null, {}, 1]) {
    await assert.rejects(manager.install(id), /Unknown/)
    await assert.rejects(manager.read(id), /Unknown/)
    await assert.rejects(manager.remove(id), /Unknown/)
  }
  assert.equal(fetched, false); assert.deepEqual(await fs.readdir(root), [])
})
for (const kind of ['short', 'long', 'hash', 'header']) test('rejects ' + kind + ' model bytes without publishing a partial model', async t => {
  const response = kind === 'short' ? Buffer.from('bad') : kind === 'long' ? Buffer.alloc(100) : Buffer.alloc(21)
  const { manager, root } = await fixture(t, async () => new Response(response, kind === 'header' ? { headers: { 'content-length': '2' } } : {}))
  await assert.rejects(manager.install('test'), /size|checksum/)
  assert.deepEqual(await fs.readdir(root), [])
})
test('untrusted and excessive redirects are refused', async t => {
  const { manager, root } = await fixture(t, async () => new Response(null, { status: 302, headers: { location: 'https://localhost/private' } }))
  await assert.rejects(manager.install('test'), /Unapproved/)
  assert.deepEqual(await fs.readdir(root), [])
  const loop = createModelManager({ root, models: { test: { bytes: 1, sha256: '0'.repeat(64), url: 'https://huggingface.co/a' } }, fetchImpl: async () => new Response(null, { status: 302, headers: { location: '/a' } }) })
  await assert.rejects(loop.install('test'), /redirects/)
})
test('cancel aborts only the owned operation, rejects double starts and permits retry', async t => {
  let entered, resolveEntered
  entered = new Promise(resolve => { resolveEntered = resolve })
  const { manager, root } = await fixture(t, async (_url, { signal }) => {
    resolveEntered()
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const job = manager.install('test'), rejected = assert.rejects(job, /canceled/)
  await entered
  await assert.rejects(manager.install('test'), /in progress/)
  await assert.rejects(manager.remove('test'), /in progress/)
  manager.cancel('test'); await rejected
  assert.deepEqual(await fs.readdir(root), [])
  assert.equal((await manager.status('test')).state, 'missing')
})
test('hard-linked model cache entries are neither read nor removed', async t => {
  const { manager, bytes, root, file } = await fixture(t)
  const outside = path.join(root, 'keep.onnx')
  await fs.writeFile(outside, bytes); await fs.link(outside, file)
  await assert.rejects(manager.read('test'), /Unsafe/)
  await assert.rejects(manager.remove('test'), /Unsafe/)
  assert.deepEqual(await fs.readFile(outside), bytes)
})

test('concurrent plugins never receive another models progress or ready state', async t => {
  const { root } = await fixture(t)
  const bytes = Buffer.from('first'), second = Buffer.from('second')
  const spec = (id, value) => ({ id, bytes: value.length, sha256: createHash('sha256').update(value).digest('hex'), url: 'https://huggingface.co/' + id })
  let entered, release
  const fetched = new Promise(resolve => { entered = resolve })
  const manager = createModelManager({ root, models: { a: spec('a', bytes), b: spec('b', second) }, fetchImpl: async () => { entered(); await new Promise(resolve => { release = resolve }); return new Response(bytes) } })
  const first = manager.install('a'); await fetched
  assert.deepEqual(await manager.status('b'), { id: 'b', state: 'missing', busyWith: 'a' })
  await assert.rejects(manager.install('b'), /in progress/)
  manager.cancel('b'); release(); await first
  assert.equal((await manager.status('a')).state, 'ready')
  assert.equal((await manager.status('b')).state, 'missing')
})
