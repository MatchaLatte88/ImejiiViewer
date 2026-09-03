import { clamp255 } from './color.js'

export const DEFAULT_EFFECTS = {
  blur: 0, // 0..20 px
  sharpen: 0, // 0..100 %
  posterize: 0, // 0 = aus, sonst 2..32 Stufen
  outlineWidth: 0, // 0..40 px
  outlineColor: '#ffffff',
  outlineOpacity: 100, // 0..100 %
}

/**
 * Separierbarer Box-Blur auf premultipliziertem RGBA.
 * Premultiplikation verhindert, dass transparente Pixel Farbe einschleppen.
 */
export function applyBlur(imageData, radius) {
  const r = Math.round(radius)
  if (r < 1) return

  const { data, width, height } = imageData
  const pixelCount = width * height
  // Process one channel at a time: 12 bytes/pixel scratch instead of 32.
  const src = new Float32Array(pixelCount)
  const dst = new Float32Array(pixelCount)
  const alpha = new Float32Array(pixelCount)
  const run = () => {
    for (let pass = 0; pass < 2; pass++) {
      blurPass(src, dst, width, height, r, false)
      blurPass(dst, src, width, height, r, true)
    }
  }
  for (let p = 0; p < pixelCount; p++) src[p] = data[p * 4 + 3]
  run()
  alpha.set(src)
  for (let c = 0; c < 3; c++) {
    for (let p = 0; p < pixelCount; p++) src[p] = data[p * 4 + c] * data[p * 4 + 3] / 255
    run()
    for (let p = 0; p < pixelCount; p++) data[p * 4 + c] = alpha[p] > 0.9945 ? clamp255(src[p] * 255 / alpha[p]) : 0
  }
  for (let p = 0; p < pixelCount; p++) data[p * 4 + 3] = clamp255(alpha[p])
}

function blurPass(src, dst, width, height, radius, vertical) {
  const length = vertical ? height : width
  const lines = vertical ? width : height
  const stride = vertical ? width : 1
  const windowSize = radius * 2 + 1
  for (let line = 0; line < lines; line++) {
    const base = vertical ? line : line * width
    let sum = src[base] * (radius + 1)
    for (let k = 1; k <= radius; k++) sum += src[base + Math.min(k, length - 1) * stride]
    for (let k = 0; k < length; k++) {
      dst[base + k * stride] = sum / windowSize
      sum += src[base + Math.min(k + radius + 1, length - 1) * stride]
      sum -= src[base + Math.max(k - radius, 0) * stride]
    }
  }
}

/** Unsharp Mask: verstaerkt die Differenz zwischen Original und weichgezeichneter Kopie. */
export function applySharpen(imageData, amount) {
  if (amount <= 0) return
  const strength = amount / 100
  const { data, width, height } = imageData
  const original = new Uint8ClampedArray(data)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (original[i + 3] === 0) continue
      for (let c = 0; c < 3; c++) {
        let sum = 0
        let weight = 0
        for (let dy = -1; dy <= 1; dy++) {
          const ny = Math.min(height - 1, Math.max(0, y + dy))
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(width - 1, Math.max(0, x + dx))
            sum += original[(ny * width + nx) * 4 + c]
            weight++
          }
        }
        const blurred = sum / weight
        data[i + c] = clamp255(original[i + c] + (original[i + c] - blurred) * strength * 2)
      }
    }
  }
}

/** Reduziert die Farbtiefe auf n Stufen pro Kanal - erzeugt flache Logo-Flaechen. */
export function applyPosterize(imageData, levels) {
  if (!levels || levels < 2) return
  const { data } = imageData
  const steps = Math.min(64, Math.round(levels))
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.round(Math.round((v / 255) * (steps - 1)) * (255 / (steps - 1)))
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    data[i] = lut[data[i]]
    data[i + 1] = lut[data[i + 1]]
    data[i + 2] = lut[data[i + 2]]
  }
}

/**
 * Legt eine farbige Kontur um die sichtbare Silhouette (Alpha-Dilatation).
 * Das Ergebnis wird in-place in imageData geschrieben.
 */
export function applyOutline(imageData, { width: outlineWidth, color, opacity = 100 }) {
  const radius = Math.round(outlineWidth)
  if (radius < 1) return

  const { data, width, height } = imageData
  const pixelCount = width * height

  const alpha = new Float32Array(pixelCount)
  for (let p = 0, i = 3; p < pixelCount; p++, i += 4) alpha[p] = data[i]

  const dilated = dilateAlpha(alpha, width, height, radius)
  const outlineAlpha = opacity / 100
  const { r, g, b } = color

  for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
    const sourceAlpha = data[i + 3] / 255
    const strokeAlpha = (dilated[p] / 255) * outlineAlpha
    if (strokeAlpha <= 0) continue

    // Original ueber die Kontur legen ("source-over" von Hand).
    const outAlpha = sourceAlpha + strokeAlpha * (1 - sourceAlpha)
    if (outAlpha <= 0) continue
    data[i] = clamp255((data[i] * sourceAlpha + r * strokeAlpha * (1 - sourceAlpha)) / outAlpha)
    data[i + 1] = clamp255(
      (data[i + 1] * sourceAlpha + g * strokeAlpha * (1 - sourceAlpha)) / outAlpha,
    )
    data[i + 2] = clamp255(
      (data[i + 2] * sourceAlpha + b * strokeAlpha * (1 - sourceAlpha)) / outAlpha,
    )
    data[i + 3] = clamp255(outAlpha * 255)
  }
}

/** Maximumfilter (kreisfoermig genaehert ueber zwei separate Durchgaenge). */
function dilateAlpha(alpha, width, height, radius) {
  const temp = new Float32Array(alpha.length)
  const out = new Float32Array(alpha.length)

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let max = 0
      const from = Math.max(0, x - radius)
      const to = Math.min(width - 1, x + radius)
      for (let nx = from; nx <= to; nx++) {
        const v = alpha[row + nx]
        if (v > max) max = v
      }
      temp[row + x] = max
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let max = 0
      const from = Math.max(0, y - radius)
      const to = Math.min(height - 1, y + radius)
      for (let ny = from; ny <= to; ny++) {
        const v = temp[ny * width + x]
        if (v > max) max = v
      }
      out[y * width + x] = max
    }
  }

  return out
}
