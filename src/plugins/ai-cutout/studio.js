import { createCanvas, canvasToImageData, imageDataToCanvas, findContentBounds } from '../../lib/transform.js'
import { applyAdjustments } from '../../lib/adjustments.js'
import { applyBlur, applySharpen } from '../../lib/effects.js'

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const number = (v, fallback, lo, hi) => Number.isFinite(v) ? clamp(v, lo, hi) : fallback
const choice = (v, values, fallback) => values.includes(v) ? v : fallback
const color = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback
export const RATIOS = ['free', '1:1', '4:5', '3:2', '16:9']
const ratioValue = value => { const [w, h] = value.split(':').map(Number); return w / h }
const region = (input = {}) => { const v = input || {}; return ({
  exposure: number(v.exposure, 0, -2, 2), temperature: number(v.temperature, 0, -100, 100),
  tint: number(v.tint, 0, -100, 100), contrast: number(v.contrast, 0, -100, 100),
  saturation: number(v.saturation, 0, -100, 100), sharpen: number(v.sharpen, 0, 0, 100),
  look: choice(v.look, ['natural', 'bw', 'warm', 'cool'], 'natural'),
}) }
export function studioSettings(value = {}) {
  value ||= {}
  const b = value.background || {}, f = value.frame || {}, s = value.sticker || {}, p = value.placement || {}
  return {
    subject: region(value.subject), surroundings: region(value.surroundings),
    background: {
      kind: choice(b.kind, ['transparent', 'original', 'color', 'gradient', 'image'], 'transparent'),
      color: color(b.color, '#ffffff'), color2: color(b.color2, '#dce5ed'), angle: number(b.angle, 135, 0, 360),
      fit: choice(b.fit, ['cover', 'contain'], 'cover'), x: number(b.x, 50, 0, 100), y: number(b.y, 50, 0, 100),
      blur: number(b.blur, 0, 0, 30),
    },
    frame: { mode: choice(f.mode, ['original', 'crop', 'product'], 'original'), ratio: choice(f.ratio, RATIOS, 'free'), size: choice(f.size, [1024, 2048, 4096], 2048), padding: number(f.padding, 10, 0, 35) },
    placement: { scale: number(p.scale, 100, 20, 200), x: number(p.x, 0, -50, 50), y: number(p.y, 0, -50, 50), opacity: number(p.opacity, 100, 0, 100) },
    sticker: { width: number(s.width, 0, 0, 20), color: color(s.color, '#ffffff'), opacity: number(s.opacity, 0, 0, 80), softness: number(s.softness, 16, 0, 40), x: number(s.x, 0, -40, 40), y: number(s.y, 10, -40, 40) },
  }
}
export function studioPreset(name) {
  const result = studioSettings()
  if (name === 'portrait') { result.background.kind = 'original'; result.background.blur = 12; result.subject.sharpen = 15 }
  else if (name === 'splash') { result.background.kind = 'original'; result.surroundings.look = 'bw' }
  else if (name === 'product' || name === 'sticker') {
    result.frame.mode = 'product'; result.frame.ratio = '1:1'
    result.background.kind = name === 'product' ? 'color' : 'transparent'
    result.sticker.opacity = 25; result.sticker.width = name === 'sticker' ? 4 : 0
  } else if (name === 'photo') result.background.kind = 'original'
  return result
}
function validSize({ width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 24000000 || Math.max(width, height) > 16384) throw new Error('Subject Studio supports results up to 24 MP and 16,384 px per edge.')
}
// Bounds are normalized so the same recipe works at preview and export resolution.
export function suggestSubjectCrop(bounds, width, height, ratio = 'free', padding = 10) {
  if (!bounds) throw new Error('No visible subject found. Refine the mask before framing.')
  const b = { x: bounds.x * width, y: bounds.y * height, width: bounds.width * width, height: bounds.height * height }
  const pad = Math.max(b.width, b.height) * padding / 100
  let w = b.width + pad * 2, h = b.height + pad * 2
  if (ratio !== 'free') { const r = ratioValue(ratio); w = Math.max(w, h * r); h = w / r }
  const fit = Math.min(1, width / w, height / h); w *= fit; h *= fit
  const x = clamp(b.x + b.width / 2 - w / 2, 0, width - w), y = clamp(b.y + b.height / 2 - h / 2, 0, height - h)
  return { x: x / width, y: y / height, width: w / width, height: h / height,
    clipped: x > b.x + 1 || y > b.y + 1 || x + w < b.x + b.width - 1 || y + h < b.y + b.height - 1 }
}
export function studioGeometry(width, height, bounds, value) {
  validSize({ width, height }); const settings = studioSettings(value), f = settings.frame
  let crop = null
  if (f.mode === 'product') {
    if (!bounds) throw new Error('No visible subject found. Refine the mask before framing.')
    const r = f.ratio === 'free' ? width / height : ratioValue(f.ratio)
    width = Math.round(f.size * Math.min(1, r)); height = Math.round(f.size / Math.max(1, r))
  } else if (f.mode === 'crop') {
    crop = suggestSubjectCrop(bounds, width, height, f.ratio, f.padding)
    width = Math.max(1, Math.round(width * crop.width)); height = Math.max(1, Math.round(height * crop.height))
  }
  validSize({ width, height })
  return { width, height, crop, clipped: crop?.clipped || false }
}
function adjust(pixels, value) {
  applyAdjustments(pixels, { exposure: value.exposure * 50, contrast: value.contrast, tint: value.tint,
    temperature: clamp(value.temperature + (value.look === 'warm' ? 25 : value.look === 'cool' ? -25 : 0), -100, 100),
    saturation: value.saturation, grayscale: value.look === 'bw' ? 100 : 0 })
  if (value.sharpen) applySharpen(pixels, value.sharpen)
}
// Separable O(pixel count) maximum filter. Radius does not multiply export cost.
export function spreadAlpha(alpha, width, height, radius) {
  radius = Math.max(0, Math.round(radius))
  const temp = new Uint8ClampedArray(alpha.length), out = new Uint8ClampedArray(alpha.length)
  function pass(src, dst, vertical) {
    const length = vertical ? height : width, lines = vertical ? width : height, stride = vertical ? width : 1
    const deque = new Int32Array(length)
    for (let line = 0; line < lines; line++) {
      const base = vertical ? line : line * width; let head = 0, tail = 0, right = -1
      for (let k = 0; k < length; k++) {
        const end = Math.min(length - 1, k + radius)
        while (right < end) { right++; while (tail > head && src[base + deque[tail - 1] * stride] <= src[base + right * stride]) tail--; deque[tail++] = right }
        while (deque[head] < k - radius) head++
        dst[base + k * stride] = src[base + deque[head] * stride]
      }
    }
  }
  pass(alpha, temp, false); pass(temp, out, true); return out
}
function outline(layer, width, hex) {
  if (width < .5) return
  const pixels = canvasToImageData(layer), p = pixels.data, alpha = new Uint8ClampedArray(layer.width * layer.height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = p[i * 4 + 3]
  const spread = spreadAlpha(alpha, layer.width, layer.height, width), rgb = [1, 3, 5].map(n => parseInt(hex.slice(n, n + 2), 16))
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i] / 255, behind = spread[i] / 255 * (1 - a), total = a + behind
    if (!total) continue
    for (let c = 0; c < 3; c++) p[i * 4 + c] = (p[i * 4 + c] * a + rgb[c] * behind) / total
    p[i * 4 + 3] = total * 255
  }
  layer.getContext('2d').putImageData(pixels, 0, 0)
}
function paintBackdrop(canvas, background, image) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height
  if (background.kind === 'transparent') return
  ctx.fillStyle = background.color; ctx.fillRect(0, 0, w, h)
  if (background.kind === 'gradient') {
    const angle = background.angle * Math.PI / 180, reach = (Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle))) / 2
    const dx = Math.cos(angle) * reach, dy = Math.sin(angle) * reach
    const gradient = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy)
    gradient.addColorStop(0, background.color); gradient.addColorStop(1, background.color2); ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h)
  } else if (background.kind === 'image') {
    if (!image) throw new Error('Choose a background image first.')
    const factor = Math[background.fit === 'cover' ? 'max' : 'min'](w / image.width, h / image.height)
    const iw = image.width * factor, ih = image.height * factor
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, (w - iw) * background.x / 100, (h - ih) * background.y / 100, iw, ih)
  }
}

