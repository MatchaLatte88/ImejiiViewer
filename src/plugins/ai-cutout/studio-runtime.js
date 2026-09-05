import { createCanvas } from '../../lib/transform.js'
import { studioSettings } from './studio.js'
export async function renderStudioAsync(source, matte, settings, background, options, signal) {
  signal?.throwIfAborted()
  const snapshot = studioSettings(settings), bitmaps = []
  try {
    for (const c of [source, matte, background]) { bitmaps.push(c ? await createImageBitmap(c) : null); signal?.throwIfAborted() }
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./studio.worker.js', import.meta.url), { type: 'module' })
      const cleanup = () => { worker.terminate(); clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
      const cancel = () => { cleanup(); reject(new DOMException('Composition canceled.', 'AbortError')) }
      const timer = setTimeout(() => { cleanup(); reject(new Error('Composition timed out. Try a smaller photo.')) }, 120000)
      signal?.addEventListener('abort', cancel, { once: true })
      worker.onerror = () => { cleanup(); reject(new Error('The composition worker failed.')) }
      worker.onmessageerror = () => { cleanup(); reject(new Error('The composition worker returned invalid data.')) }
      worker.onmessage = ({ data }) => {
        cleanup()
        if (data.error) return reject(new Error(data.error))
        try {
          const canvas = createCanvas(data.bitmap.width, data.bitmap.height); canvas.getContext('2d').drawImage(data.bitmap, 0, 0)
          resolve({ canvas, geometry: data.geometry })
        } catch (error) { reject(error) } finally { data.bitmap?.close() }
      }
      try { worker.postMessage({ source: bitmaps[0], matte: bitmaps[1], background: bitmaps[2], settings: snapshot, options }, bitmaps.filter(Boolean)) }
      catch (error) { cleanup(); reject(error) }
    })
  } finally { for (const bitmap of bitmaps) bitmap?.close() }
}
