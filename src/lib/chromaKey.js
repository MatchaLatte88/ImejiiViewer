import { MAX_RGB_DISTANCE, clamp255 } from './color.js'

/**
 * Entfernt Hintergrundfarben (Chroma-Key) aus ImageData - in-place.
 *
 * Ablauf pro Pixel:
 *   d = kleinste RGB-Distanz zu einer der Key-Farben
 *   d <= tolerance                  -> voll transparent
 *   tolerance < d < tolerance+soft  -> weicher Uebergang
 *   d >= tolerance + soft           -> unveraendert
 *
 * @param {ImageData} imageData
 * @param {object} options
 * @param {Array<{r:number,g:number,b:number}>} options.keys  Key-Farben
 * @param {number} options.tolerance  0..100 (%)
 * @param {number} options.softness   0..100 (%)
 * @param {boolean} options.contiguous  nur zusammenhaengende Flaechen entfernen
 * @param {Array<{x:number,y:number}>} [options.seeds]  Startpunkte fuer den Flood-Fill
 * @param {number} options.despill    0..100 (%) Farbsaum-Korrektur
 */
export function applyChromaKey(imageData, options) {
  const keys = options.keys || []
  if (!keys.length) return

  const { data, width, height } = imageData
  const tolerance = (options.tolerance / 100) * MAX_RGB_DISTANCE
  const softness = (options.softness / 100) * MAX_RGB_DISTANCE
  const outer = tolerance + softness
  const despill = (options.despill || 0) / 100

  const keyCount = keys.length
  const keyR = new Float64Array(keyCount)
  const keyG = new Float64Array(keyCount)
  const keyB = new Float64Array(keyCount)
  for (let k = 0; k < keyCount; k++) {
    keyR[k] = keys[k].r
    keyG[k] = keys[k].g
    keyB[k] = keys[k].b
  }

  const pixelCount = width * height
  const distance = new Float32Array(pixelCount)
  const nearest = new Uint8Array(pixelCount)

  for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    let best = Infinity
    let bestKey = 0
    for (let k = 0; k < keyCount; k++) {
      const dr = r - keyR[k]
      const dg = g - keyG[k]
      const db = b - keyB[k]
      const d = dr * dr + dg * dg + db * db
      if (d < best) {
        best = d
        bestKey = k
      }
    }
    distance[p] = Math.sqrt(best)
    nearest[p] = bestKey
  }

  const affected = options.contiguous
    ? floodFillMask(distance, width, height, outer, options.seeds, data)
    : null

  for (let p = 0, i = 3; p < pixelCount; p++, i += 4) {
    if (affected && affected[p] === 0) continue
    const alpha = data[i]
    if (alpha === 0) continue

    const d = distance[p]
    let factor
    if (d <= tolerance) factor = 0
    else if (softness > 0 && d < outer) factor = (d - tolerance) / softness
    else continue

    const newAlpha = alpha * factor
    data[i] = newAlpha

    if (despill > 0 && newAlpha > 4 && newAlpha < 251) {
      const k = nearest[p]
      const a = newAlpha / 255
      const base = i - 3
      // Un-Premultiply gegen die Key-Farbe: entfernt den Farbstich weicher Kanten.
      const cr = (data[base] - keyR[k] * (1 - a)) / a
      const cg = (data[base + 1] - keyG[k] * (1 - a)) / a
      const cb = (data[base + 2] - keyB[k] * (1 - a)) / a
      data[base] = clamp255(data[base] + (cr - data[base]) * despill)
      data[base + 1] = clamp255(data[base + 1] + (cg - data[base + 1]) * despill)
      data[base + 2] = clamp255(data[base + 2] + (cb - data[base + 2]) * despill)
    }
  }
}

/**
 * Markiert alle Pixel, die vom Rand (oder von Seeds) aus zusammenhaengend
 * innerhalb der Toleranz liegen. 4er-Nachbarschaft, iterativ mit Stack.
 */
