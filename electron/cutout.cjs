// A single bounded inference job in a disposable native utility process.
// No renderer-selected files, model paths, options, modules or execution providers.
const INPUT_LENGTH = 3 * 1024 * 1024
const OUTPUT_LENGTH = 1024 * 1024
function requestId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid cutout request.')
}
function validateImage(image) {
  if (!(image instanceof Float32Array) || image.length !== INPUT_LENGTH) throw new Error('Invalid cutout image.')
  for (const value of image) if (!Number.isFinite(value) || value < -4 || value > 4) throw new Error('Invalid cutout pixel.')
}
function createCutoutService({ readModel, spawn, notify = () => {}, timeout = 240000 }) {
  let active = null
  function cancel(id) { requestId(id); if (active?.id === id) active.finish(new Error('Background removal canceled.')) }
  function dispose() { active?.finish(new Error('Background removal canceled.')) }
  function run(payload) {
    const { id, image } = payload || {}
    requestId(id)
    if (active) throw new Error('Background removal is already running.')
    validateImage(image)
    return new Promise((resolve, reject) => {
      const job = { id, child: null, finish: null }
      let timer
      job.finish = (error, output) => {
        if (active !== job) return
        active = null; clearTimeout(timer)
        job.child?.kill()
        if (error) reject(error); else resolve(output)
      }
      active = job
      timer = setTimeout(() => job.finish(new Error('Background removal timed out. Try again on a faster device.')), timeout)
      void (async () => {
        notify({ id, phase: 'Checking local model…' })
        // The model manager verifies the complete pinned bytes before they reach ORT.
        const model = await readModel('birefnet-lite-v1')
        if (active !== job) return
        const child = spawn(); job.child = child
        child.once('spawn', () => { if (active !== job) child.kill() })
        child.once('exit', () => job.finish(new Error('The local AI process stopped. It may need more available memory.')))
        child.on('error', () => job.finish(new Error('Unable to start the local AI process.')))
        child.on('message', data => {
          if (active !== job) return
          if (data?.phase === 'loading' || data?.phase === 'inference') {
            notify({ id, phase: data.phase === 'loading' ? 'Loading local model…' : 'Separating subject from background…' })
          } else if (data?.error) {
            job.finish(new Error(data.error === 'memory' ? 'The local AI process ran out of memory. Close other memory-intensive apps and try again.' : 'The local background model failed. Try again or re-download the model.'))
          } else if (data?.output instanceof Float32Array && data.output.length === OUTPUT_LENGTH && data.output.every(Number.isFinite)) {
            job.finish(null, data.output)
          } else job.finish(new Error('Unexpected background model output.'))
        })
        child.postMessage({ model, image })
      })().catch(error => job.finish(error))
    })
  }
  return { run, cancel, dispose, get busy() { return Boolean(active) } }
}
module.exports = { createCutoutService, validateImage, requestId }