// Shared worker-safe renderer. Source and mask never change. Effects use pixels
// per 1024px longest edge, keeping preview/export strengths consistent.
export function renderStudio(source, matte, value, backgroundImage = null, { previewLimit = 0, sourceSize = source } = {}) {
  validSize(source); validSize(sourceSize); if (backgroundImage) validSize(backgroundImage)
  if (!matte || !Number.isInteger(matte.width) || !Number.isInteger(matte.height) || matte.width < 1 || matte.height < 1 || Math.max(matte.width, matte.height) > 2048 || Math.abs(matte.width / matte.height - source.width / source.height) > 2 / matte.height + 2 / source.height) throw new Error('The subject mask does not match the source photo.')
  const settings = studioSettings(value), temporary = []
  const make = (w, h) => { const c = createCanvas(w, h); temporary.push(c); return c }
  try {
    const factor = previewLimit ? Math.min(1, previewLimit / Math.max(source.width, source.height)) : 1
    const w = Math.max(1, Math.round(source.width * factor)), h = Math.max(1, Math.round(source.height * factor))
    const working = make(w, h); working.getContext('2d').drawImage(source, 0, 0, w, h)
    const mask = make(w, h), mctx = mask.getContext('2d'); mctx.imageSmoothingQuality = 'high'; mctx.drawImage(matte, 0, 0, w, h)
    const maskPixels = canvasToImageData(mask).data, subjectPixels = canvasToImageData(working)
    adjust(subjectPixels, settings.subject)
    for (let i = 3; i < subjectPixels.data.length; i += 4) subjectPixels.data[i] = subjectPixels.data[i] * maskPixels[i] / 255
    const boundsPx = findContentBounds(subjectPixels, 8)
    const bounds = boundsPx && { x: boundsPx.x / w, y: boundsPx.y / h, width: boundsPx.width / w, height: boundsPx.height / h }
    const geometry = studioGeometry(sourceSize.width, sourceSize.height, bounds, settings)
    const outputScale = previewLimit ? Math.min(1, previewLimit / Math.max(geometry.width, geometry.height)) : 1
    const ow = Math.max(1, Math.round(geometry.width * outputScale)), oh = Math.max(1, Math.round(geometry.height * outputScale))
    const result = make(ow, oh), ctx = result.getContext('2d'); ctx.imageSmoothingQuality = 'high'
    const crop = geometry.crop || { x: 0, y: 0, width: 1, height: 1 }
    if (settings.background.kind === 'original') {
      if (settings.frame.mode === 'product') throw new Error('Product framing needs a transparent or replacement background.')
      const original = canvasToImageData(working), bg = new ImageData(new Uint8ClampedArray(original.data), w, h)
      adjust(bg, settings.surroundings)
      const fallback = settings.background.blur ? new Uint8ClampedArray(bg.data) : null
      if (settings.background.blur) {
        // Blur only background samples. Foreground colors must not bleed into a
        // halo around the subject. Normalize covered samples, preserve source alpha.
        for (let i = 3; i < bg.data.length; i += 4) bg.data[i] *= 1 - maskPixels[i] / 255
        applyBlur(bg, Math.max(1, Math.round(settings.background.blur * Math.max(w, h) / 1024)))
      }
      const foreground = canvasToImageData(working); adjust(foreground, settings.subject)
      for (let i = 0; i < original.data.length; i += 4) {
        const a = maskPixels[i + 3] / 255
        for (let c = 0; c < 3; c++) original.data[i + c] = foreground.data[i + c] * a + (fallback && !bg.data[i + 3] ? fallback[i + c] : bg.data[i + c]) * (1 - a)
      }
      working.getContext('2d').putImageData(original, 0, 0)
      ctx.drawImage(working, crop.x * w, crop.y * h, crop.width * w, crop.height * h, 0, 0, ow, oh)
    } else {
      paintBackdrop(result, settings.background, backgroundImage)
      if (settings.background.kind !== 'transparent') {
        const pixels = canvasToImageData(result); adjust(pixels, settings.surroundings)
        if (settings.background.blur) applyBlur(pixels, Math.max(1, Math.round(settings.background.blur * Math.max(ow, oh) / 1024)))
        ctx.putImageData(pixels, 0, 0)
      }
      const subject = imageDataToCanvas(subjectPixels); temporary.push(subject)
      const placed = make(ow, oh), pctx = placed.getContext('2d'); pctx.imageSmoothingQuality = 'high'
      if (settings.frame.mode === 'product') {
        const b = boundsPx, pad = settings.frame.padding / 100
        const scale = Math.min(ow * (1 - pad * 2) / b.width, oh * (1 - pad * 2) / b.height) * settings.placement.scale / 100
        const dw = b.width * scale, dh = b.height * scale
        pctx.drawImage(subject, b.x, b.y, b.width, b.height, (ow - dw) / 2 + settings.placement.x / 100 * ow, (oh - dh) / 2 + settings.placement.y / 100 * oh, dw, dh)
        geometry.upscaled = dw / outputScale > bounds.width * sourceSize.width + 1 || dh / outputScale > bounds.height * sourceSize.height + 1
      } else if (settings.frame.mode === 'crop') pctx.drawImage(subject, crop.x * w, crop.y * h, crop.width * w, crop.height * h, 0, 0, ow, oh)
      else {
        const scale = settings.placement.scale / 100
        pctx.drawImage(subject, (ow - ow * scale) / 2 + settings.placement.x / 100 * ow, (oh - oh * scale) / 2 + settings.placement.y / 100 * oh, ow * scale, oh * scale)
      }
      const units = Math.max(ow, oh) / 1024
      outline(placed, settings.sticker.width * units, settings.sticker.color)
      ctx.globalAlpha = settings.placement.opacity / 100
      ctx.shadowColor = `rgba(0,0,0,${settings.sticker.opacity / 100})`; ctx.shadowBlur = settings.sticker.softness * units
      ctx.shadowOffsetX = settings.sticker.x * units; ctx.shadowOffsetY = settings.sticker.y * units
      ctx.drawImage(placed, 0, 0)
    }
    temporary.splice(temporary.indexOf(result), 1)
    return { canvas: result, geometry: { ...geometry, bounds } }
  } finally { for (const c of temporary) c.width = c.height = 1 }
}
