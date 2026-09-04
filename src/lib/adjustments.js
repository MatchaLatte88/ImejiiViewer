import { clamp255, hslToRgb, rgbToHsl, luminance } from './color.js'

/** Neutralwerte aller Farbkorrekturen. */
export const DEFAULT_ADJUSTMENTS = {
  exposure: 0, // -100..100
  brightness: 0, // -100..100
  contrast: 0, // -100..100
  gamma: 100, // 10..300 (100 = neutral)
  temperature: 0, // -100 (kalt) .. 100 (warm)
  tint: 0,
  shadows: 0,
  highlights: 0,
  whites: 0,
  blacks: 0,
  whiteBalanceR: 1,
  whiteBalanceG: 1,
  whiteBalanceB: 1,
  saturation: 0, // -100..100
  vibrance: 0, // -100..100
  hue: 0, // -180..180
  grayscale: 0, // 0..100
  invert: false,
}

export function isNeutral(adjustments) {
  return Object.keys(DEFAULT_ADJUSTMENTS).every(
    (key) => adjustments[key] === DEFAULT_ADJUSTMENTS[key],
  )
}

/**
 * Baut fuer jeden Kanal eine 256er-Lookup-Tabelle aus allen tonwertbasierten
 * Korrekturen (Belichtung, Weissabgleich, Helligkeit, Kontrast, Gamma).
 */
function buildChannelLuts(a) {
  const exposure = Math.pow(2, a.exposure / 50)
  const brightness = (a.brightness / 100) * 255
  const c = a.contrast
  const contrastFactor = (259 * (c + 255)) / (255 * (259 - c))
  const gamma = Math.max(0.01, a.gamma / 100)
  const invGamma = 1 / gamma
  const temp = a.temperature / 100
  const tint = (a.tint || 0) / 100
  const offsets = [temp * 32 + tint * 12, temp * 6 - tint * 24, -temp * 32 + tint * 12]
  const gains = [a.whiteBalanceR, a.whiteBalanceG, a.whiteBalanceB].map(v => Math.max(0.25, Math.min(4, Number(v) || 1)))

  const luts = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)]
  for (let channel = 0; channel < 3; channel++) {
    const lut = luts[channel]
    const offset = offsets[channel]
    for (let v = 0; v < 256; v++) {
      let value = v * gains[channel] * exposure + offset + brightness
      value = contrastFactor * (value - 128) + 128
      value = 255 * Math.pow(Math.max(0, value) / 255, invGamma)
      lut[v] = clamp255(value)
    }
  }
  return luts
}

/**
 * Wendet alle Farbkorrekturen in-place an. Transparente Pixel bleiben unberuehrt.
 * @param {ImageData} imageData
 * @param {object} adjustments siehe DEFAULT_ADJUSTMENTS
 */
export function applyAdjustments(imageData, adjustments) {
  const a = { ...DEFAULT_ADJUSTMENTS, ...adjustments }
  if (isNeutral(a)) return

  const { data } = imageData
  const luts = buildChannelLuts(a)
  const [lutR, lutG, lutB] = luts

  const needsHsl = a.saturation !== 0 || a.vibrance !== 0 || a.hue !== 0
  const saturation = 1 + a.saturation / 100
  const vibrance = a.vibrance / 100
  const gray = a.grayscale / 100

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue

    let r = lutR[data[i]]
    let g = lutG[data[i + 1]]
    let b = lutB[data[i + 2]]

    // Luminance-weighted adjustments preserve channel relationships. They cannot
    // recover detail that was already clipped in the source's 8-bit pixels.
    const luma = luminance(r, g, b) / 255
    const shadowWeight = (1 - luma) ** 2 * Math.min(1, luma * 8)
    const highlightWeight = luma ** 2 * Math.min(1, (1 - luma) * 8)
    const delta = ((a.shadows || 0) * shadowWeight + (a.highlights || 0) * highlightWeight) * 1.1
      + (a.whites || 0) * luma ** 4 * 1.2 + (a.blacks || 0) * (1 - luma) ** 4 * 1.2
    r = clamp255(r + delta); g = clamp255(g + delta); b = clamp255(b + delta)

    if (needsHsl) {
      const hsl = rgbToHsl(r, g, b)
      let s = hsl.s
      if (vibrance !== 0) s += vibrance * (1 - s) * (vibrance > 0 ? 1 : s)
      s *= saturation
      s = s < 0 ? 0 : s > 1 ? 1 : s
      const rgb = hslToRgb(hsl.h + a.hue, s, hsl.l)
      r = rgb.r
      g = rgb.g
      b = rgb.b
    }

    if (gray > 0) {
      const l = luminance(r, g, b)
      r += (l - r) * gray
      g += (l - g) * gray
      b += (l - b) * gray
    }

    if (a.invert) {
      r = 255 - r
      g = 255 - g
      b = 255 - b
    }

    data[i] = clamp255(r)
    data[i + 1] = clamp255(g)
    data[i + 2] = clamp255(b)
  }
}
