import { rgbToHex } from './color.js'

/** Formate, die als Eingabe akzeptiert werden. */
export const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]

export const ACCEPTED_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
  '.svg',
  '.ico',
]

/** Obergrenze der Arbeitsaufloesung - schuetzt Speicher und Laufzeit. */
export const MAX_SOURCE_SIZE = 4096

/** Rastergroesse fuer SVGs ohne intrinsische Abmessungen. */
const SVG_FALLBACK_SIZE = 1024

export function isSupportedFile(file) {
  if (!file) return false
  if (file.type && ACCEPTED_TYPES.includes(file.type)) return true
  const name = (file.name || '').toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

export function decodeViaImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(
        new Error('The image could not be decoded. The format is most likely unsupported.'),
      )
    img.src = url
  })
}

/**
 * Liest eine Datei und liefert die Quelldaten des Editors.
 * @returns {Promise<object>} name, type, size, width, height, naturalWidth, naturalHeight, scaled, imageData
 */
export async function loadImageFile(file) {
  if (!isSupportedFile(file)) {
    throw new Error('Unsupported format: ' + (file && file.name ? file.name : 'unknown'))
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await decodeViaImageElement(url)

    let naturalWidth = img.naturalWidth || img.width
    let naturalHeight = img.naturalHeight || img.height

    // SVGs melden je nach Datei keine feste Groesse - dann quadratisch rastern.
    if (!naturalWidth || !naturalHeight) {
      naturalWidth = SVG_FALLBACK_SIZE
      naturalHeight = SVG_FALLBACK_SIZE
    }

    let width = naturalWidth
    let height = naturalHeight
    let scaled = false
    const longest = Math.max(width, height)
    if (longest > MAX_SOURCE_SIZE) {
      const factor = MAX_SOURCE_SIZE / longest
      width = Math.max(1, Math.round(width * factor))
      height = Math.max(1, Math.round(height * factor))
      scaled = true
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, width, height)

    return {
      name: file.name || 'image',
      type: file.type || '',
      size: file.size || 0,
      width,
      height,
      naturalWidth,
      naturalHeight,
      scaled,
      imageData: ctx.getImageData(0, 0, width, height),
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Ermittelt die dominante Randfarbe - der beste Kandidat fuer den Hintergrund.
 * @returns {{hex: string, r: number, g: number, b: number, ratio: number} | null}
 */
export function detectBackgroundColor(imageData) {
  const { data, width, height } = imageData
  const buckets = new Map()
  let samples = 0

  const record = (index) => {
    if (data[index + 3] < 8) return
    // 5-Bit-Quantisierung, damit Rauschen und JPEG-Artefakte zusammenfallen.
    const key = ((data[index] >> 3) << 10) | ((data[index + 1] >> 3) << 5) | (data[index + 2] >> 3)
    const entry = buckets.get(key)
    if (entry) {
      entry.count++
      entry.r += data[index]
      entry.g += data[index + 1]
      entry.b += data[index + 2]
    } else {
      buckets.set(key, { count: 1, r: data[index], g: data[index + 1], b: data[index + 2] })
    }
    samples++
  }

  // Zwei Pixel breiter Rahmen als Stichprobe.
  for (let band = 0; band < 2 && band < height && band < width; band++) {
    for (let x = 0; x < width; x++) {
      record((band * width + x) * 4)
      record(((height - 1 - band) * width + x) * 4)
    }
    for (let y = 0; y < height; y++) {
      record((y * width + band) * 4)
      record((y * width + (width - 1 - band)) * 4)
    }
  }

  if (!samples) return null

  let best = null
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) best = entry
  }
  if (!best) return null

  const r = Math.round(best.r / best.count)
  const g = Math.round(best.g / best.count)
  const b = Math.round(best.b / best.count)
  return { hex: rgbToHex(r, g, b), r, g, b, ratio: best.count / samples }
}

/** Mittelwert der Farbe in einem Quadrat um (x, y) - robuster als ein einzelnes Pixel. */
export function sampleColorAt(imageData, x, y, radius = 1) {
  const { data, width, height } = imageData
  const cx = Math.round(x)
  const cy = Math.round(y)
  let r = 0
  let g = 0
  let b = 0
  let count = 0

  for (let dy = -radius; dy <= radius; dy++) {
    const py = cy + dy
    if (py < 0 || py >= height) continue
    for (let dx = -radius; dx <= radius; dx++) {
      const px = cx + dx
      if (px < 0 || px >= width) continue
      const i = (py * width + px) * 4
      if (data[i + 3] < 8) continue
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      count++
    }
  }

  if (!count) return null
  r = Math.round(r / count)
  g = Math.round(g / count)
  b = Math.round(b / count)
  return { hex: rgbToHex(r, g, b), r, g, b }
}
