import { DEFAULT_ADJUSTMENTS, applyAdjustments } from './adjustments.js'
import { applyCurve, curveIsActive, normalizeCurve } from './photoCurves.js'
import { DEFAULT_COLOR_SHIFT, applyColorShifts, isActiveShift } from './colorShifts.js'
import { applyBlur, applySharpen } from './effects.js'
import { canvasToImageData, createCanvas, imageDataToCanvas, resizeCanvas } from './transform.js'
import { clamp, clamp255 } from './color.js'
import { applyLocalLight, normalizeLocalMasks } from './localLight.js'

/** Bearbeitungszustand eines einzelnen Bildes. */
export const DEFAULT_EDITS = {
  rotate: 0, // 0 | 90 | 180 | 270 (im Uhrzeigersinn)
  flipH: false,
  flipV: false,
  straighten: 0, // -45..45 Grad Feinkorrektur, schneidet automatisch zu
  crop: null, // { x, y, width, height } als Anteile 0..1 nach Drehung
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  curve: [0, 64, 128, 192, 255],
  localMasks: [],
  colorShifts: [], // gezielte Farbaenderungen, siehe colorShifts.js
  sharpen: 0, // 0..100
  blur: 0, // 0..20 px
  vignette: 0, // 0..100
  resize: { mode: 'none', value: 100 }, // none | longest | width | height | percent
}

export function createEdits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object') overrides = {}
  const number = (value, fallback, min, max) => Number.isFinite(value) ? clamp(value, min, max) : fallback
  const adjustments = Object.fromEntries(Object.entries(DEFAULT_ADJUSTMENTS).map(([key, fallback]) => [key,
    typeof fallback === 'boolean' ? overrides.adjustments?.[key] === true :
      number(overrides.adjustments?.[key], fallback, key.startsWith('whiteBalance') ? 0.25 : key === 'gamma' ? 10 : key === 'grayscale' ? 0 : key === 'hue' ? -180 : -100,
        key.startsWith('whiteBalance') ? 4 : key === 'gamma' ? 300 : key === 'hue' ? 180 : 100)]))
  const crop = overrides.crop && { x: number(overrides.crop.x, 0, 0, 0.999), y: number(overrides.crop.y, 0, 0, 0.999) }
  if (crop) { crop.width = number(overrides.crop.width, 1 - crop.x, 0.001, 1 - crop.x); crop.height = number(overrides.crop.height, 1 - crop.y, 0.001, 1 - crop.y) }
  return {
    ...DEFAULT_EDITS,
    rotate: [0, 90, 180, 270].includes(overrides.rotate) ? overrides.rotate : 0,
    flipH: overrides.flipH === true, flipV: overrides.flipV === true,
    straighten: number(overrides.straighten, 0, -45, 45),
    sharpen: number(overrides.sharpen, 0, 0, 100), blur: number(overrides.blur, 0, 0, 20), vignette: number(overrides.vignette, 0, 0, 100),
    adjustments,
    curve: normalizeCurve(overrides.curve),
    localMasks: normalizeLocalMasks(overrides.localMasks),
    colorShifts: (Array.isArray(overrides.colorShifts) ? overrides.colorShifts : []).slice(0, 20).map((shift) => ({ ...DEFAULT_COLOR_SHIFT,
      hex: /^#[0-9a-f]{6}$/i.test(shift?.hex) ? shift.hex : '#ff0000', hue: number(shift?.hue, 0, -180, 180),
      saturation: number(shift?.saturation, 0, -100, 100), lightness: number(shift?.lightness, 0, -100, 100), range: number(shift?.range, 30, 5, 90) })),
    resize: { mode: ['none', 'longest', 'width', 'height', 'percent'].includes(overrides.resize?.mode) ? overrides.resize.mode : 'none', value: number(overrides.resize?.value, 100, 1, overrides.resize?.mode === 'percent' ? 400 : 16384) },
    crop: crop || null,
  }
}

export function hasEdits(edits) {
  const d = DEFAULT_EDITS
  if (
    edits.rotate !== d.rotate ||
    edits.flipH ||
    edits.flipV ||
    edits.straighten !== 0 ||
    edits.crop ||
    curveIsActive(edits.curve) ||
    edits.localMasks?.length ||
    edits.colorShifts?.some(isActiveShift) ||
    edits.sharpen !== 0 ||
    edits.blur !== 0 ||
    edits.vignette !== 0 ||
    edits.resize.mode !== 'none'
  ) {
    return true
  }
  return Object.keys(DEFAULT_ADJUSTMENTS).some(
    (key) => edits.adjustments[key] !== DEFAULT_ADJUSTMENTS[key],
  )
}

