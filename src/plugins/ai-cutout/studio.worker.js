import { createCanvas } from '../../lib/transform.js'
import { renderStudio } from './studio.js'
self.onmessage = ({ data }) => {
  const canvases = []
  const unwrap = bitmap => {
    if (!bitmap) return null
    const c = createCanvas(bitmap.width, bitmap.height); c.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); canvases.push(c); return c
  }
  try {
    const { canvas, geometry } = renderStudio(unwrap(data.source), unwrap(data.matte), data.settings, unwrap(data.background), data.options)
    const bitmap = canvas.transferToImageBitmap(); self.postMessage({ bitmap, geometry }, [bitmap])
  } catch (error) { self.postMessage({ error: error.message }) }
  finally { for (const c of canvases) c.width = c.height = 1; for (const key of ['source', 'matte', 'background']) data[key]?.close() }
}
