export const INPUT_SIZE = 1024
export const MASK_LONG_EDGE = 2048
export const MAX_STROKES = 120
export const MAX_POINTS = 24000
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
export function canvas(width, height) {
  const c = document.createElement('canvas'); c.width = width; c.height = height; return c
}
function dimensions(source) {
  if (!Number.isInteger(source?.width) || !Number.isInteger(source?.height) || source.width < 1 || source.height < 1 || source.width * source.height > 24000000) throw new Error('Local AI supports photos up to 24 megapixels.')
}

export function prepareCutout(source) {
  dimensions(source)
  const small = canvas(INPUT_SIZE, INPUT_SIZE), ctx = small.getContext('2d', { willReadFrequently: true })
  // Match the pinned model's resize + ImageNet normalization contract. The model
  // expects a square resize (not letterboxing). Only the matte is projected back.
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, INPUT_SIZE, INPUT_SIZE)
  const rgba = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data
  const area = INPUT_SIZE * INPUT_SIZE, image = new Float32Array(area * 3)
  const mean = [.485, .456, .406], std = [.229, .224, .225]
  for (let i = 0; i < area; i++) for (let c = 0; c < 3; c++) image[c * area + i] = (rgba[i * 4 + c] / 255 - mean[c]) / std[c]
  small.width = small.height = 1
  return { image }
}

export function createMatte(output, source) {
  dimensions(source)
  if (!(output instanceof Float32Array) || output.length !== INPUT_SIZE * INPUT_SIZE || output.some(n => !Number.isFinite(n))) throw new Error('The model returned an invalid subject mask.')
  const small = canvas(INPUT_SIZE, INPUT_SIZE), pixels = new ImageData(INPUT_SIZE, INPUT_SIZE)
  // BiRefNet emits logits, not alpha values. Never min/max-normalize: constant
  // predictions must not divide by zero or turn uncertain masks fully opaque.
  for (let i = 0; i < output.length; i++) {
    pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255
    pixels.data[i * 4 + 3] = Math.round(255 / (1 + Math.exp(-output[i])))
  }
  small.getContext('2d').putImageData(pixels, 0, 0)
  const scale = Math.min(1, MASK_LONG_EDGE / Math.max(source.width, source.height))
  const matte = canvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)))
  const ctx = matte.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(small, 0, 0, matte.width, matte.height)
  small.width = small.height = 1
  return matte
}

export function refineMatte(base, { balance = 0, feather = 0 } = {}, strokes = []) {
  if (!Number.isFinite(balance) || balance < -25 || balance > 25 || !Number.isFinite(feather) || feather < 0 || feather > 3) throw new Error('Invalid edge settings.')
  if (strokes.length > MAX_STROKES || strokes.reduce((n, s) => n + (s.points?.length || 0), 0) > MAX_POINTS) throw new Error('Correction mask limit reached.')
  const result = canvas(base.width, base.height), ctx = result.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(base, 0, 0)
  if (balance) {
    const data = ctx.getImageData(0, 0, result.width, result.height)
    for (let i = 3; i < data.data.length; i += 4) {
      const a = data.data[i] / 255
      // A continuous edge bias leaves certain foreground/background intact.
      data.data[i] = Math.round(255 * clamp(a + balance / 25 * a * (1 - a), 0, 1))
    }
    ctx.putImageData(data, 0, 0)
  }
  if (feather) {
    // Clamp all four image boundaries so feathering a subject touching the
    // frame does not introduce an unrelated transparent border.
    const pad = Math.ceil(feather * 4) + 1, w = base.width, h = base.height
    const padded = canvas(w + 2 * pad, h + 2 * pad), pctx = padded.getContext('2d')
    pctx.imageSmoothingEnabled = false
    pctx.drawImage(result, pad, pad)
    pctx.drawImage(result, 0, 0, w, 1, pad, 0, w, pad)
    pctx.drawImage(result, 0, h - 1, w, 1, pad, pad + h, w, pad)
    pctx.drawImage(padded, pad, 0, 1, padded.height, 0, 0, pad, padded.height)
    pctx.drawImage(padded, pad + w - 1, 0, 1, padded.height, pad + w, 0, pad, padded.height)
    ctx.clearRect(0, 0, w, h); ctx.filter = `blur(${feather}px)`; ctx.drawImage(padded, -pad, -pad); ctx.filter = 'none'
    padded.width = padded.height = 1
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.fillStyle = ctx.strokeStyle = '#ffffff'
  // Replay corrections AFTER automatic edge refinement. Restore only changes
  // the matte; composition still multiplies the source's existing alpha.
  for (const stroke of strokes) {
    if (!Number.isFinite(stroke.size) || stroke.size < .005 || stroke.size > .25 || !stroke.points?.length || stroke.points.some(p => p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1))) throw new Error('Invalid mask correction.')
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
    const radius = stroke.size * Math.min(result.width, result.height) / 2
    const [x, y] = stroke.points[0]; ctx.lineWidth = radius * 2
    ctx.beginPath(); ctx.arc(x * result.width, y * result.height, radius, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.moveTo(x * result.width, y * result.height)
    for (const [xx, yy] of stroke.points.slice(1)) ctx.lineTo(xx * result.width, yy * result.height)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
  return result
}

export function composeCutout(source, matte) {
  dimensions(source)
  const result = canvas(source.width, source.height), ctx = result.getContext('2d')
  ctx.drawImage(source, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(matte, 0, 0, source.width, source.height)
  ctx.globalCompositeOperation = 'source-over'
  return result
}