/** Dreht ein relatives Crop-Rechteck mit, wenn das Bild um 90 Grad gedreht wird. */
export function rotateCropRect(crop, quarterTurns) {
  if (!crop) return null
  let rect = { ...crop }
  const turns = ((quarterTurns % 4) + 4) % 4
  for (let i = 0; i < turns; i++) {
    rect = {
      x: 1 - (rect.y + rect.height),
      y: rect.x,
      width: rect.height,
      height: rect.width,
    }
  }
  return rect
}

export function flipCropRect(crop, horizontal) {
  if (!crop) return null
  return horizontal
    ? { ...crop, x: 1 - (crop.x + crop.width) }
    : { ...crop, y: 1 - (crop.y + crop.height) }
}

/** Groesstes achsenparalleles Rechteck, das nach der Drehung noch im Bild liegt. */
function largestInnerRect(width, height, angleRad) {
  const angle = Math.abs(angleRad)
  if (angle < 1e-6) return { width, height }

  const sin = Math.abs(Math.sin(angle))
  const cos = Math.abs(Math.cos(angle))
  const longSide = Math.max(width, height)
  const shortSide = Math.min(width, height)

  if (shortSide <= 2 * sin * cos * longSide || Math.abs(sin - cos) < 1e-10) {
    const x = 0.5 * shortSide
    return width >= height
      ? { width: x / sin, height: x / cos }
      : { width: x / cos, height: x / sin }
  }

  const cos2 = cos * cos - sin * sin
  return {
    width: (width * cos - height * sin) / cos2,
    height: (height * cos - width * sin) / cos2,
  }
}

/** Bildgroesse nach Anwendung der Resize-Regel. */
export function resolveTargetSize(width, height, resize) {
  if (!resize || resize.mode === 'none') return { width, height }
  const value = Number(resize.value) || 0
  if (value <= 0) return { width, height }

  const ratio = width / height
  switch (resize.mode) {
    case 'percent': {
      const factor = value / 100
      return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) }
    }
    case 'width':
      return { width: Math.max(1, Math.round(value)), height: Math.max(1, Math.round(value / ratio)) }
    case 'height':
      return { width: Math.max(1, Math.round(value * ratio)), height: Math.max(1, Math.round(value)) }
    case 'longest': {
      const longest = Math.max(width, height)
      const factor = value / longest
      return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) }
    }
    default:
      return { width, height }
  }
}

/** Geometrie ohne Pixelarbeit - fuer Groessenanzeigen in der Oberflaeche. */
export function previewGeometry(sourceWidth, sourceHeight, edits) {
  const quarter = (((edits.rotate / 90) % 4) + 4) % 4
  let width = quarter % 2 === 1 ? sourceHeight : sourceWidth
  let height = quarter % 2 === 1 ? sourceWidth : sourceHeight

  if (edits.straighten) {
    const inner = largestInnerRect(width, height, (edits.straighten * Math.PI) / 180)
    width = Math.max(1, Math.floor(inner.width))
    height = Math.max(1, Math.floor(inner.height))
  }

  if (edits.crop) {
    width = Math.max(1, Math.round(width * edits.crop.width))
    height = Math.max(1, Math.round(height * edits.crop.height))
  }

  return resolveTargetSize(width, height, edits.resize)
}

function applyVignette(canvas, strength) {
  if (strength <= 0) return
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.35,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  )
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, 'rgba(0,0,0,' + (strength / 100) * 0.85 + ')')
  ctx.save()
  // Nur dort abdunkeln, wo tatsaechlich Bild ist.
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

/**
 * Verarbeitungskette fuer den Bildmodus:
 * Drehen/Spiegeln -> Ausrichten -> Zuschneiden -> Farbe -> Effekte -> Skalieren.
 *
 * @param {HTMLCanvasElement} source dekodiertes Originalbild
 * @param {object} edits siehe DEFAULT_EDITS
 * @param {{skipResize?: boolean}} [options]
 * @returns {HTMLCanvasElement}
 */
