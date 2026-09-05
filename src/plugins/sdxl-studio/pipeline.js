import { createCanvas, canvasToImageData } from '../../lib/transform.js'
import { canvasToBlob } from '../../lib/exportImage.js'
import { dimensions } from '../../lib/studioDocument.js'
import { maskBounds, clamp, compositePixels } from '../ai-remove/mask.js'
import { grayscaleMask } from '../mask-transfer.js'

export const INPAINT_CONTEXT = .618

export function inpaintContextRegion(bounds, maskWidth, maskHeight, width, height, context = INPAINT_CONTEXT) {
  if (!bounds || !Number.isFinite(context) || context < 0 || context > 1) throw new Error('Invalid SDXL inpainting context.')
  const x = bounds.x / maskWidth * width, y = bounds.y / maskHeight * height
  const w = bounds.width / maskWidth * width, h = bounds.height / maskHeight * height
  // Fooocus' default respective field expands small edits until the crop contains
  // roughly 61.8% of both source dimensions. The previous mask-relative square
  // often showed SDXL only sky or wall and hid the scene that establishes style.
  const cropWidth = Math.min(width, Math.ceil(Math.max(128, w * 1.8, width * context)))
  const cropHeight = Math.min(height, Math.ceil(Math.max(128, h * 1.8, height * context)))
  return {
    x: clamp(Math.floor(x + w / 2 - cropWidth / 2), 0, width - cropWidth),
    y: clamp(Math.floor(y + h / 2 - cropHeight / 2), 0, height - cropHeight),
    width: cropWidth,
    height: cropHeight,
  }
}

export function copyCanvas(source) {
  dimensions(source.width, source.height)
  const result = createCanvas(source.width, source.height)
  result.getContext('2d').putImageData(canvasToImageData(source), 0, 0)
  return result
}
export function workingMask(source, initial = null) {
  const ratio = Math.min(1, 2048 / Math.max(source.width, source.height))
  const mask = createCanvas(Math.max(1, Math.round(source.width * ratio)), Math.max(1, Math.round(source.height * ratio)))
  if (initial) mask.getContext('2d').drawImage(initial, 0, 0, mask.width, mask.height)
  return mask
}
export function maskMatchesSource(source, mask) {
  if (mask.width === source.width && mask.height === source.height) return true
  const ratio = Math.min(1, 2048 / Math.max(source.width, source.height))
  return mask.width === Math.max(1, Math.round(source.width * ratio)) && mask.height === Math.max(1, Math.round(source.height * ratio))
}
export function alphaFromGrayscale(canvas) {
  const pixels = canvasToImageData(canvas)
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i] !== pixels.data[i + 1] || pixels.data[i] !== pixels.data[i + 2] || pixels.data[i + 3] !== 255) throw new Error('Import an opaque grayscale mask: white repaints, black preserves.')
    pixels.data[i + 3] = pixels.data[i]; pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255
  }
  const result = createCanvas(canvas.width, canvas.height); result.getContext('2d').putImageData(pixels, 0, 0)
  return result
}
export async function prepareInpaint(source, mask) {
  dimensions(source.width, source.height)
  const bounds = maskBounds(canvasToImageData(mask).data, mask.width, mask.height)
  if (!bounds) throw new Error('Paint a selection before running inpainting.')
  const crop = inpaintContextRegion(bounds, mask.width, mask.height, source.width, source.height)
  // Fixed square model canvas. Aspect ratio is retained; edge padding is removed
  // before inverse projection. Full-background masks are allowed.
  const scale = 1024 / Math.max(crop.width, crop.height)
  const width = Math.max(1, Math.round(crop.width * scale)), height = Math.max(1, Math.round(crop.height * scale))
  const x = Math.floor((1024 - width) / 2), y = Math.floor((1024 - height) / 2)
  const image = createCanvas(1024, 1024), ctx = image.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1024, 1024)
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, x, y, width, height)
  // Extend the already flattened edge, keeping padding out of the selection.
  if (x) { ctx.drawImage(image, x, y, 1, height, 0, y, x, height); ctx.drawImage(image, x + width - 1, y, 1, height, x + width, y, 1024 - x - width, height) }
  if (y) { ctx.drawImage(image, 0, y, 1024, 1, 0, 0, 1024, y); ctx.drawImage(image, 0, y + height - 1, 1024, 1, 0, y + height, 1024, 1024 - y - height) }
  const fullMask = grayscaleMask(mask, source.width, source.height)
  const inference = createCanvas(1024, 1024), mctx = inference.getContext('2d')
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, 1024, 1024)
  mctx.drawImage(fullMask, crop.x, crop.y, crop.width, crop.height, x, y, width, height)
  const [imageBlob, maskBlob] = await Promise.all([canvasToBlob(image, 'png'), canvasToBlob(inference, 'png')])
  return { image: await imageBlob.arrayBuffer(), mask: await maskBlob.arrayBuffer(), geometry: { version: 2, crop, context: INPAINT_CONTEXT, fit: { x, y, width, height }, input: 1024, sourceWidth: source.width, sourceHeight: source.height } }
}

