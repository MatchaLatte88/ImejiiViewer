import { createCanvas, canvasToImageData } from '../lib/transform.js'
import { spreadAlpha } from './ai-cutout/studio.js'

// Internal masks use alpha; interchange masks use opaque grayscale.
export function selectionMask(source, matte, area, { forRemoval = false } = {}) {
  if (!['subject', 'background'].includes(area)) throw new Error('Unknown mask selection.')
  if (!matte?.width || !matte?.height || Math.max(matte.width, matte.height) > 2048) throw new Error('Invalid selection dimensions.')
  const result = createCanvas(matte.width, matte.height), ctx = result.getContext('2d')
  ctx.drawImage(source, 0, 0, result.width, result.height)
  const sourcePixels = canvasToImageData(result).data, pixels = canvasToImageData(matte), alpha = new Uint8ClampedArray(result.width * result.height)
  for (let i = 0; i < alpha.length; i++) {
    const subject = pixels.data[i * 4 + 3] * sourcePixels[i * 4 + 3] / 255
    alpha[i] = area === 'subject' ? subject : 255 - subject
    if (forRemoval) alpha[i] = alpha[i] >= 8 ? 255 : 0
  }
  const selected = forRemoval ? spreadAlpha(alpha, result.width, result.height, 2) : alpha
  for (let i = 0; i < alpha.length; i++) { pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255; pixels.data[i * 4 + 3] = selected[i] }
  ctx.putImageData(pixels, 0, 0); return result
}
export function grayscaleMask(mask, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 24000000) throw new Error('Invalid export mask size.')
  const result = createCanvas(width, height), ctx = result.getContext('2d'); ctx.drawImage(mask, 0, 0, width, height)
  const pixels = canvasToImageData(result)
  for (let i = 0; i < pixels.data.length; i += 4) { const a = pixels.data[i + 3]; pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = a; pixels.data[i + 3] = 255 }
  ctx.putImageData(pixels, 0, 0); return result
}