export function processPhoto(source, edits, options = {}) {
  let canvas = source
  if (edits.localMasks?.some(mask => mask.enabled && mask.exposure !== 0)) {
    const pixels = canvasToImageData(canvas)
    applyLocalLight(pixels, edits.localMasks)
    canvas = imageDataToCanvas(pixels)
  }
  const quarter = (((edits.rotate / 90) % 4) + 4) % 4

  if (quarter || edits.flipH || edits.flipV) {
    const swap = quarter % 2 === 1
    const target = createCanvas(
      swap ? canvas.height : canvas.width,
      swap ? canvas.width : canvas.height,
    )
    const ctx = target.getContext('2d')
    ctx.translate(target.width / 2, target.height / 2)
    ctx.scale(edits.flipH ? -1 : 1, edits.flipV ? -1 : 1)
    ctx.rotate((quarter * 90 * Math.PI) / 180)
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
    canvas = target
  }

  if (edits.straighten) {
    const rad = (edits.straighten * Math.PI) / 180
    const inner = largestInnerRect(canvas.width, canvas.height, rad)
    const target = createCanvas(Math.floor(inner.width), Math.floor(inner.height))
    const ctx = target.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.translate(target.width / 2, target.height / 2)
    ctx.rotate(-rad)
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
    canvas = target
  }

  if (edits.crop) {
    const x = Math.round(clamp(edits.crop.x, 0, 1) * canvas.width)
    const y = Math.round(clamp(edits.crop.y, 0, 1) * canvas.height)
    const width = Math.max(1, Math.round(clamp(edits.crop.width, 0, 1) * canvas.width))
    const height = Math.max(1, Math.round(clamp(edits.crop.height, 0, 1) * canvas.height))
    const target = createCanvas(width, height)
    target
      .getContext('2d')
      .drawImage(canvas, x, y, width, height, 0, 0, width, height)
    canvas = target
  }

  const needsPixelWork =
    curveIsActive(edits.curve) ||
    edits.sharpen > 0 ||
    edits.blur > 0 ||
    edits.colorShifts?.some(isActiveShift) ||
    Object.keys(DEFAULT_ADJUSTMENTS).some(
      (key) => edits.adjustments[key] !== DEFAULT_ADJUSTMENTS[key],
    )

  if (needsPixelWork) {
    const imageData = canvasToImageData(canvas)
    applyAdjustments(imageData, edits.adjustments)
    applyCurve(imageData, edits.curve)
    // Nach der globalen Korrektur: die Pipette nimmt die Farben aus der Vorschau.
    applyColorShifts(imageData, edits.colorShifts)
    if (edits.blur > 0) applyBlur(imageData, edits.blur)
    if (edits.sharpen > 0) applySharpen(imageData, edits.sharpen)
    canvas = imageDataToCanvas(imageData)
  } else if (canvas === source) {
    // Immer eine Kopie zurueckgeben, damit Aufrufer frei zeichnen koennen.
    const copy = createCanvas(canvas.width, canvas.height)
    copy.getContext('2d').drawImage(canvas, 0, 0)
    canvas = copy
  }

  if (edits.vignette > 0) applyVignette(canvas, edits.vignette)

  if (!options.skipResize) {
    const target = resolveTargetSize(canvas.width, canvas.height, edits.resize)
    if (target.width !== canvas.width || target.height !== canvas.height) {
      canvas = resizeCanvas(canvas, target.width, target.height)
    }
  }

  return canvas
}

/**
 * Automatische Tonwertkorrektur: streckt das Histogramm auf den vollen Umfang.
 * @returns {{brightness: number, contrast: number}}
 */
export function computeAutoAdjustments(imageData) {
  const { data } = imageData
  const histogram = new Uint32Array(256)
  let total = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue
    const value = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
    histogram[clamp255(Math.round(value))]++
    total++
  }
  if (!total) return { brightness: 0, contrast: 0 }

  const cut = total * 0.005
  let low = 0
  let high = 255
  let sum = 0
  for (let i = 0; i < 256; i++) {
    sum += histogram[i]
    if (sum > cut) {
      low = i
      break
    }
  }
  sum = 0
  for (let i = 255; i >= 0; i--) {
    sum += histogram[i]
    if (sum > cut) {
      high = i
      break
    }
  }

  const span = Math.max(1, high - low)
  const contrast = clamp(Math.round((255 / span - 1) * 55), -100, 100)
  const midpoint = (low + high) / 2
  const brightness = clamp(Math.round(((127.5 - midpoint) / 255) * 100), -100, 100)
  return { brightness, contrast }
}

/**
 * Histogramm mit 256 Stufen je Kanal, auf den Maximalwert normiert.
 * @returns {{r: Float32Array, g: Float32Array, b: Float32Array, l: Float32Array}}
 */
export function computeHistogram(imageData) {
  const { data } = imageData
  const r = new Float32Array(256)
  const g = new Float32Array(256)
  const b = new Float32Array(256)
  const l = new Float32Array(256)

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue
    r[data[i]]++
    g[data[i + 1]]++
    b[data[i + 2]]++
    l[clamp255(Math.round((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000))]++
  }

  const normalize = (channel) => {
    let max = 0
    for (let i = 0; i < 256; i++) if (channel[i] > max) max = channel[i]
    if (max > 0) for (let i = 0; i < 256; i++) channel[i] /= max
    return channel
  }

  return { r: normalize(r), g: normalize(g), b: normalize(b), l: normalize(l) }
}
