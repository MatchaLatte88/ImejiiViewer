// One worker per runtime. Cancellation also invalidates an in-flight model read.
import { claimAI } from './ai-jobs.js'
export function createModelRuntime({ modelId, workerFactory, readModel = () => window.desktopApi.aiModelRead(modelId), timeout = 180000, jobName = 'Processing' }) {
  let worker = null, pending = null, loaded = false, idle = null
  function dispose() {
    clearTimeout(idle)
    worker?.terminate(); worker = null; loaded = false
    pending?.reject(new DOMException(jobName + ' canceled.', 'AbortError')); pending = null
  }
  async function run(prepared, onPhase = () => {}) {
    if (pending) throw new Error(jobName + ' is already running.')
    const release = claimAI(jobName)
    clearTimeout(idle)
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      let timer
      const finish = (error, output) => {
        if (pending?.id !== id) return
        clearTimeout(timer); pending = null
        if (error) { worker?.terminate(); worker = null; loaded = false; reject(error) }
        else { loaded = true; idle = setTimeout(dispose, 60000); resolve(output) }
      }
      pending = { id, reject: error => { clearTimeout(timer); reject(error) } }
      timer = setTimeout(() => finish(new Error(jobName + ' timed out. Restart the plugin and try again.')), timeout)
      void (async () => {
        onPhase('Checking local model…')
        const model = loaded ? null : await readModel()
        if (pending?.id !== id) return
        if (!worker) worker = workerFactory()
        worker.onmessage = ({ data }) => {
          if (data.id !== id || pending?.id !== id) return
          if (data.phase) onPhase(data.phase)
          else if (data.error) finish(new Error(data.error))
          else finish(null, data.output)
        }
        worker.onerror = event => { event.preventDefault?.(); finish(new Error('The local AI worker failed. Restart the plugin and try again.')) }
        worker.onmessageerror = () => finish(new Error('Unable to read the AI result.'))
        const transfer = [prepared.image.buffer, ...(prepared.mask ? [prepared.mask.buffer] : []), ...(model ? [model] : [])]
        worker.postMessage({ id, model, image: prepared.image, mask: prepared.mask }, transfer)
      })().catch(error => finish(error))
    }).finally(release)
  }
  return { run, dispose }
}