function floodFillMask(distance, width, height, outer, seeds, data) {
  const pixelCount = width * height
  const mask = new Uint8Array(pixelCount)
  const stack = new Int32Array(pixelCount)
  let top = 0

  const push = (p) => {
    if (p < 0 || p >= pixelCount) return
    if (mask[p]) return
    if (distance[p] > outer) return
    if (data[p * 4 + 3] === 0) return
    mask[p] = 1
    stack[top++] = p
  }

  if (seeds && seeds.length) {
    for (const seed of seeds) {
      const x = Math.round(seed.x)
      const y = Math.round(seed.y)
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      push(y * width + x)
    }
  } else {
    for (let x = 0; x < width; x++) {
      push(x)
      push((height - 1) * width + x)
    }
    for (let y = 0; y < height; y++) {
      push(y * width)
      push(y * width + width - 1)
    }
  }

  while (top > 0) {
    const p = stack[--top]
    const x = p % width
    if (x > 0) push(p - 1)
    if (x < width - 1) push(p + 1)
    if (p >= width) push(p - width)
    if (p < pixelCount - width) push(p + width)
  }

  return mask
}

/**
 * Weiche Kanten: Box-Blur (zweifach = Gauss-Naeherung) nur auf dem Alphakanal.
 * @param {ImageData} imageData
 * @param {number} radius in Pixeln
 */
export function featherAlpha(imageData, radius) {
  const r = Math.round(radius)
  if (r < 1) return
  const { data, width, height } = imageData
  const pixelCount = width * height

  let alpha = new Float32Array(pixelCount)
  for (let p = 0, i = 3; p < pixelCount; p++, i += 4) alpha[p] = data[i]

  let temp = new Float32Array(pixelCount)
  for (let pass = 0; pass < 2; pass++) {
    boxBlurHorizontal(alpha, temp, width, height, r)
    boxBlurVertical(temp, alpha, width, height, r)
  }

  for (let p = 0, i = 3; p < pixelCount; p++, i += 4) data[i] = clamp255(alpha[p])
}

function boxBlurHorizontal(src, dst, width, height, radius) {
  const window = radius * 2 + 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = src[row] * (radius + 1)
    for (let x = 1; x <= radius; x++) sum += src[row + Math.min(x, width - 1)]
    for (let x = 0; x < width; x++) {
      dst[row + x] = sum / window
      const add = src[row + Math.min(x + radius + 1, width - 1)]
      const remove = src[row + Math.max(x - radius, 0)]
      sum += add - remove
    }
  }
}

function boxBlurVertical(src, dst, width, height, radius) {
  const window = radius * 2 + 1
  for (let x = 0; x < width; x++) {
    let sum = src[x] * (radius + 1)
    for (let y = 1; y <= radius; y++) sum += src[Math.min(y, height - 1) * width + x]
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = sum / window
      const add = src[Math.min(y + radius + 1, height - 1) * width + x]
      const remove = src[Math.max(y - radius, 0) * width + x]
      sum += add - remove
    }
  }
}

/**
 * Zieht die Alphamaske zusammen (positiv) oder weitet sie (negativ).
 * Arbeitet auf der Alphakurve, nicht morphologisch - guenstig und ausreichend,
 * um Halos nach dem Keying zu entfernen.
 * @param {number} amount -100..100
 */
export function contractAlpha(imageData, amount) {
  if (!amount) return
  const { data } = imageData
  const t = Math.min(0.95, Math.abs(amount) / 100)
  const shrink = amount > 0

  for (let i = 3; i < data.length; i += 4) {
    const a = data[i] / 255
    if (a <= 0 || a >= 1) continue
    const next = shrink ? (a - t) / (1 - t) : a / (1 - t)
    data[i] = clamp255(next * 255)
  }
}

/**
 * Farbe transparenter Randpixel aus den opaken Nachbarn auffuellen.
 * Verhindert dunkle/farbige Saeume beim spaeteren Verkleinern (Alpha-Bleeding).
 */
export function bleedEdges(imageData, iterations = 2) {
  const { data, width, height } = imageData

  for (let pass = 0; pass < iterations; pass++) {
    const snapshot = new Uint8ClampedArray(data)
    let changed = false

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (snapshot[i + 3] > 8) continue

        let r = 0
        let g = 0
        let b = 0
        let weight = 0
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= height) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue
            const ni = (ny * width + nx) * 4
            const na = snapshot[ni + 3]
            if (na <= 8) continue
            r += snapshot[ni] * na
            g += snapshot[ni + 1] * na
            b += snapshot[ni + 2] * na
            weight += na
          }
        }

        if (weight > 0) {
          data[i] = r / weight
          data[i + 1] = g / weight
          data[i + 2] = b / weight
          changed = true
        }
      }
    }

    if (!changed) break
  }
}