export async function prepareOutpaint(source, settings) {
  dimensions(source.width, source.height)
  const sides = ['left', 'right', 'top', 'bottom']
  const values = Object.fromEntries(sides.map(key => [key, settings?.[key]]))
  if (sides.some(key => !Number.isInteger(values[key]) || values[key] < 0 || values[key] > 2048)) throw new Error('Outpainting extensions must be whole pixels between 0 and 2048.')
  if (!sides.some(key => values[key] > 0)) throw new Error('Extend at least one side before outpainting.')
  const overlap = settings?.overlap
  if (!Number.isInteger(overlap) || overlap < 0 || overlap > 256) throw new Error('Outpainting overlap must be between 0 and 256 pixels.')
  const width = source.width + values.left + values.right, height = source.height + values.top + values.bottom
  dimensions(width, height)

  const expanded = createCanvas(width, height), ctx = expanded.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height)
  ctx.clearRect(values.left, values.top, source.width, source.height)
  ctx.drawImage(source, values.left, values.top)

  const selection = createCanvas(width, height), mctx = selection.getContext('2d')
  const pixels = mctx.createImageData(width, height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const insideX = x >= values.left && x < values.left + source.width
    const insideY = y >= values.top && y < values.top + source.height
    let alpha = insideX && insideY ? 0 : 255
    if (insideX && insideY && overlap) {
      const localX = x - values.left, localY = y - values.top
      if (values.left) alpha = Math.max(alpha, Math.round(255 * Math.max(0, overlap - localX) / overlap))
      if (values.right) alpha = Math.max(alpha, Math.round(255 * Math.max(0, overlap - (source.width - 1 - localX)) / overlap))
      if (values.top) alpha = Math.max(alpha, Math.round(255 * Math.max(0, overlap - localY) / overlap))
      if (values.bottom) alpha = Math.max(alpha, Math.round(255 * Math.max(0, overlap - (source.height - 1 - localY)) / overlap))
    }
    const i = (y * width + x) * 4
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255; pixels.data[i + 3] = alpha
  }
  mctx.putImageData(pixels, 0, 0)
  const prepared = await prepareInpaint(expanded, selection)
  return { ...prepared, source: expanded, selection, outputWidth: width, outputHeight: height, placement: { x: values.left, y: values.top, width: source.width, height: source.height }, settings: { ...values, overlap } }
}

export function composeInpaint(source, mask, generated, geometry) {
  if (generated.width !== 1024 || generated.height !== 1024 || source.width !== geometry.sourceWidth || source.height !== geometry.sourceHeight) throw new Error('The provider returned unexpected image dimensions.')
  const result = copyCanvas(source), ctx = result.getContext('2d'), { crop, fit } = geometry
  const patch = createCanvas(crop.width, crop.height)
  patch.getContext('2d').drawImage(generated, fit.x, fit.y, fit.width, fit.height, 0, 0, crop.width, crop.height)
  const fullMask = createCanvas(source.width, source.height)
  fullMask.getContext('2d').drawImage(mask, 0, 0, source.width, source.height)
  const original = ctx.getImageData(crop.x, crop.y, crop.width, crop.height)
  compositePixels(original.data, canvasToImageData(patch).data, fullMask.getContext('2d').getImageData(crop.x, crop.y, crop.width, crop.height).data)
  ctx.putImageData(original, crop.x, crop.y)
  return result
}
