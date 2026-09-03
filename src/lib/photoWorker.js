import { processImage } from './pipeline.js'
import { createCanvas, canvasToImageData } from './transform.js'
import { processPhoto } from './photoPipeline.js'
self.onmessage = ({ data }) => {
  try {
    const source = createCanvas(data.bitmap.width, data.bitmap.height)
    source.getContext('2d').drawImage(data.bitmap, 0, 0)
    data.bitmap.close()
    let canvas
    if (data.options.kind === 'logo') {
      canvas = processImage(canvasToImageData(source), data.edits)
    } else canvas = processPhoto(source, data.edits, data.options)
    const bitmap = canvas.transferToImageBitmap()
    self.postMessage({ bitmap }, [bitmap])
  } catch (error) {
    data.bitmap?.close()
    self.postMessage({ error: error.message })
  }
}
