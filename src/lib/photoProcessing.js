import { processImage } from './pipeline.js'
import { canvasToImageData } from './transform.js'
import { createCanvas } from './transform.js'
import { processPhoto } from './photoPipeline.js'

export async function processPhotoAsync(source, edits, options = {}, signal) {
  const snapshot = JSON.parse(JSON.stringify(edits))
  if (signal?.aborted) throw new DOMException('Processing canceled.', 'AbortError')
  if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
    return options.kind === 'logo' ? processImage(canvasToImageData(source), snapshot) : processPhoto(source, snapshot, options)
  }
  const bitmap = await createImageBitmap(source)
  if (signal?.aborted) { bitmap.close(); throw new DOMException('Processing canceled.', 'AbortError') }
  return new Promise((resolve, reject) => {
    let worker
    try { worker = new Worker(new URL('./photoWorker.js', import.meta.url), { type: 'module' }) }
    catch (error) { bitmap.close(); reject(error); return }
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', cancel); clearTimeout(timeout) }
    const cancel = () => { cleanup(); reject(new DOMException('Processing canceled.', 'AbortError')) }
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Processing timed out. Try a smaller image.')) }, 120000)
    signal?.addEventListener('abort', cancel, { once: true })
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Image worker failed.')) }
    worker.onmessage = ({ data }) => {
      cleanup()
      if (data.error) return reject(new Error(data.error))
      try {
        const canvas = createCanvas(data.bitmap.width, data.bitmap.height)
        canvas.getContext('2d').drawImage(data.bitmap, 0, 0)
        resolve(canvas)
      } catch (error) { reject(error) }
      finally { data.bitmap.close() }
    }
    try { worker.postMessage({ bitmap, edits: snapshot, options }, [bitmap]) }
    catch (error) { bitmap.close(); cleanup(); reject(error) }
  })
}
