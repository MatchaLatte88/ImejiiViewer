import { claimAI } from '../ai-jobs.js'
export function createCutoutRuntime({ api = window.desktopApi } = {}) {
  let pending = null
  function dispose() {
    if (!pending) return
    const job = pending; pending = null; job.release()
    void api.aiCutoutCancel(job.id).catch(() => {})
    job.reject(new DOMException('Background removal canceled.', 'AbortError'))
  }
  function run({ image }, onPhase = () => {}) {
    if (pending) return Promise.reject(new Error('Background removal is already running.'))
    let releaseAI
    try { releaseAI = claimAI('Background removal') } catch (error) { return Promise.reject(error) }
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const release = api.onAiCutoutProgress(progress => { if (pending?.id === id && progress.id === id) onPhase(progress.phase) })
      pending = { id, reject, release }
      const finish = (error, output) => {
        if (pending?.id !== id) return
        pending = null; release()
        if (error) reject(error); else resolve(output)
      }
      Promise.resolve().then(() => {
        if (pending?.id !== id) return
        return api.aiCutoutRun({ id, image })
      }).then(output => finish(null, output), error => finish(error))
    }).finally(releaseAI)
  }
  return { run, dispose }
}
