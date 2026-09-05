const fs = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const catalog = require('../shared/ai-models.json')

const DOWNLOAD_HOSTS = new Set(['huggingface.co', 'us.aws.cdn.hf.co', 'cdn-lfs.huggingface.co', 'cas-bridge.xethub.hf.co'])
function downloadURL(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !DOWNLOAD_HOSTS.has(url.hostname)) throw new Error('Unapproved model download host.')
  return url.href
}

// Only known data files, never executable plugins or renderer-supplied URLs/paths.
// The injectable catalog/fetch are for unit tests; IPC never exposes them.
function createModelManager({ root, models = catalog, fetchImpl = fetch, notify = () => {} }) {
  let operation = null
  let progress = null
  function model(id) {
    if (typeof id !== 'string' || !Object.hasOwn(models, id)) throw new Error('Unknown AI model.')
    return models[id]
  }
  async function paths(id) {
    const spec = model(id)
    await fs.mkdir(root, { recursive: true })
    if ((await fs.lstat(root)).isSymbolicLink() || await fs.realpath(root) !== path.resolve(root)) throw new Error('Model cache must not be a redirected directory.')
    const file = path.join(root, spec.sha256 + '.onnx')
    const part = file + '.part'
    for (const target of [file, part]) {
      const stat = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error })
      if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw new Error('Unsafe model cache entry.')
    }
    return { spec, file, part }
  }
  async function verified(id) {
    const { spec, file } = await paths(id)
    const stat = await fs.stat(file).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (!stat) return 'missing'
    if (stat.size !== spec.bytes) return 'corrupt'
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    return hash.digest('hex') === spec.sha256 ? 'ready' : 'corrupt'
  }
  function update(value) { progress = value; notify(value) }
  async function status(id) {
    model(id)
    if (operation?.id === id) return { id, state: 'busy', ...progress }
    // A second plugin must never display another model's readiness/progress.
    return { id, state: await verified(id), busyWith: operation?.id || null }
  }
  async function exclusive(id, action) {
    model(id)
    if (operation) throw new Error('Another model operation is in progress.')
    const controller = new AbortController()
    operation = { id, controller }
    try { return await action(controller.signal) }
    finally { operation = null; progress = null }
  }
  async function install(id) {
    return exclusive(id, async signal => {
      const { spec, file, part } = await paths(id)
      update({ id, state: 'checking', received: 0, total: spec.bytes })
      if (await verified(id) === 'ready') { update({ id, state: 'ready' }); return { state: 'ready' } }
      // Stale partial files are not models and can never be loaded.
      await fs.unlink(part).catch(error => { if (error.code !== 'ENOENT') throw error })
      const combined = AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)])
      let url = downloadURL(spec.url), response
      try {
        for (let hop = 0; hop <= 5; hop++) {
          response = await fetchImpl(url, { redirect: 'manual', signal: combined, credentials: 'omit' })
          if (![301, 302, 303, 307, 308].includes(response.status)) break
          await response.body?.cancel()
          if (hop === 5 || !response.headers.get('location')) throw new Error('Too many model redirects.')
          url = downloadURL(new URL(response.headers.get('location'), url).href)
        }
        if (!response.ok || !response.body) throw new Error('Model server returned ' + response.status + '.')
        const declared = response.headers.get('content-length')
        if (declared !== null && Number(declared) !== spec.bytes) { await response.body.cancel(); throw new Error('Unexpected model size.') }
        const handle = await fs.open(part, 'wx')
        const hash = createHash('sha256')
        let received = 0, lastUpdate = 0
        update({ id, state: 'downloading', received, total: spec.bytes })
        try {
          for await (const chunk of response.body) {
            combined.throwIfAborted()
            received += chunk.length
            if (received > spec.bytes) throw new Error('Model exceeds its declared size.')
            hash.update(chunk)
            let offset = 0
            while (offset < chunk.length) offset += (await handle.write(chunk, offset, chunk.length - offset)).bytesWritten
            if (Date.now() - lastUpdate > 150) { lastUpdate = Date.now(); update({ id, state: 'downloading', received, total: spec.bytes }) }
          }
          update({ id, state: 'verifying', received, total: spec.bytes })
          if (received !== spec.bytes || hash.digest('hex') !== spec.sha256) throw new Error('Model checksum verification failed. Nothing was installed.')
          combined.throwIfAborted()
          await handle.sync()
        } finally { await handle.close() }
        // Recheck entries before replacing a corrupt copy with verified bytes.
        await paths(id)
        await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
        await fs.rename(part, file)
        update({ id, state: 'ready' })
        return { state: 'ready' }
      } catch (error) {
        await fs.unlink(part).catch(() => {})
        const message = signal.aborted ? 'Model download canceled.' : error.message
        update({ id, state: 'error', error: message })
        throw new Error(message, { cause: error })
      }
    })
  }
  async function read(id) {
    return exclusive(id, async () => {
      const { spec, file } = await paths(id)
      const stat = await fs.stat(file)
      if (stat.size !== spec.bytes) throw new Error('Model is incomplete. Download it again.')
      const buffer = await fs.readFile(file)
      if (buffer.length !== spec.bytes || createHash('sha256').update(buffer).digest('hex') !== spec.sha256) throw new Error('Model checksum verification failed. Download it again.')
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    })
  }
  async function remove(id) {
    return exclusive(id, async () => {
      const { file, part } = await paths(id)
      for (const target of [file, part]) await fs.unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error })
      return { state: 'missing' }
    })
  }
  function cancel(id) { model(id); if (operation?.id === id) operation.controller.abort() }
  return { status, install, read, remove, cancel, dispose: () => operation?.controller.abort() }
}
module.exports = { createModelManager, downloadURL }
